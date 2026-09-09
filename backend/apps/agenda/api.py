"""Endpoint agenda: viste giorno/settimana, appuntamenti, pause, waitlist,
disponibilità — sia per la dashboard staff sia per la web app cliente (/client/...).
"""

import datetime as dt
import json
from collections import Counter, defaultdict
from decimal import Decimal

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from ninja import Router
from ninja.errors import HttpError

from apps.core.models import Location, Salon
from apps.core.services import log_activity
from common.portal_access import business_operation
from common.auth import client_auth, staff_auth
from common.permissions import require_scope
from common.utils import salon_get

from . import services
from .models import Appointment, Pause, WaitlistEntry
from .schemas import (
    AppointmentCreateIn,
    AppointmentOut,
    AppointmentUpdateIn,
    ClientAppointmentCreateIn,
    ClientMoveIn,
    MarginOut,
    MoveIn,
    OkOut,
    PauseIn,
    PauseOut,
    ReasonIn,
    SlotOut,
    WaitlistIn,
    WaitlistOut,
)

router = Router(tags=["agenda"])


# ---- Helper ------------------------------------------------------------------


def _parse_day(value: str) -> dt.date:
    day = parse_date(value or "")
    if day is None:
        raise HttpError(400, "Data non valida (atteso YYYY-MM-DD)")
    return day


def _parse_items_param(raw: str) -> list[dict]:
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        raise HttpError(400, "Parametro items non valido")
    if not isinstance(data, list) or not data:
        raise HttpError(400, "Parametro items non valido")
    items = []
    for entry in data:
        if not isinstance(entry, dict) or "service_id" not in entry:
            raise HttpError(400, "Parametro items non valido")
        items.append(
            {"service_id": entry["service_id"], "operator_id": entry.get("operator_id")}
        )
    return items


