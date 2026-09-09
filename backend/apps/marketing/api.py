from decimal import Decimal
from typing import Optional

from django.apps import apps as django_apps
from django.db.models import DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError
from ninja.pagination import LimitOffsetPagination, paginate

from apps.core.services import log_activity
from common.portal_access import business_operation
from common.auth import client_auth, staff_auth
from common.permissions import require_scope
from common.utils import salon_get

from .models import Communication, Coupon, GiftCard, LoyaltyAccount, LoyaltyProgram
from .schemas import (
    ClientGiftCardIn,
    CommunicationIn,
    CommunicationOut,
    CommunicationSendIn,
    CouponIn,
    CouponOut,
    CouponRedeemIn,
    GiftCardIn,
    GiftCardListOut,
    GiftCardOut,
    LoyaltyAccountOut,
    LoyaltyProgramIn,
    LoyaltyProgramOut,
    MarkPaidIn,
    OkOut,
    WalletOut,
)
from .services import create_gift_card, send_communication, unique_code

router = Router(tags=["marketing"])

_ZERO = Value(Decimal("0"), output_field=DecimalField(max_digits=12, decimal_places=2))


def _get_client(ctx, client_id):
    Client = django_apps.get_model("clients", "Client")  # lazy: evita cicli
    return salon_get(Client, ctx, client_id)


# ---- Coupon ------------------------------------------------------------------


@router.get("/coupons", auth=staff_auth, response=list[CouponOut])
@paginate(LimitOffsetPagination)
def list_coupons(
    request,
    origin: str = "",
    status: str = "",
    q: str = "",
    client_id: Optional[int] = None,
):
    qs = Coupon.objects.filter(salon=request.auth.salon).select_related("client")
    if origin:
        qs = qs.filter(origin=origin)
    if status:
        qs = qs.filter(status=status)
    if q:
        qs = qs.filter(
            Q(code__icontains=q)
            | Q(client__first_name__icontains=q)
            | Q(client__last_name__icontains=q)
        )
    if client_id:
        qs = qs.filter(client_id=client_id)
    return qs


