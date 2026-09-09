"""Endpoint vendite: checkout appuntamenti, POS, storico con KPI, Stripe.

I modelli delle altre app (agenda, clients) sono risolti lazy con
django.apps.get_model per evitare dipendenze di import a livello di modulo.
"""

from decimal import Decimal
from typing import Optional

from django.apps import apps as django_apps
from django.db.models import Count, Q, Sum
from django.utils.dateparse import parse_date
from ninja import Router
from ninja.errors import HttpError

from common.portal_access import business_operation
from common.auth import client_auth, staff_auth
from common.permissions import require_scope
from common.utils import salon_get

from apps.core.services import emit_event, log_activity

from . import stripe_service
from .models import Sale, SaleLine
from .schemas import (
    ChargeNoShowOut,
    CheckoutIn,
    CheckoutOut,
    OkOut,
    PosIn,
    SaleDetailOut,
    SaleListOut,
    SetupIntentOut,
    TodaySummaryOut,
)
from .services import finalize_sale, today_summary

router = Router(tags=["sales"])


# ---- Serializzazione ---------------------------------------------------------


def _operator_name(operator) -> str:
    if operator is None:
        return ""
    return f"{operator.first_name} {operator.last_name}".strip()


def _line_out(line: SaleLine) -> dict:
    return {
        "id": line.id,
        "line_type": line.line_type,
        "operator_id": line.operator_id,
        "operator_name": _operator_name(line.operator),
        "service_id": line.service_id,
        "product_id": line.product_id,
        "product_name": line.product.name if line.product_id else "",
        "gift_card_code": line.gift_card.code if line.gift_card_id else None,
        "qty": line.qty,
        "unit_price": line.unit_price,
        "discount_pct": line.discount_pct,
        "is_gift": line.is_gift,
        "amount": line.amount,
    }


def _payment_out(payment) -> dict:
    return {
        "id": payment.id,
        "method": payment.method,
        "amount": payment.amount,
        "gift_card_code": payment.gift_card.code if payment.gift_card_id else None,
    }


def _sale_out(sale: Sale) -> dict:
    return {
        "id": sale.id,
        "kind": sale.kind,
        "appointment_id": sale.appointment_id,
        "client_id": sale.client_id,
        "client_name": sale.client.full_name if sale.client_id else "",
        "location_id": sale.location_id,
        "total": sale.total,
        "deposit_deducted": sale.deposit_deducted,
        "created_at": sale.created_at,
    }


def _sale_detail(sale: Sale) -> dict:
    return {
        **_sale_out(sale),
        "lines": [_line_out(l) for l in sale.lines.select_related("operator", "gift_card", "product")],
        "payments": [_payment_out(p) for p in sale.payments.select_related("gift_card")],
    }


def _breakdown(sale: Sale) -> list[dict]:
    """Incassato per operatrice (righe senza operatrice raggruppate a parte)."""
    per_operator: dict = {}
    for line in sale.lines.select_related("operator"):
        entry = per_operator.setdefault(
            line.operator_id,
            {
                "operator_id": line.operator_id,
                "operator_name": _operator_name(line.operator) or "Senza operatrice",
                "amount": Decimal("0.00"),
            },
        )
        entry["amount"] += line.amount
    return list(per_operator.values())


# ---- Checkout e POS ----------------------------------------------------------


@router.post("/checkout/{int:appointment_id}", auth=staff_auth, response=CheckoutOut)
@business_operation
def checkout(request, appointment_id: int, data: CheckoutIn):
    ctx = request.auth
    require_scope(ctx, "sales")
    Appointment = django_apps.get_model("agenda", "Appointment")
    appointment = salon_get(Appointment, ctx, appointment_id)
    if Sale.objects.filter(appointment=appointment).exists():
        raise HttpError(400, "Appuntamento già incassato")

    deposit_deducted = (
        appointment.deposit_amount
        if appointment.deposit_status == "paid"
        else Decimal("0.00")
    )
    payload = data.dict()
    sale = finalize_sale(
        ctx.salon,
        kind=Sale.Kind.CHECKOUT,
        blocks=payload["blocks"],
        payments=payload["payments"],
        client=appointment.client,
        appointment=appointment,
        location=appointment.location,
        deposit_deducted=deposit_deducted,
        actor=ctx.user,
    )

    appointment.status = "closed"
    appointment.save()

    client = appointment.client
    service_names = [
        line.service.name_it
        for line in sale.lines.select_related("service")
        if line.service_id
    ]
    emit_event(
        ctx.salon,
        "visit.completed",
        {
            "appointment_id": appointment.id,
            "sale_id": sale.id,
            "client_id": client.id,
            "client_name": client.full_name,
            "phone": client.phone,
            "lang": client.lang,
            "services": service_names,
            "total": str(sale.total),
        },
    )
    return {"sale": _sale_detail(sale), "breakdown": _breakdown(sale)}


@router.post("/pos", auth=staff_auth, response=SaleDetailOut)
@business_operation
def pos_sale(request, data: PosIn):
    ctx = request.auth
    require_scope(ctx, "sales")
    client = None
    if data.client_id:
        Client = django_apps.get_model("clients", "Client")
        client = salon_get(Client, ctx, data.client_id)
    payload = data.dict()
    sale = finalize_sale(
        ctx.salon,
        kind=Sale.Kind.POS,
        blocks=payload["blocks"],
        payments=payload["payments"],
        client=client,
        actor=ctx.user,
    )
    return _sale_detail(sale)