def _fmt_min(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _operator_name(operator) -> str:
    return f"{operator.first_name} {operator.last_name}".strip()


def _item_out(item) -> dict:
    return {
        "id": item.id,
        "service_id": item.service_id,
        "service_name": item.service.name_it,
        "operator_id": item.operator_id,
        "operator_name": _operator_name(item.operator),
        "duration_min": item.duration_min,
        "soak_min": item.soak_min,
        "price": item.price,
        "order": item.order,
    }


def _appointment_out(appointment) -> dict:
    client = appointment.client
    return {
        "id": appointment.id,
        "client": {"id": client.id, "full_name": client.full_name, "phone": client.phone},
        "operator_id": appointment.operator_id,
        "location_id": appointment.location_id,
        "start": appointment.start,
        "end": appointment.end,
        "status": appointment.status,
        "deposit_status": appointment.deposit_status,
        "deposit_amount": appointment.deposit_amount,
        "total_duration_min": appointment.total_duration_min,
        "total_price": appointment.total_price,
        "note": appointment.note,
        "flexible": appointment.flexible,
        "created_via": appointment.created_via,
        "cancel_reason": appointment.cancel_reason,
        "cancelled_late": appointment.cancelled_late,
        "items": [_item_out(item) for item in appointment.items.all()],
    }


def _pause_out(pause) -> dict:
    return {
        "id": pause.id,
        "operator_id": pause.operator_id,
        "operator_name": _operator_name(pause.operator),
        "start": pause.start,
        "duration_min": pause.duration_min,
        "note": pause.note,
    }


def _waitlist_out(entry) -> dict:
    return {
        "id": entry.id,
        "client_id": entry.client_id,
        "client_name": entry.client.full_name,
        "service_id": entry.service_id,
        "service_name": entry.service.name_it,
        "operator_id": entry.operator_id,
        "operator_name": _operator_name(entry.operator) if entry.operator else None,
        "preference": entry.preference,
        "exact_days": entry.exact_days,
        "exact_time": entry.exact_time,
        "status": entry.status,
        "created_at": entry.created_at,
    }


def _get_location(ctx, location_id) -> Location | None:
    return salon_get(Location, ctx, location_id) if location_id else None


# ---- Viste agenda (staff) ----------------------------------------------------


@router.get("/day", auth=staff_auth)
def agenda_day(request, date: str, location_id: int = None):
    """Agenda del giorno: per ogni operatrice attiva turno, appuntamenti e pause."""
    ctx = request.auth
    day = _parse_day(date)

    from apps.staff.models import Operator  # lazy
    from apps.staff.services import shift_windows  # lazy

    operators = Operator.objects.filter(salon=ctx.salon, active=True).order_by(
        "order", "id"
    )
    if location_id:
        operators = operators.filter(Q(location__isnull=True) | Q(location_id=location_id))

    appointments = (
        Appointment.objects.filter(salon=ctx.salon, start__date=day)
        .exclude(status=Appointment.Status.CANCELLED)
        .select_related("client")
        .prefetch_related("items__service", "items__operator")
        .order_by("start")
    )
    if location_id:
        appointments = appointments.filter(location_id=location_id)
    pauses = (
        Pause.objects.filter(salon=ctx.salon, start__date=day)
        .select_related("operator")
        .order_by("start")
    )

    appointments_by_operator = defaultdict(list)
    for appointment in appointments:
        appointments_by_operator[appointment.operator_id].append(appointment)
    pauses_by_operator = defaultdict(list)
    for pause in pauses:
        pauses_by_operator[pause.operator_id].append(pause)

    return [
        {
            "operator": {
                "id": operator.id,
                "name": _operator_name(operator),
                "color": operator.color,
                "role_title": getattr(operator, "role_title", ""),
            },
            "windows": [
                [_fmt_min(start), _fmt_min(end)]
                for start, end in shift_windows(operator, day)
            ],
            "appointments": [
                _appointment_out(a) for a in appointments_by_operator.get(operator.id, [])
            ],
            "pauses": [_pause_out(p) for p in pauses_by_operator.get(operator.id, [])],
        }
        for operator in operators
    ]


@router.get("/week", auth=staff_auth)
def agenda_week(request, start: str):
    """Vista settimanale: per ogni giorno conteggi e appuntamenti compatti."""
    ctx = request.auth
    first_day = _parse_day(start)
    days = [first_day + dt.timedelta(days=offset) for offset in range(7)]

    appointments = (
        Appointment.objects.filter(
            salon=ctx.salon, start__date__gte=days[0], start__date__lte=days[-1]
        )
        .exclude(status=Appointment.Status.CANCELLED)
        .select_related("client")
        .prefetch_related("items")
        .order_by("start")
    )
    by_day = defaultdict(list)
    for appointment in appointments:
        by_day[timezone.localtime(appointment.start).date()].append(appointment)

    result = []
    for day in days:
        day_appointments = by_day.get(day, [])
        result.append(
            {
                "date": day.isoformat(),
                "count": len(day_appointments),
                "by_status": dict(Counter(a.status for a in day_appointments)),
                "appointments": [
                    {
                        "id": a.id,
                        "start": a.start,
                        "client_name": a.client.full_name,
                        "operator_id": a.operator_id,
                        "status": a.status,
                        "duration_min": a.total_duration_min,
                        "total_price": a.total_price,
                    }
                    for a in day_appointments
                ],
            }
        )
    return result


# ---- Appuntamenti (staff) ------------------------------------------------------


@router.post("/appointments", auth=staff_auth, response=AppointmentOut)
@business_operation
def create_appointment(request, data: AppointmentCreateIn):
    ctx = request.auth
    require_scope(ctx, "agenda")

    from apps.clients.models import Client  # lazy

    client = salon_get(Client, ctx, data.client_id, is_active=True)
    appointment = services.create_appointment(
        ctx.salon,
        client,
        [item.dict() for item in data.items],
        data.start,
        via=Appointment.CreatedVia.DASHBOARD,
        actor=ctx.user,
        flexible=data.flexible,
        note=data.note,
        location=_get_location(ctx, data.location_id),
    )
    return _appointment_out(appointment)


@router.post("/appointments/{int:appointment_id}/move", auth=staff_auth, response=AppointmentOut)
@business_operation
def move_appointment(request, appointment_id: int, data: MoveIn):
    ctx = request.auth
    require_scope(ctx, "agenda")
    appointment = salon_get(Appointment, ctx, appointment_id)

    operator = None
    if data.operator_id:
        from apps.staff.models import Operator  # lazy

        operator = salon_get(Operator, ctx, data.operator_id, active=True)
    appointment = services.move_appointment(
        appointment, data.start, operator=operator, actor=ctx.user
    )
    return _appointment_out(appointment)


@router.post("/appointments/{int:appointment_id}/check-in", auth=staff_auth, response=AppointmentOut)
@business_operation
def check_in_appointment(request, appointment_id: int):
    ctx = request.auth
    require_scope(ctx, "agenda")
    appointment = salon_get(Appointment, ctx, appointment_id)
    return _appointment_out(services.check_in(appointment, actor=ctx.user))


@router.post("/appointments/{int:appointment_id}/start", auth=staff_auth, response=AppointmentOut)
@business_operation
def start_appointment(request, appointment_id: int):
    ctx = request.auth
    require_scope(ctx, "agenda")
    appointment = salon_get(Appointment, ctx, appointment_id)
    return _appointment_out(services.start_appointment(appointment, actor=ctx.user))


@router.post("/appointments/{int:appointment_id}/no-show", auth=staff_auth, response=AppointmentOut)
@business_operation
def no_show_appointment(request, appointment_id: int, data: ReasonIn):
    ctx = request.auth
    require_scope(ctx, "agenda")
    appointment = salon_get(Appointment, ctx, appointment_id)
    return _appointment_out(
        services.mark_no_show(appointment, reason=data.reason, actor=ctx.user)
    )


@router.post("/appointments/{int:appointment_id}/cancel", auth=staff_auth, response=AppointmentOut)
@business_operation
def cancel_appointment(request, appointment_id: int, data: ReasonIn):
    ctx = request.auth
    require_scope(ctx, "agenda")
    appointment = salon_get(Appointment, ctx, appointment_id)
    return _appointment_out(
        services.cancel_appointment(appointment, reason=data.reason, actor=ctx.user)
    )


@router.put("/appointments/{int:appointment_id}", auth=staff_auth, response=AppointmentOut)
@business_operation
def update_appointment(request, appointment_id: int, data: AppointmentUpdateIn):
    """Modifica trattamenti e/o nota dell'appuntamento.

    `items` (se presente) è la lista COMPLETA dei servizi desiderati a partire
    da `appointment.start`: aggiungere un servizio = includere una voce senza
    `id`, rimuoverne uno = ometterlo. Ogni voce può forzare `duration_min`
    (int positivo); se assente/0/negativo si usa la durata di listino. Prezzo e
    idoneità operatrice restano dallo snapshot di listino. Il deposito NON viene
    ricalcolato qui.
    """
    ctx = request.auth
    require_scope(ctx, "agenda")
    appointment = salon_get(Appointment, ctx, appointment_id)
    if appointment.status not in services.OPEN_STATUSES:
        raise HttpError(400, "Appuntamento non modificabile nello stato attuale")

    if data.note is not None:
        appointment.note = data.note
    if data.items is not None:
        if not data.items:
            raise HttpError(400, "Nessun servizio selezionato")
        resolved = services.resolve_items_edit(
            ctx.salon,
            [item.dict() for item in data.items],
            appointment.start,
            exclude_appointment_id=appointment.id,
            location=appointment.location,
        )
        appointment.items.all().delete()
        services.snapshot_items_edit(appointment, resolved)
        appointment.operator = resolved[0][1]
    appointment.save()

    log_activity(
        ctx.salon,
        "appointment.updated",
        f"Appuntamento di {appointment.client.full_name} aggiornato",
        actor=ctx.user,
        payload={"appointment_id": appointment.id},
    )
    return _appointment_out(appointment)


@router.get("/appointments/{int:appointment_id}/margin", auth=staff_auth, response=MarginOut)
def appointment_margin(request, appointment_id: int):
    """Stima margine: ricavi meno costi fornitore/prodotto (listino corrente) e manodopera."""
    ctx = request.auth
    appointment = salon_get(Appointment, ctx, appointment_id)

    revenue = supplier_cost = product_cost = labor_cost = Decimal("0")
    for item in appointment.items.select_related("service", "operator"):
        revenue += item.price
        supplier_cost += item.service.supplier_cost
        product_cost += item.service.product_cost
        labor_cost += Decimal(item.duration_min) / Decimal("60") * item.operator.hourly_cost
    labor_cost = labor_cost.quantize(Decimal("0.01"))
    margin = revenue - supplier_cost - product_cost - labor_cost
    margin_pct = (
        (margin / revenue * Decimal("100")).quantize(Decimal("0.1"))
        if revenue
        else Decimal("0")
    )
    return {
        "revenue": revenue,
        "supplier_cost": supplier_cost,
        "product_cost": product_cost,
        "labor_cost": labor_cost,
        "margin": margin,
        "margin_pct": margin_pct,
    }


# Registrato DOPO le rotte con suffisso letterale (/move, /check-in, .../margin)
# così non le oscura: tutte usano il converter {int:...} e Ninja matcha per
# ordine di registrazione.
@router.get("/appointments/{int:appointment_id}", auth=staff_auth, response=AppointmentOut)
def get_appointment(request, appointment_id: int):
    ctx = request.auth
    appointment = salon_get(Appointment, ctx, appointment_id)
    return _appointment_out(appointment)


# ---- Pause (staff) -------------------------------------------------------------


@router.get("/pauses", auth=staff_auth, response=list[PauseOut])
def list_pauses(request, date: str = "", operator_id: int = None):
    ctx = request.auth
    pauses = Pause.objects.filter(salon=ctx.salon).select_related("operator")
    if date:
        pauses = pauses.filter(start__date=_parse_day(date))
    if operator_id:
        pauses = pauses.filter(operator_id=operator_id)
    return [_pause_out(p) for p in pauses.order_by("start")]


@router.post("/pauses", auth=staff_auth, response=PauseOut)
@business_operation
def create_pause(request, data: PauseIn):
    ctx = request.auth
    require_scope(ctx, "agenda")

    from apps.staff.models import Operator  # lazy

    operator = salon_get(Operator, ctx, data.operator_id)
    pause = Pause.objects.create(
        salon=ctx.salon,
        operator=operator,
        start=data.start,
        duration_min=data.duration_min,
        note=data.note,
    )
    log_activity(
        ctx.salon,
        "pause.created",
        f"Pausa per {_operator_name(operator)}",
        actor=ctx.user,
        payload={"pause_id": pause.id, "start": pause.start.isoformat()},
    )
    return _pause_out(pause)


@router.put("/pauses/{int:pause_id}", auth=staff_auth, response=PauseOut)
@business_operation
def update_pause(request, pause_id: int, data: PauseIn):
    ctx = request.auth
    require_scope(ctx, "agenda")
    pause = salon_get(Pause, ctx, pause_id)

    from apps.staff.models import Operator  # lazy

    pause.operator = salon_get(Operator, ctx, data.operator_id)
    pause.start = data.start
    pause.duration_min = data.duration_min
    pause.note = data.note
    pause.save()
    return _pause_out(pause)


@router.delete("/pauses/{int:pause_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_pause(request, pause_id: int):
    ctx = request.auth
    require_scope(ctx, "agenda")
    salon_get(Pause, ctx, pause_id).delete()
    return OkOut()


# ---- Lista d'attesa (staff) ------------------------------------------------------


@router.get("/waitlist", auth=staff_auth, response=list[WaitlistOut])
def list_waitlist(request):
    ctx = request.auth
    require_scope(ctx, "agenda")
    entries = (
        WaitlistEntry.objects.filter(salon=ctx.salon, status=WaitlistEntry.Status.ACTIVE)
        .select_related("client", "service", "operator")
        .order_by("created_at")
    )
    return [_waitlist_out(e) for e in entries]


@router.post("/waitlist/{int:entry_id}/contacted", auth=staff_auth, response=WaitlistOut)
@business_operation
def waitlist_contacted(request, entry_id: int):
    ctx = request.auth
    require_scope(ctx, "agenda")
    entry = salon_get(WaitlistEntry, ctx, entry_id)
    entry.status = WaitlistEntry.Status.CONTACTED
    entry.save(update_fields=["status"])
    log_activity(
        ctx.salon,
        "waitlist.contacted",
        f"{entry.client.full_name} contattata dalla lista d'attesa",
        actor=ctx.user,
        payload={"entry_id": entry.id},
    )
    return _waitlist_out(entry)


# ---- Disponibilità (staff) -------------------------------------------------------


@router.get("/availability", auth=staff_auth, response=list[SlotOut])
def availability(request, date: str, items: str, location_id: int = None):
    ctx = request.auth
    return services.get_free_slots(
        ctx.salon,
        _parse_day(date),
        _parse_items_param(items),
        location=_get_location(ctx, location_id),
    )


# ---- Endpoint app cliente --------------------------------------------------------


def _client_policy_ok(appointment) -> bool:
    return appointment.start - timezone.now() >= dt.timedelta(
        hours=settings.CLIENT_MOVE_CANCEL_MIN_HOURS
    )


def _client_appointment_out(appointment) -> dict:
    return {
        "id": appointment.id,
        "start": appointment.start,
        "end": appointment.end,
        "status": appointment.status,
        "operator": {
            "id": appointment.operator_id,
            "name": _operator_name(appointment.operator),
        },
        "services": [
            {
                "service_id": item.service_id,
                "name": item.service.name_it,
                "duration_min": item.duration_min,
                "price": item.price,
            }
            for item in appointment.items.all()
        ],
        "total_price": appointment.total_price,
        "deposit_status": appointment.deposit_status,
        "deposit_amount": appointment.deposit_amount,
    }


@router.get("/client/appointments", auth=client_auth)
def client_appointments(request):
    """Appuntamenti del cliente: futuri (attivi) e passati, in forma compatta."""
    ctx = request.auth
    now = timezone.now()
    appointments = (
        Appointment.objects.filter(salon=ctx.salon, client=ctx.client)
        .select_related("operator")
        .prefetch_related("items__service")
        .order_by("start")
    )
    upcoming = [
        _client_appointment_out(a)
        for a in appointments
        if a.start >= now and a.status in services.OPEN_STATUSES
    ]
    past = [
        _client_appointment_out(a)
        for a in reversed(list(appointments))
        if a.start < now or a.status not in services.OPEN_STATUSES
    ]
    return {"upcoming": upcoming, "past": past}


@router.get("/client/availability", auth=client_auth, response=list[SlotOut])
def client_availability(request, date: str, items: str):
    ctx = request.auth
    return services.get_free_slots(ctx.salon, _parse_day(date), _parse_items_param(items))


@router.get("/public/availability", response=list[SlotOut])
def public_availability(request, salon: str, date: str, items: str):
    """Disponibilità pubblica (no auth): solo orari liberi, salone per slug."""
    try:
        s = Salon.objects.get(slug=salon)
    except Salon.DoesNotExist:
        raise HttpError(404, "Salone non trovato")
    return services.get_free_slots(s, _parse_day(date), _parse_items_param(items))


@router.post("/client/appointments", auth=client_auth, response=AppointmentOut)
@business_operation
def client_create_appointment(request, data: ClientAppointmentCreateIn):
    ctx = request.auth
    appointment = services.create_appointment(
        ctx.salon,
        ctx.client,
        [item.dict() for item in data.items],
        data.start,
        via=Appointment.CreatedVia.APP,
    )
    return _appointment_out(appointment)


@router.post("/client/appointments/{int:appointment_id}/move", auth=client_auth, response=AppointmentOut)
@business_operation
def client_move_appointment(request, appointment_id: int, data: ClientMoveIn):
    ctx = request.auth
    appointment = salon_get(Appointment, ctx, appointment_id, client=ctx.client)
    if not _client_policy_ok(appointment):
        raise HttpError(
            400,
            "Spostamento non consentito a meno di "
            f"{settings.CLIENT_MOVE_CANCEL_MIN_HOURS} ore dall'appuntamento: "
            "contatta il salone",
        )
    appointment = services.move_appointment(appointment, data.start)
    return _appointment_out(appointment)


@router.post("/client/appointments/{int:appointment_id}/cancel", auth=client_auth, response=AppointmentOut)
@business_operation
def client_cancel_appointment(request, appointment_id: int):
    ctx = request.auth
    appointment = salon_get(Appointment, ctx, appointment_id, client=ctx.client)
    if not _client_policy_ok(appointment):
        raise HttpError(400, "Annullamento non consentito: contatta il salone")
    return _appointment_out(services.cancel_appointment(appointment))


@router.get("/client/waitlist", auth=client_auth, response=list[WaitlistOut])
def client_list_waitlist(request):
    ctx = request.auth
    entries = (
        WaitlistEntry.objects.filter(
            salon=ctx.salon,
            client=ctx.client,
            status__in=[WaitlistEntry.Status.ACTIVE, WaitlistEntry.Status.CONTACTED],
        )
        .select_related("client", "service", "operator")
        .order_by("created_at")
    )
    return [_waitlist_out(e) for e in entries]


@router.post("/client/waitlist", auth=client_auth, response=WaitlistOut)
@business_operation
def client_create_waitlist(request, data: WaitlistIn):
    ctx = request.auth

    from apps.catalog.models import Service  # lazy

    service = salon_get(Service, ctx, data.service_id, active=True)
    operator = None
    if data.operator_id:
        from apps.staff.models import Operator  # lazy

        operator = salon_get(Operator, ctx, data.operator_id, active=True)
    if data.preference not in WaitlistEntry.Preference.values:
        raise HttpError(400, "Preferenza non valida")
    if any(not isinstance(d, int) or d < 0 or d > 6 for d in data.exact_days):
        raise HttpError(400, "Giorni non validi (attesi 0=lunedì … 6=domenica)")

    entry = WaitlistEntry.objects.create(
        salon=ctx.salon,
        client=ctx.client,
        service=service,
        operator=operator,
        preference=data.preference,
        exact_days=data.exact_days,
        exact_time=data.exact_time,
    )
    log_activity(
        ctx.salon,
        "waitlist.created",
        f"{ctx.client.full_name} in lista d'attesa per {service.name_it}",
        payload={"entry_id": entry.id},
    )
    return _waitlist_out(entry)


@router.delete("/client/waitlist/{int:entry_id}", auth=client_auth, response=OkOut)
@business_operation
def client_delete_waitlist(request, entry_id: int):
    ctx = request.auth
    entry = salon_get(WaitlistEntry, ctx, entry_id, client=ctx.client)
    entry.delete()
    return OkOut()
