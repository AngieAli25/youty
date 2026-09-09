"""Logica di magazzino. INTEGRITÀ: ogni variazione di stock passa da `apply_movement`.

`Product.stock_qty` è denormalizzata: nessun endpoint o servizio la scrive
direttamente; si crea sempre uno `StockMovement` e lo stock viene aggiornato
atomicamente con `F()` sotto `select_for_update`.
"""

from common.portal_access import require_portal_access

from decimal import Decimal

from django.db import transaction
from django.db.models import F
from ninja.errors import HttpError

from .models import Product, PurchaseOrder, PurchaseOrderLine, StockMovement


def apply_movement(
    product,
    kind,
    qty,
    *,
    reason="",
    sale=None,
    order=None,
    author=None,
    operator=None,
    invoice=None,
):
    """UNICA porta di variazione dello stock.

    qty positiva = carico, negativa = scarico. Per gli scarichi vieta lo stock
    negativo (HttpError 422 "Giacenza insufficiente"). Ritorna lo StockMovement
    creato; `product.stock_qty` viene ricaricata dal DB.
    """
    require_portal_access(product.salon)
    qty = Decimal(str(qty))
    if qty == 0:
        raise HttpError(422, "La quantità non può essere zero")
    with transaction.atomic():
        locked = Product.objects.select_for_update().get(pk=product.pk)
        if qty < 0 and locked.stock_qty + qty < 0:
            raise HttpError(422, "Giacenza insufficiente")
        movement = StockMovement.objects.create(
            salon_id=locked.salon_id,
            product=locked,
            kind=kind,
            qty=qty,
            reason=reason,
            sale=sale,
            order=order,
            author=author if (author is not None and getattr(author, "pk", None)) else None,
            operator=operator if (operator is not None and getattr(operator, "pk", None)) else None,
            invoice=invoice,
        )
        Product.objects.filter(pk=locked.pk).update(stock_qty=F("stock_qty") + qty)
    product.refresh_from_db(fields=["stock_qty"])
    return movement


def deduct_stock_for_sale(sale):
    """Scarica lo stock per ogni riga prodotto della vendita.

    Anche le righe omaggio (is_gift=True) scalano la giacenza: il prodotto
    esce comunque dal magazzino.
    """
    require_portal_access(sale.salon)
    movements = []
    lines = sale.lines.filter(line_type="product", product__isnull=False).select_related("product")
    for line in lines:
        movements.append(
            apply_movement(
                line.product,
                kind=StockMovement.Kind.SALE,
                qty=-Decimal(line.qty),
                reason="Vendita" + (" (omaggio)" if line.is_gift else ""),
                sale=sale,
                author=getattr(sale, "created_by", None),
            )
        )
    return movements


def generate_draft_orders(salon, author=None):
    """Bozze d'ordine per i prodotti attivi sotto soglia, raggruppate per fornitore.

    Esclude i prodotti già presenti in ordini draft/sent. Quantità proposta:
    `reorder_qty`, oppure `min_threshold − stock_qty` se reorder_qty è 0.
    Se esiste già una bozza per il fornitore, le righe vengono aggiunte lì.
    Ritorna la lista degli ordini creati/aggiornati.
    """
    require_portal_access(salon)
    products = (
        Product.objects.filter(salon=salon, active=True, stock_qty__lte=F("min_threshold"))
        .exclude(
            order_lines__order__status__in=[
                PurchaseOrder.Status.DRAFT,
                PurchaseOrder.Status.SENT,
            ]
        )
        .select_related("supplier")
        .order_by("supplier_id", "name")
    )
    orders: list[PurchaseOrder] = []
    by_supplier: dict[int, PurchaseOrder] = {}
    with transaction.atomic():
        for product in products:
            qty = product.reorder_qty or (product.min_threshold - product.stock_qty)
            if qty <= 0:
                continue
            order = by_supplier.get(product.supplier_id)
            if order is None:
                order = PurchaseOrder.objects.filter(
                    salon=salon,
                    supplier_id=product.supplier_id,
                    status=PurchaseOrder.Status.DRAFT,
                ).first()
                if order is None:
                    order = PurchaseOrder.objects.create(
                        salon=salon, supplier_id=product.supplier_id
                    )
                by_supplier[product.supplier_id] = order
                orders.append(order)
            PurchaseOrderLine.objects.create(order=order, product=product, qty_ordered=qty)
    return orders


def receive_order(order, lines_data, author=None):
    """Registra la ricezione di un ordine: un movimento `load` per ogni riga.

    `lines_data`: iterable di {"id": line_id, "qty_received": Decimal}.
    Le righe non incluse restano a qty_received=0 (discrepanza).
    Stato finale: received se tutte le righe combaciano, altrimenti partial.
    Ritorna (order, discrepancies).
    """
    require_portal_access(order.salon)
    if order.status in (PurchaseOrder.Status.RECEIVED, PurchaseOrder.Status.PARTIAL):
        raise HttpError(400, "Ordine già ricevuto")
    received_by_id = {int(row["id"]): Decimal(str(row["qty_received"])) for row in lines_data}
    with transaction.atomic():
        lines = list(order.lines.select_related("product"))
        for line in lines:
            qty = received_by_id.get(line.id)
            if qty is None:
                continue
            if qty < 0:
                raise HttpError(422, "Quantità ricevuta non valida")
            line.qty_received = qty
            line.save(update_fields=["qty_received"])
            if qty > 0:
                apply_movement(
                    line.product,
                    kind=StockMovement.Kind.LOAD,
                    qty=qty,
                    reason=f"Ricezione ordine #{order.pk}",
                    order=order,
                    author=author,
                )
        discrepancies = [
            {
                "line_id": line.id,
                "product_id": line.product_id,
                "product_name": line.product.name,
                "qty_ordered": line.qty_ordered,
                "qty_received": line.qty_received,
                "delta": line.qty_received - line.qty_ordered,
            }
            for line in lines
            if line.qty_received != line.qty_ordered
        ]
        order.status = (
            PurchaseOrder.Status.PARTIAL if discrepancies else PurchaseOrder.Status.RECEIVED
        )
        order.save(update_fields=["status", "updated_at"])
    return order, discrepancies
