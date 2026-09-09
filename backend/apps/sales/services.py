"""Logica vendite: `finalize_sale` condiviso da checkout e POS + riepilogo di giornata.

Le integrazioni cross-app (magazzino, gift card, fedeltà) sono importate lazy
dentro le funzioni, come da convenzione SPEC §1: le firme di riferimento sono

    inventory.services.deduct_stock_for_sale(sale)
    marketing.services.redeem_gift_card(salon, code, amount)
    marketing.services.create_gift_card(salon, value, *, buyer_client=None,
        recipient_name="", paid=False, paid_method="", sold_by=None, sale=None)
    marketing.services.accrue_loyalty(sale)
"""

from common.portal_access import require_portal_access

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from ninja.errors import HttpError

from apps.core.services import log_activity

from .models import Payment, Sale, SaleLine

TWO_PLACES = Decimal("0.01")
PAYMENT_TOLERANCE = Decimal("0.01")


def line_amount(qty, unit_price, discount_pct: int = 0, is_gift: bool = False) -> Decimal:
    """Importo riga: qty × unit_price × (1 − discount/100); 0 se omaggio."""
    if is_gift:
        return Decimal("0.00")
    gross = Decimal(qty) * Decimal(str(unit_price))
    if discount_pct:
        gross = gross * (Decimal(100) - Decimal(discount_pct)) / Decimal(100)
    return gross.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def _prepare_lines(blocks: list[dict]) -> tuple[list[dict], Decimal]:
    """Normalizza i blocchi {operator_id, lines} in righe piatte e calcola il totale."""
    prepared: list[dict] = []
    total = Decimal("0.00")
    for block in blocks:
        operator_id = block.get("operator_id")
        for raw in block.get("lines") or []:
            line_type = raw.get("line_type")
            if line_type not in SaleLine.LineType.values:
                raise HttpError(422, "Tipo di riga non valido")
            unit_price = raw.get("unit_price")
            # vendita gift card dal POS: il valore della card è il prezzo unitario
            if line_type == SaleLine.LineType.GIFT_CARD and raw.get("value") is not None:
                unit_price = raw["value"]
            if unit_price is None:
                raise HttpError(422, "Prezzo mancante su una riga di vendita")
            qty = int(raw.get("qty") or 1)
            discount_pct = int(raw.get("discount_pct") or 0)
            is_gift = bool(raw.get("is_gift"))
            amount = line_amount(qty, unit_price, discount_pct, is_gift)
            prepared.append(
                {
                    "operator_id": operator_id,
                    "line_type": line_type,
                    "service_id": raw.get("service_id"),
                    "product_id": raw.get("product_id"),
                    "qty": qty,
                    "unit_price": Decimal(str(unit_price)).quantize(TWO_PLACES),
                    "discount_pct": discount_pct,
                    "is_gift": is_gift,
                    "amount": amount,
                    "recipient_name": raw.get("recipient_name") or "",
                }
            )
            total += amount
    return prepared, total


def finalize_sale(
    salon,
    *,
    kind: str,
    blocks: list[dict],
    payments: list[dict],
    client=None,
    appointment=None,
    location=None,
    deposit_deducted=Decimal("0.00"),
    actor=None,
) -> Sale:
    """Core condiviso checkout/POS: valida, crea Sale/righe/pagamenti e integra le altre app.

    blocks   = [{"operator_id": int|None, "lines": [{line_type, service_id?, product_id?,
                 qty, unit_price, discount_pct?, is_gift?, value?, recipient_name?}]}]
    payments = [{"method": cash|card|other|gift_card, "amount": Decimal, "gift_card_code"?: str}]
    """
    require_portal_access(salon)
    deposit_deducted = Decimal(str(deposit_deducted or 0)).quantize(TWO_PLACES)

    prepared, total = _prepare_lines(blocks)
    if not prepared:
        raise HttpError(422, "Nessuna riga di vendita")

    for payment in payments:
        if payment.get("method") not in Payment.Method.values:
            raise HttpError(422, "Metodo di pagamento non valido")

    paid_total = sum(
        (Decimal(str(p.get("amount") or 0)) for p in payments), Decimal("0.00")
    )
    if abs(paid_total - (total - deposit_deducted)) > PAYMENT_TOLERANCE:
        raise HttpError(422, "I pagamenti non corrispondono al totale")

    first_method = payments[0].get("method", "") if payments else ""

    with transaction.atomic():
        sale = Sale.objects.create(
            salon=salon,
            location=location,
            kind=kind,
            appointment=appointment,
            client=client,
            total=total,
            deposit_deducted=deposit_deducted,
            created_by=actor,
        )

        has_products = False
        for data in prepared:
            line = SaleLine.objects.create(
                sale=sale,
                operator_id=data["operator_id"],
                line_type=data["line_type"],
                service_id=data["service_id"],
                product_id=data["product_id"],
                qty=data["qty"],
                unit_price=data["unit_price"],
                discount_pct=data["discount_pct"],
                is_gift=data["is_gift"],
                amount=data["amount"],
            )
            if data["line_type"] == SaleLine.LineType.PRODUCT:
                has_products = True
            if data["line_type"] == SaleLine.LineType.GIFT_CARD:
                from apps.marketing.services import create_gift_card  # lazy

                card = None
                for _ in range(data["qty"]):
                    card = create_gift_card(
                        salon,
                        data["unit_price"],
                        buyer_client=client,
                        recipient_name=data["recipient_name"],
                        paid=not data["is_gift"],
                        paid_method=first_method,
                        sold_by=actor,
                        sale=sale,
                    )
                if card is not None:
                    line.gift_card = card
                    line.save(update_fields=["gift_card"])

        for payment in payments:
            amount = Decimal(str(payment.get("amount") or 0)).quantize(TWO_PLACES)
            card = None
            if payment["method"] == Payment.Method.GIFT_CARD:
                code = (payment.get("gift_card_code") or "").strip()
                if not code:
                    raise HttpError(422, "Codice gift card mancante nel pagamento")
                from apps.marketing.services import redeem_gift_card  # lazy

                card = redeem_gift_card(salon, code, amount)
            Payment.objects.create(
                sale=sale, method=payment["method"], amount=amount, gift_card=card
            )

        if has_products:
            from apps.inventory.services import deduct_stock_for_sale  # lazy

            deduct_stock_for_sale(sale)

        from apps.marketing.services import accrue_loyalty  # lazy

        accrue_loyalty(sale)

        kind_label = "checkout" if kind == Sale.Kind.CHECKOUT else "POS"
        client_label = f" — {client.full_name}" if client else ""
        log_activity(
            salon,
            "sale.created",
            f"Vendita {kind_label} € {total}{client_label}",
            actor=actor,
            payload={
                "sale_id": sale.id,
                "kind": str(kind),
                "total": str(total),
                "deposit_deducted": str(deposit_deducted),
                "client_id": client.id if client else None,
                "appointment_id": appointment.id if appointment else None,
            },
        )
    return sale


def today_summary(salon) -> dict:
    """{total, count, checkout_total, pos_total} degli incassi di oggi (box agenda)."""
    zero = Decimal("0.00")
    qs = Sale.objects.filter(salon=salon, created_at__date=timezone.localdate())
    agg = qs.aggregate(total=Sum("total"), count=Count("id"))
    by_kind = dict(qs.values_list("kind").annotate(t=Sum("total")))
    return {
        "total": agg["total"] or zero,
        "count": agg["count"] or 0,
        "checkout_total": by_kind.get(Sale.Kind.CHECKOUT.value) or zero,
        "pos_total": by_kind.get(Sale.Kind.POS.value) or zero,
    }
