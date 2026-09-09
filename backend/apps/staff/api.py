"""Endpoint /api/staff — operatrici, turni, assenze, performance, clienti serviti."""

from typing import Optional

from django.db import transaction
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError

from apps.core.models import Location, Salon
from apps.core.services import log_activity
from common.portal_access import business_operation
from common.auth import staff_auth
from common.permissions import require_scope
from common.utils import salon_get

from .models import Absence, Operator, WeeklyShift
from .schemas import (
    AbsenceIn,
    AbsenceOut,
    OkOut,
    OperatorDetailOut,
    OperatorIn,
    OperatorOut,
    OperatorStatusOut,
    PerformanceOut,
    PublicOperatorOut,
    ServedClientOut,
    ShiftsReplaceIn,
    WeeklyShiftOut,
)
from .services import (
    month_revenue,
    performance_series,
    served_clients,
    today_clients_count,
    today_status,
)

router = Router(tags=["staff"])


# ---- Helpers -----------------------------------------------------------------


def _fmt_min(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _catalog_service_model():
    from apps.catalog.models import Service  # lazy: catalog è caricata dopo staff

    return Service


def _resolve_user(ctx, user_id: Optional[int]):
    """L'utente staff associato all'operatrice deve appartenere allo stesso team."""
    if not user_id:
        return None
    from apps.accounts.models import Membership  # lazy: accounts è caricata prima, ma per coerenza di stile

    membership = (
        Membership.objects.filter(salon=ctx.salon, user_id=user_id).select_related("user").first()
    )
    if membership is None:
        raise HttpError(404, "Utente non trovato nel team")
    return membership.user


def _operators_qs(ctx):
    return Operator.objects.filter(salon=ctx.salon).prefetch_related("services")


def _get_salon_by_slug(slug: str) -> Salon:
    try:
        return Salon.objects.get(slug=slug)
    except Salon.DoesNotExist:
        raise HttpError(404, "Salone non trovato")


def _operator_out(op: Operator) -> dict:
    return {
        "id": op.id,
        "first_name": op.first_name,
        "last_name": op.last_name,
        "initials": op.initials,
        "color": op.color,
        "role_title": op.role_title,
        "location_id": op.location_id,
        "user_id": op.user_id,
        "service_ids": [s.id for s in op.services.all()],
        "hourly_cost": op.hourly_cost,
        "cycle_weeks": op.cycle_weeks,
        "active": op.active,
        "order": op.order,
    }


def _apply_operator_payload(operator: Operator, ctx, data: OperatorIn) -> Operator:
    payload = data.dict()
    service_ids = payload.pop("service_ids")
    location_id = payload.pop("location_id")
    user_id = payload.pop("user_id")

    location = salon_get(Location, ctx, location_id) if location_id else None
    user = _resolve_user(ctx, user_id)

    for name, value in payload.items():
        setattr(operator, name, value)
    operator.salon = ctx.salon
    operator.location = location
    operator.user = user
    operator.save()

    Service = _catalog_service_model()
    operator.services.set(Service.objects.filter(salon=ctx.salon, id__in=service_ids))
    return operator


def _validate_shift_row(operator: Operator, row) -> None:
    if row.weekday not in range(7):
        raise HttpError(400, "Giorno della settimana non valido")
    if row.week_index >= (operator.cycle_weeks or 1):
        raise HttpError(400, "Settimana del ciclo non valida per questa operatrice")
    if not (0 <= row.start_min < row.end_min <= 1440):
        raise HttpError(400, "Orario di turno non valido")
    if (row.break_start_min is None) != (row.break_end_min is None):
        raise HttpError(400, "La pausa richiede sia l'inizio sia la fine")
    if row.break_start_min is not None:
        if not (row.start_min <= row.break_start_min < row.break_end_min <= row.end_min):
            raise HttpError(400, "Orario di pausa non valido")


# ---- Lista operatrici con stato di oggi ----------------------------------------


@router.get("/", auth=staff_auth, response=list[OperatorStatusOut])
def list_operators(request):
    ctx = request.auth
    today = timezone.localdate()
    result = []
    for op in _operators_qs(ctx).filter(active=True):
        status = today_status(op, today)
        out = _operator_out(op)
        out.update(
            {
                "on_shift": status["on_shift"],
                "windows": [(_fmt_min(a), _fmt_min(b)) for a, b in status["windows"]],
                "absence_type": status["absence_type"],
                "month_revenue": month_revenue(op, today),
                "today_clients": today_clients_count(op, today),
            }
        )
        result.append(out)
    return result


# ---- CRUD operatrici -----------------------------------------------------------


@router.post("/", auth=staff_auth, response=OperatorOut)
@business_operation
def create_operator(request, data: OperatorIn):
    ctx = request.auth
    require_scope(ctx, "team")
    operator = _apply_operator_payload(Operator(), ctx, data)
    log_activity(
        ctx.salon,
        "operator.created",
        f"Nuova operatrice: {operator.first_name} {operator.last_name}",
        actor=ctx.user,
        payload={"operator_id": operator.id},
    )
    return _operator_out(operator)


@router.get("/{int:operator_id}", auth=staff_auth, response=OperatorDetailOut)
def get_operator(request, operator_id: int):
    op = salon_get(Operator, request.auth, operator_id)
    out = _operator_out(op)
    out["shifts"] = list(op.shifts.all())
    return out


@router.put("/{int:operator_id}", auth=staff_auth, response=OperatorOut)
@business_operation
def update_operator(request, operator_id: int, data: OperatorIn):
    ctx = request.auth
    require_scope(ctx, "team")
    operator = salon_get(Operator, ctx, operator_id)
    operator = _apply_operator_payload(operator, ctx, data)
    log_activity(
        ctx.salon,
        "operator.updated",
        f"Operatrice aggiornata: {operator.first_name} {operator.last_name}",
        actor=ctx.user,
        payload={"operator_id": operator.id},
    )
    return _operator_out(operator)


@router.delete("/{int:operator_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_operator(request, operator_id: int):
    """Soft delete: l'operatrice resta in archivio (storico turni/vendite intatto)."""
    ctx = request.auth
    require_scope(ctx, "team")
    operator = salon_get(Operator, ctx, operator_id)
    operator.active = False
    operator.save(update_fields=["active"])
    log_activity(
        ctx.salon,
        "operator.deleted",
        f"Operatrice disattivata: {operator.first_name} {operator.last_name}",
        actor=ctx.user,
        payload={"operator_id": operator.id},
    )
    return OkOut()


# ---- Turni: sostituzione integrale del pattern ---------------------------------


@router.put("/{int:operator_id}/shifts", auth=staff_auth, response=list[WeeklyShiftOut])
@business_operation
def replace_shifts(request, operator_id: int, data: ShiftsReplaceIn):
    ctx = request.auth
    require_scope(ctx, "team")
    operator = salon_get(Operator, ctx, operator_id)
    for row in data.shifts:
        _validate_shift_row(operator, row)
    with transaction.atomic():
        operator.shifts.all().delete()
        shifts = WeeklyShift.objects.bulk_create(
            [
                WeeklyShift(
                    operator=operator,
                    week_index=row.week_index,
                    weekday=row.weekday,
                    start_min=row.start_min,
                    end_min=row.end_min,
                    break_start_min=row.break_start_min,
                    break_end_min=row.break_end_min,
                )
                for row in data.shifts
            ]
        )
    log_activity(
        ctx.salon,
        "operator.shifts_updated",
        f"Turni aggiornati per {operator.first_name} {operator.last_name}",
        actor=ctx.user,
        payload={"operator_id": operator.id, "shifts_count": len(shifts)},
    )
    return list(operator.shifts.all())


# ---- Assenze -----------------------------------------------------------------


@router.get("/{int:operator_id}/absences", auth=staff_auth, response=list[AbsenceOut])
def list_absences(request, operator_id: int):
    operator = salon_get(Operator, request.auth, operator_id)
    return operator.absences.all()


@router.post("/{int:operator_id}/absences", auth=staff_auth, response=AbsenceOut)
@business_operation
def create_absence(request, operator_id: int, data: AbsenceIn):
    ctx = request.auth
    require_scope(ctx, "team")
    operator = salon_get(Operator, ctx, operator_id)
    if data.type not in Absence.Type.values:
        raise HttpError(400, "Tipo di assenza non valido")
    if data.date_from > data.date_to:
        raise HttpError(400, "L'intervallo di assenza non è valido")
    absence = Absence.objects.create(operator=operator, **data.dict())
    log_activity(
        ctx.salon,
        "operator.absence_created",
        f"Assenza registrata per {operator.first_name} {operator.last_name}",
        actor=ctx.user,
        payload={"operator_id": operator.id, "absence_id": absence.id},
    )
    return absence


@router.put("/{int:operator_id}/absences/{int:absence_id}", auth=staff_auth, response=AbsenceOut)
@business_operation
def update_absence(request, operator_id: int, absence_id: int, data: AbsenceIn):
    ctx = request.auth
    require_scope(ctx, "team")
    operator = salon_get(Operator, ctx, operator_id)
    absence = operator.absences.filter(pk=absence_id).first()
    if absence is None:
        raise HttpError(404, "Assenza non trovata")
    if data.type not in Absence.Type.values:
        raise HttpError(400, "Tipo di assenza non valido")
    if data.date_from > data.date_to:
        raise HttpError(400, "L'intervallo di assenza non è valido")
    for name, value in data.dict().items():
        setattr(absence, name, value)
    absence.save()
    log_activity(
        ctx.salon,
        "operator.absence_updated",
        f"Assenza aggiornata per {operator.first_name} {operator.last_name}",
        actor=ctx.user,
        payload={"operator_id": operator.id, "absence_id": absence.id},
    )
    return absence


@router.delete("/{int:operator_id}/absences/{int:absence_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_absence(request, operator_id: int, absence_id: int):
    ctx = request.auth
    require_scope(ctx, "team")
    operator = salon_get(Operator, ctx, operator_id)
    absence = operator.absences.filter(pk=absence_id).first()
    if absence is None:
        raise HttpError(404, "Assenza non trovata")
    absence.delete()
    log_activity(
        ctx.salon,
        "operator.absence_deleted",
        f"Assenza eliminata per {operator.first_name} {operator.last_name}",
        actor=ctx.user,
        payload={"operator_id": operator.id},
    )
    return OkOut()


# ---- Performance e clienti serviti ---------------------------------------------


@router.get("/{int:operator_id}/performance", auth=staff_auth, response=list[PerformanceOut])
def get_performance(request, operator_id: int, months: int = 6):
    operator = salon_get(Operator, request.auth, operator_id)
    return performance_series(operator, months=months)


@router.get("/{int:operator_id}/clients", auth=staff_auth, response=list[ServedClientOut])
def get_served_clients(request, operator_id: int, q: str = ""):
    operator = salon_get(Operator, request.auth, operator_id)
    return served_clients(operator, q=q)


# ---- Endpoint pubblico (web app cliente, no auth) -------------------------------


@router.get("/public/operators", response=list[PublicOperatorOut])
def public_operators(request, salon: str):
    """Operatrici attive del salone, per la scelta dello stilista in prenotazione."""
    s = _get_salon_by_slug(salon)
    operators = (
        Operator.objects.filter(salon=s, active=True)
        .order_by("order", "id")
        .prefetch_related("services")
    )
    return [
        {
            "id": op.id,
            "first_name": op.first_name,
            "last_name": op.last_name,
            "initials": op.initials,
            "color": op.color,
            "service_ids": list(op.services.values_list("id", flat=True)),
        }
        for op in operators
    ]