@router.post("/coupons", auth=staff_auth, response=CouponOut)
@business_operation
def create_coupon(request, data: CouponIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    if data.kind not in Coupon.Kind.values:
        raise HttpError(422, "Tipo coupon non valido")
    client = _get_client(ctx, data.client_id) if data.client_id else None
    coupon = Coupon.objects.create(
        salon=ctx.salon,
        client=client,
        code=unique_code(Coupon, ctx.salon, 8),
        kind=data.kind,
        value=data.value,
        origin=Coupon.Origin.MANUAL,
        expires_at=data.expires_at,
    )
    log_activity(
        ctx.salon,
        "coupon.created",
        f"Coupon {coupon.code} ({coupon.get_kind_display()} {coupon.value})",
        actor=ctx.user,
        payload={"coupon_id": coupon.id, "code": coupon.code},
    )
    return coupon


@router.put("/coupons/{int:coupon_id}", auth=staff_auth, response=CouponOut)
@business_operation
def update_coupon(request, coupon_id: int, data: CouponIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    coupon = salon_get(Coupon, ctx, coupon_id)
    if coupon.status != Coupon.Status.ACTIVE:
        raise HttpError(422, "Solo i coupon attivi sono modificabili")
    if data.kind not in Coupon.Kind.values:
        raise HttpError(422, "Tipo coupon non valido")
    coupon.client = _get_client(ctx, data.client_id) if data.client_id else None
    coupon.kind = data.kind
    coupon.value = data.value
    coupon.expires_at = data.expires_at
    coupon.save()
    log_activity(
        ctx.salon,
        "coupon.updated",
        f"Coupon {coupon.code} aggiornato",
        actor=ctx.user,
        payload={"coupon_id": coupon.id},
    )
    return coupon


@router.delete("/coupons/{int:coupon_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_coupon(request, coupon_id: int):
    ctx = request.auth
    require_scope(ctx, "marketing")
    coupon = salon_get(Coupon, ctx, coupon_id)
    log_activity(
        ctx.salon,
        "coupon.deleted",
        f"Coupon {coupon.code} eliminato",
        actor=ctx.user,
        payload={"coupon_id": coupon.id, "code": coupon.code},
    )
    coupon.delete()
    return OkOut()


@router.post("/coupons/{int:coupon_id}/redeem", auth=staff_auth, response=CouponOut)
@business_operation
def redeem_coupon(request, coupon_id: int, data: CouponRedeemIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    coupon = salon_get(Coupon, ctx, coupon_id)
    if coupon.status != Coupon.Status.ACTIVE:
        raise HttpError(422, "Coupon non più valido")
    if coupon.expires_at and coupon.expires_at < timezone.now():
        coupon.status = Coupon.Status.EXPIRED
        coupon.save(update_fields=["status"])
        raise HttpError(422, "Coupon scaduto")
    if data.sale_id:
        Sale = django_apps.get_model("sales", "Sale")  # lazy
        coupon.sale = salon_get(Sale, ctx, data.sale_id)
    coupon.status = Coupon.Status.REDEEMED
    coupon.redeemed_at = timezone.now()
    coupon.save()
    log_activity(
        ctx.salon,
        "coupon.redeemed",
        f"Coupon {coupon.code} utilizzato",
        actor=ctx.user,
        payload={"coupon_id": coupon.id, "sale_id": data.sale_id},
    )
    return coupon


# ---- Gift card ---------------------------------------------------------------


@router.get("/gift-cards", auth=staff_auth, response=GiftCardListOut)
def list_gift_cards(
    request,
    status: str = "",
    payment_status: str = "",
    q: str = "",
    client_id: Optional[int] = None,
):
    qs = GiftCard.objects.filter(salon=request.auth.salon).select_related("buyer_client")
    if status:
        qs = qs.filter(status=status)
    if payment_status:
        qs = qs.filter(payment_status=payment_status)
    if q:
        qs = qs.filter(
            Q(code__icontains=q)
            | Q(recipient_name__icontains=q)
            | Q(buyer_client__first_name__icontains=q)
            | Q(buyer_client__last_name__icontains=q)
        )
    if client_id:
        # il cliente può comparire come acquirente e/o destinatario della carta
        qs = qs.filter(Q(buyer_client_id=client_id) | Q(recipient_client_id=client_id))
    kpi = qs.aggregate(
        sold_total=Coalesce(Sum("initial_value"), _ZERO),
        redeemed_total=Coalesce(
            Sum(
                F("initial_value") - F("balance"),
                output_field=DecimalField(max_digits=12, decimal_places=2),
            ),
            _ZERO,
        ),
        outstanding=Coalesce(
            Sum("balance", filter=Q(status=GiftCard.Status.ACTIVE)), _ZERO
        ),
    )
    return {"kpi": kpi, "items": list(qs)}


@router.post("/gift-cards", auth=staff_auth, response=GiftCardOut)
@business_operation
def create_gift_card_staff(request, data: GiftCardIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    buyer = _get_client(ctx, data.buyer_client_id) if data.buyer_client_id else None
    # Gift card trattamento: il valore è (autoritativamente) il prezzo del servizio,
    # ignora l'eventuale `value` inviato. gift_service_id None => carta monetaria.
    gift_service = None
    value = data.value
    if data.gift_service_id:
        Service = django_apps.get_model("catalog", "Service")  # lazy
        gift_service = salon_get(Service, ctx, data.gift_service_id)
        value = gift_service.price
    card = create_gift_card(
        ctx.salon,
        value,
        gift_service=gift_service,
        buyer_client=buyer,
        recipient_name=data.recipient_name,
        paid=data.paid,
        paid_method=data.paid_method,
        sold_by=ctx.user,
    )
    extra = []
    if data.recipient_client_id:
        card.recipient_client = _get_client(ctx, data.recipient_client_id)
        extra.append("recipient_client")
    if data.delivery_date:
        card.delivery_date = data.delivery_date
        extra.append("delivery_date")
    if data.expires_at:
        card.expires_at = data.expires_at
        extra.append("expires_at")
    if extra:
        card.save(update_fields=extra)
    return card


@router.post("/gift-cards/{int:card_id}/mark-paid", auth=staff_auth, response=GiftCardOut)
@business_operation
def mark_gift_card_paid(request, card_id: int, data: MarkPaidIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    card = salon_get(GiftCard, ctx, card_id)
    if card.payment_status == GiftCard.PaymentStatus.PAID:
        raise HttpError(422, "Gift card già pagata")
    card.payment_status = GiftCard.PaymentStatus.PAID
    card.paid_at = timezone.now()
    card.paid_method = data.method
    card.save(update_fields=["payment_status", "paid_at", "paid_method"])
    log_activity(
        ctx.salon,
        "giftcard.paid",
        f"Incasso gift card {card.code}: €{card.initial_value} ({data.method})",
        actor=ctx.user,
        payload={"gift_card_id": card.id, "amount": str(card.initial_value), "method": data.method},
    )
    return card


# ---- Programmi fedeltà -------------------------------------------------------


@router.get("/loyalty-programs", auth=staff_auth, response=list[LoyaltyProgramOut])
def list_loyalty_programs(request, active: bool | None = None):
    qs = LoyaltyProgram.objects.filter(salon=request.auth.salon)
    if active is not None:
        qs = qs.filter(active=active)
    return qs


def _apply_program_data(program: LoyaltyProgram, ctx, data: LoyaltyProgramIn):
    if data.reward_service_id:
        Service = django_apps.get_model("catalog", "Service")  # lazy
        program.reward_service = salon_get(Service, ctx, data.reward_service_id)
    else:
        program.reward_service = None
    for name, value in data.dict(exclude={"reward_service_id"}).items():
        setattr(program, name, value)
    program.save()
    return program


@router.post("/loyalty-programs", auth=staff_auth, response=LoyaltyProgramOut)
@business_operation
def create_loyalty_program(request, data: LoyaltyProgramIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    program = _apply_program_data(LoyaltyProgram(salon=ctx.salon), ctx, data)
    log_activity(
        ctx.salon,
        "loyalty_program.created",
        f"Programma fedeltà «{program.name}»",
        actor=ctx.user,
        payload={"program_id": program.id},
    )
    return program


@router.put("/loyalty-programs/{int:program_id}", auth=staff_auth, response=LoyaltyProgramOut)
@business_operation
def update_loyalty_program(request, program_id: int, data: LoyaltyProgramIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    program = _apply_program_data(salon_get(LoyaltyProgram, ctx, program_id), ctx, data)
    log_activity(
        ctx.salon,
        "loyalty_program.updated",
        f"Programma fedeltà «{program.name}» aggiornato",
        actor=ctx.user,
        payload={"program_id": program.id},
    )
    return program


@router.delete("/loyalty-programs/{int:program_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_loyalty_program(request, program_id: int):
    """Disattivazione (soft): i saldi punti dei clienti restano consultabili."""
    ctx = request.auth
    require_scope(ctx, "marketing")
    program = salon_get(LoyaltyProgram, ctx, program_id)
    program.active = False
    program.save(update_fields=["active"])
    log_activity(
        ctx.salon,
        "loyalty_program.deleted",
        f"Programma fedeltà «{program.name}» disattivato",
        actor=ctx.user,
        payload={"program_id": program.id},
    )
    return OkOut()


@router.get(
    "/loyalty-programs/{program_id}/accounts",
    auth=staff_auth,
    response=list[LoyaltyAccountOut],
)
@paginate(LimitOffsetPagination)
def list_loyalty_accounts(request, program_id: int):
    program = salon_get(LoyaltyProgram, request.auth, program_id)
    return program.accounts.select_related("client")


# ---- Comunicazioni -----------------------------------------------------------


@router.get("/communications", auth=staff_auth, response=list[CommunicationOut])
@paginate(LimitOffsetPagination)
def list_communications(request, status: str = ""):
    qs = Communication.objects.filter(salon=request.auth.salon)
    if status:
        qs = qs.filter(status=status)
    return qs


@router.post("/communications", auth=staff_auth, response=CommunicationOut)
@business_operation
def create_communication(request, data: CommunicationIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    comm = Communication.objects.create(salon=ctx.salon, **data.dict())
    log_activity(
        ctx.salon,
        "communication.created",
        f"Comunicazione «{comm.title}»",
        actor=ctx.user,
        payload={"communication_id": comm.id},
    )
    return comm


@router.put("/communications/{int:comm_id}", auth=staff_auth, response=CommunicationOut)
@business_operation
def update_communication(request, comm_id: int, data: CommunicationIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    comm = salon_get(Communication, ctx, comm_id)
    if comm.status == Communication.Status.SENT:
        raise HttpError(422, "Comunicazione già inviata: non modificabile")
    for name, value in data.dict().items():
        setattr(comm, name, value)
    comm.save()
    log_activity(
        ctx.salon,
        "communication.updated",
        f"Comunicazione «{comm.title}» aggiornata",
        actor=ctx.user,
        payload={"communication_id": comm.id},
    )
    return comm


@router.delete("/communications/{int:comm_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_communication(request, comm_id: int):
    ctx = request.auth
    require_scope(ctx, "marketing")
    comm = salon_get(Communication, ctx, comm_id)
    log_activity(
        ctx.salon,
        "communication.deleted",
        f"Comunicazione «{comm.title}» eliminata",
        actor=ctx.user,
        payload={"communication_id": comm.id},
    )
    comm.delete()
    return OkOut()


@router.post("/communications/{int:comm_id}/send", auth=staff_auth, response=CommunicationOut)
@business_operation
def send_communication_endpoint(request, comm_id: int, data: CommunicationSendIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    comm = salon_get(Communication, ctx, comm_id)
    if comm.status == Communication.Status.SENT:
        raise HttpError(422, "Comunicazione già inviata")
    return send_communication(comm, scheduled_at=data.scheduled_at, actor=ctx.user)


# ---- Endpoint app cliente ----------------------------------------------------


@router.get("/client/wallet", auth=client_auth, response=WalletOut)
def client_wallet(request):
    ctx = request.auth
    now = timezone.now()
    cards = (
        GiftCard.objects.filter(salon=ctx.salon, status=GiftCard.Status.ACTIVE)
        .filter(Q(buyer_client=ctx.client) | Q(recipient_client=ctx.client))
        .order_by("-created_at")
    )
    coupons = (
        Coupon.objects.filter(
            salon=ctx.salon, client=ctx.client, status=Coupon.Status.ACTIVE
        )
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gte=now))
        .order_by("-created_at")
    )
    loyalty = []
    accounts = LoyaltyAccount.objects.filter(
        client=ctx.client, program__salon=ctx.salon, program__active=True
    ).select_related("program")
    for account in accounts:
        program = account.program
        progress = (
            min(100, int(account.points * 100 / program.threshold))
            if program.threshold
            else 0
        )
        loyalty.append(
            {
                "program_id": program.id,
                "program_name": program.name,
                "type": program.type,
                "color": program.color,
                "points": account.points,
                "threshold": program.threshold,
                "progress_pct": progress,
            }
        )
    return {"gift_cards": list(cards), "coupons": list(coupons), "loyalty": loyalty}


@router.post("/client/gift-cards", auth=client_auth, response=GiftCardOut)
@business_operation
def client_create_gift_card(request, data: ClientGiftCardIn):
    """Acquisto gift card dall'app: nasce unpaid, pagamento in salone
    (Stripe checkout in fase 2)."""
    ctx = request.auth
    return create_gift_card(
        ctx.salon,
        data.value,
        buyer_client=ctx.client,
        recipient_name=data.recipient_name,
        paid=False,
    )