# ---- Storico e riepiloghi ----------------------------------------------------


@router.get("/", auth=staff_auth, response=SaleListOut)
def list_sales(
    request,
    kind: str = "",
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    client_id: Optional[int] = None,
    operator_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
):
    """Storico vendite con KPI {revenue, count, items_count} sul filtro corrente."""
    ctx = request.auth
    require_scope(ctx, "sales")
    qs = Sale.objects.filter(salon=ctx.salon)
    if kind:
        qs = qs.filter(kind=kind)
    if date_from and (d := parse_date(date_from)):
        qs = qs.filter(created_at__date__gte=d)
    if date_to and (d := parse_date(date_to)):
        qs = qs.filter(created_at__date__lte=d)
    if q:
        qs = qs.filter(
            Q(client__first_name__icontains=q) | Q(client__last_name__icontains=q)
        )
    if client_id:
        qs = qs.filter(client_id=client_id)
    if operator_id:
        qs = qs.filter(lines__operator_id=operator_id)

    base = Sale.objects.filter(pk__in=qs.values("pk"))  # evita duplicati da join
    agg = base.aggregate(revenue=Sum("total"), count=Count("id"))
    items_count = (
        SaleLine.objects.filter(sale__in=base).aggregate(n=Sum("qty"))["n"] or 0
    )
    items = base.select_related("client").order_by("-created_at")[offset : offset + limit]
    return {
        "count": agg["count"] or 0,
        "kpi": {
            "revenue": (agg["revenue"] or Decimal("0.00")).quantize(Decimal("0.01")),
            "count": agg["count"] or 0,
            "items_count": items_count,
        },
        "items": [_sale_out(s) for s in items],
    }


@router.get("/today-summary", auth=staff_auth, response=TodaySummaryOut)
def get_today_summary(request):
    return today_summary(request.auth.salon)


@router.get("/{int:sale_id}", auth=staff_auth, response=SaleDetailOut)
def sale_detail(request, sale_id: int):
    sale = salon_get(Sale, request.auth, sale_id)
    return _sale_detail(sale)


# ---- Stripe ------------------------------------------------------------------


@router.post(
    "/appointments/{appointment_id}/charge-no-show",
    auth=staff_auth,
    response=ChargeNoShowOut,
)
@business_operation
def charge_no_show(request, appointment_id: int):
    ctx = request.auth
    require_scope(ctx, "sales")
    Appointment = django_apps.get_model("agenda", "Appointment")
    appointment = salon_get(Appointment, ctx, appointment_id)
    intent = stripe_service.charge_full_amount(appointment)
    amount = Decimal(str(appointment.total_price or 0))
    log_activity(
        ctx.salon,
        "sale.no_show_charged",
        f"Addebito no-show € {amount} — {appointment.client.full_name}",
        actor=ctx.user,
        payload={
            "appointment_id": appointment.id,
            "amount": str(amount),
            "payment_intent_id": intent["id"],
        },
    )
    return {"ok": True, "payment_intent_id": intent["id"], "amount": amount}


@router.post("/client/setup-intent", auth=client_auth, response=SetupIntentOut)
@business_operation
def client_setup_intent(request):
    intent = stripe_service.create_setup_intent(request.auth.client)
    return {"setup_intent_id": intent["id"], "client_secret": intent.get("client_secret")}


@router.post("/stripe/webhook", response=OkOut)
def stripe_webhook(request):
    event = stripe_service.verify_webhook(
        request.body, request.META.get("HTTP_STRIPE_SIGNATURE", "")
    )
    event_type = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    metadata = obj.get("metadata") or {}

    if event_type == "payment_intent.succeeded":
        appointment_id = metadata.get("appointment_id")
        if appointment_id:
            Appointment = django_apps.get_model("agenda", "Appointment")
            appointment = (
                Appointment.objects.select_related("salon", "client")
                .filter(pk=appointment_id)
                .first()
            )
            if appointment:
                appointment.deposit_status = "paid"
                appointment.save()
                log_activity(
                    appointment.salon,
                    "deposit.paid",
                    f"Acconto pagato — {appointment.client.full_name}",
                    payload={
                        "appointment_id": appointment.id,
                        "payment_intent_id": obj.get("id"),
                    },
                )

    elif event_type == "setup_intent.succeeded":
        client_id = metadata.get("client_id")
        payment_method = obj.get("payment_method") or ""
        if isinstance(payment_method, dict):
            payment_method = payment_method.get("id") or ""
        if client_id and payment_method:
            Client = django_apps.get_model("clients", "Client")
            client = Client.objects.select_related("salon").filter(pk=client_id).first()
            if client:
                client.stripe_payment_method_id = payment_method
                client.save(update_fields=["stripe_payment_method_id"])
                log_activity(
                    client.salon,
                    "client.card_saved",
                    f"Carta salvata — {client.full_name}",
                    payload={"client_id": client.id},
                )

    return {"ok": True}
