from decimal import Decimal
from typing import Optional

from django.db.models import Case, F, IntegerField, ProtectedError, Q, Value, When
from django.utils import timezone
from django.utils.dateparse import parse_date
from ninja import File, Form, Router
from ninja.errors import HttpError
from ninja.files import UploadedFile
from ninja.pagination import LimitOffsetPagination, paginate

from apps.core.services import emit_event, log_activity
from common.portal_access import business_operation
from common.auth import staff_auth
from common.permissions import require_scope
from common.utils import salon_get

from .models import Product, ProductCategory, PurchaseOrder, StockMovement, Supplier
from .schemas import (
    CategoryIn,
    CategoryOut,
    LoadCsvIn,
    LoadCsvOut,
    MovementOut,
    OkOut,
    OrderOut,
    OrderReceiveIn,
    OrderReceiveOut,
    OrderSendIn,
    OrderUpdateIn,
    ProductIn,
    ProductLoadIn,
    ProductOut,
    ProductUnloadIn,
    SupplierIn,
    SupplierOut,
)
from .services import apply_movement, generate_draft_orders, receive_order

router = Router(tags=["inventory"])

UNLOAD_KINDS = {
    StockMovement.Kind.INTERNAL_USE,
    StockMovement.Kind.ADJUSTMENT,
    StockMovement.Kind.TRANSFER,
}


def _products_qs(ctx):
    return Product.objects.filter(salon=ctx.salon).select_related("category", "supplier")


def _apply_product_payload(product: Product, ctx, data: ProductIn) -> Product:
    payload = data.dict()
    supplier = salon_get(Supplier, ctx, payload.pop("supplier_id"))
    category_id = payload.pop("category_id")
    category = salon_get(ProductCategory, ctx, category_id) if category_id else None
    if payload["usage"] not in Product.Usage.values:
        raise HttpError(400, "Tipo di utilizzo non valido")
    for name, value in payload.items():
        setattr(product, name, value)
    product.supplier = supplier
    product.category = category
    product.salon = ctx.salon
    product.save()
    return product


# ---- Prodotti ----------------------------------------------------------------


@router.get("/products", auth=staff_auth, response=list[ProductOut])
@paginate(LimitOffsetPagination)
def list_products(
    request,
    q: str = "",
    category_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    brand: str = "",
    usage: str = "",
    stock_state: str = "",
    include_inactive: bool = False,
):
    ctx = request.auth
    qs = _products_qs(ctx)
    if not include_inactive:
        qs = qs.filter(active=True)
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(sku__icontains=q) | Q(brand__icontains=q))
    if category_id:
        qs = qs.filter(category_id=category_id)
    if supplier_id:
        qs = qs.filter(supplier_id=supplier_id)
    if brand:
        qs = qs.filter(brand__iexact=brand)
    if usage:
        qs = qs.filter(usage=usage)
    if stock_state == "low":
        qs = qs.filter(stock_qty__lte=F("min_threshold"))
    elif stock_state == "warning":
        qs = qs.filter(
            stock_qty__gt=F("min_threshold"),
            stock_qty__lte=F("min_threshold") * Decimal("1.5"),
        )
    elif stock_state == "ok":
        qs = qs.filter(stock_qty__gt=F("min_threshold") * Decimal("1.5"))
    # default: prodotti sotto soglia prima
    return qs.annotate(
        below_threshold=Case(
            When(stock_qty__lte=F("min_threshold"), then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        )
    ).order_by("below_threshold", "name")


@router.post("/products", auth=staff_auth, response=ProductOut)
@business_operation
def create_product(request, data: ProductIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    product = _apply_product_payload(Product(), ctx, data)
    log_activity(
        ctx.salon,
        "product.created",
        f"Nuovo prodotto: {product.name}",
        actor=ctx.user,
        payload={"product_id": product.id},
    )
    return product


@router.get("/products/{int:product_id}", auth=staff_auth, response=ProductOut)
def get_product(request, product_id: int):
    return salon_get(Product, request.auth, product_id)


@router.put("/products/{int:product_id}", auth=staff_auth, response=ProductOut)
@business_operation
def update_product(request, product_id: int, data: ProductIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    product = salon_get(Product, ctx, product_id)
    product = _apply_product_payload(product, ctx, data)
    log_activity(
        ctx.salon,
        "product.updated",
        f"Prodotto aggiornato: {product.name}",
        actor=ctx.user,
        payload={"product_id": product.id},
    )
    return product


@router.delete("/products/{int:product_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_product(request, product_id: int):
    """Soft delete: il prodotto resta in archivio (movimenti/storici intatti)."""
    ctx = request.auth
    require_scope(ctx, "inventory")
    product = salon_get(Product, ctx, product_id)
    product.active = False
    product.save(update_fields=["active", "updated_at"])
    log_activity(
        ctx.salon,
        "product.deleted",
        f"Prodotto disattivato: {product.name}",
        actor=ctx.user,
        payload={"product_id": product.id},
    )
    return OkOut()


# ---- Carichi e scarichi ------------------------------------------------------


@router.post("/products/{int:product_id}/load", auth=staff_auth, response=MovementOut)
@business_operation
def load_product(
    request,
    product_id: int,
    data: Form[ProductLoadIn],
    invoice: Optional[UploadedFile] = File(None),
):
    ctx = request.auth
    require_scope(ctx, "inventory")
    product = salon_get(Product, ctx, product_id)
    if data.qty <= 0:
        raise HttpError(422, "La quantità da caricare deve essere positiva")
    movement = apply_movement(
        product,
        kind=StockMovement.Kind.LOAD,
        qty=data.qty,
        reason=data.reason,
        author=ctx.user,
        invoice=invoice,
    )
    log_activity(
        ctx.salon,
        "stock.loaded",
        f"Carico {product.name}: +{data.qty}",
        actor=ctx.user,
        payload={"product_id": product.id, "movement_id": movement.id, "qty": float(data.qty)},
    )
    return movement


@router.post("/products/{int:product_id}/unload", auth=staff_auth, response=MovementOut)
@business_operation
def unload_product(request, product_id: int, data: ProductUnloadIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    product = salon_get(Product, ctx, product_id)
    if data.qty <= 0:
        raise HttpError(422, "La quantità da scaricare deve essere positiva")
    if data.kind not in UNLOAD_KINDS:
        raise HttpError(400, "Causale di scarico non valida")
    operator = None
    if data.operator_id is not None:
        from apps.staff.models import Operator

        operator = salon_get(Operator, ctx, data.operator_id)
    movement = apply_movement(
        product,
        kind=data.kind,
        qty=-data.qty,
        reason=data.reason,
        author=ctx.user,
        operator=operator,
    )
    log_activity(
        ctx.salon,
        "stock.unloaded",
        f"Scarico {product.name}: -{data.qty} ({data.kind})",
        actor=ctx.user,
        payload={"product_id": product.id, "movement_id": movement.id, "qty": float(data.qty)},
    )
    return movement


@router.post("/load-csv", auth=staff_auth, response=LoadCsvOut)
@business_operation
def load_csv(request, data: LoadCsvIn):
    """Carico multiplo da CSV: match per SKU poi per nome; non sovrascrive, somma.

    Se il prodotto non esiste viene creato (serve supplier_id di riga o globale).
    """
    ctx = request.auth
    require_scope(ctx, "inventory")
    results = []
    loaded = created = errors = 0
    for idx, row in enumerate(data.rows, start=1):
        try:
            if not row.sku and not row.name:
                raise HttpError(400, "Riga senza nome né SKU")
            if row.qty <= 0:
                raise HttpError(422, "Quantità non valida")
            product = None
            if row.sku:
                product = Product.objects.filter(salon=ctx.salon, sku__iexact=row.sku).first()
            if product is None and row.name:
                product = Product.objects.filter(salon=ctx.salon, name__iexact=row.name).first()
            status = "loaded"
            if product is None:
                supplier_id = row.supplier_id or data.supplier_id
                if not supplier_id:
                    raise HttpError(400, "Fornitore mancante per il nuovo prodotto")
                supplier = Supplier.objects.filter(salon=ctx.salon, pk=supplier_id).first()
                if supplier is None:
                    raise HttpError(400, "Fornitore non trovato")
                product = Product.objects.create(
                    salon=ctx.salon,
                    name=row.name or row.sku,
                    sku=row.sku,
                    supplier=supplier,
                )
                status = "created"
                created += 1
            apply_movement(
                product,
                kind=StockMovement.Kind.LOAD,
                qty=row.qty,
                reason="Carico CSV",
                author=ctx.user,
            )
            loaded += 1
            results.append(
                {"row": idx, "product_id": product.id, "name": product.name, "status": status}
            )
        except HttpError as exc:
            errors += 1
            results.append(
                {"row": idx, "name": row.name or row.sku, "status": "error", "error": str(exc)}
            )
    log_activity(
        ctx.salon,
        "stock.csv_loaded",
        f"Carico CSV: {loaded} righe caricate, {created} prodotti creati, {errors} errori",
        actor=ctx.user,
        payload={"loaded": loaded, "created": created, "errors": errors},
    )
    return {"results": results, "loaded": loaded, "created": created, "errors": errors}


# ---- Movimenti ---------------------------------------------------------------


def _filter_movements(qs, kind: str, date_from: str, date_to: str):
    if kind:
        qs = qs.filter(kind=kind)
    if date_from and (d := parse_date(date_from)):
        qs = qs.filter(created_at__date__gte=d)
    if date_to and (d := parse_date(date_to)):
        qs = qs.filter(created_at__date__lte=d)
    return qs


@router.get("/products/{int:product_id}/movements", auth=staff_auth, response=list[MovementOut])
@paginate(LimitOffsetPagination)
def list_product_movements(
    request, product_id: int, kind: str = "", date_from: str = "", date_to: str = ""
):
    ctx = request.auth
    product = salon_get(Product, ctx, product_id)
    qs = product.movements.select_related("product", "author", "operator")
    return _filter_movements(qs, kind, date_from, date_to)


@router.get("/movements", auth=staff_auth, response=list[MovementOut])
@paginate(LimitOffsetPagination)
def list_movements(
    request,
    kind: str = "",
    date_from: str = "",
    date_to: str = "",
    product_id: Optional[int] = None,
):
    ctx = request.auth
    qs = StockMovement.objects.filter(salon=ctx.salon).select_related("product", "author", "operator")
    if product_id:
        qs = qs.filter(product_id=product_id)
    return _filter_movements(qs, kind, date_from, date_to)


# ---- Fornitori ---------------------------------------------------------------


@router.get("/suppliers", auth=staff_auth, response=list[SupplierOut])
def list_suppliers(request):
    return Supplier.objects.filter(salon=request.auth.salon)


@router.post("/suppliers", auth=staff_auth, response=SupplierOut)
@business_operation
def create_supplier(request, data: SupplierIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    if data.order_method not in Supplier.OrderMethod.values:
        raise HttpError(400, "Metodo d'ordine non valido")
    supplier = Supplier.objects.create(salon=ctx.salon, **data.dict())
    log_activity(
        ctx.salon,
        "supplier.created",
        f"Nuovo fornitore: {supplier.name}",
        actor=ctx.user,
        payload={"supplier_id": supplier.id},
    )
    return supplier


@router.put("/suppliers/{int:supplier_id}", auth=staff_auth, response=SupplierOut)
@business_operation
def update_supplier(request, supplier_id: int, data: SupplierIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    if data.order_method not in Supplier.OrderMethod.values:
        raise HttpError(400, "Metodo d'ordine non valido")
    supplier = salon_get(Supplier, ctx, supplier_id)
    for name, value in data.dict().items():
        setattr(supplier, name, value)
    supplier.save()
    log_activity(
        ctx.salon,
        "supplier.updated",
        f"Fornitore aggiornato: {supplier.name}",
        actor=ctx.user,
        payload={"supplier_id": supplier.id},
    )
    return supplier


@router.delete("/suppliers/{int:supplier_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_supplier(request, supplier_id: int):
    ctx = request.auth
    require_scope(ctx, "inventory")
    supplier = salon_get(Supplier, ctx, supplier_id)
    name = supplier.name
    try:
        supplier.delete()
    except ProtectedError:
        raise HttpError(400, "Fornitore con prodotti o ordini associati: impossibile eliminarlo")
    log_activity(
        ctx.salon,
        "supplier.deleted",
        f"Fornitore eliminato: {name}",
        actor=ctx.user,
    )
    return OkOut()


# ---- Categorie prodotto ------------------------------------------------------


@router.get("/categories", auth=staff_auth, response=list[CategoryOut])
def list_categories(request):
    return ProductCategory.objects.filter(salon=request.auth.salon)


@router.post("/categories", auth=staff_auth, response=CategoryOut)
@business_operation
def create_category(request, data: CategoryIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    return ProductCategory.objects.create(
        salon=ctx.salon,
        name=data.name,
        order=data.order,
        color=data.color or "#E0E7FF",
    )


@router.put("/categories/{int:category_id}", auth=staff_auth, response=CategoryOut)
@business_operation
def update_category(request, category_id: int, data: CategoryIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    category = salon_get(ProductCategory, ctx, category_id)
    category.name = data.name
    category.order = data.order
    if data.color is not None:
        category.color = data.color
    category.save()
    return category


@router.delete("/categories/{int:category_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_category(request, category_id: int):
    ctx = request.auth
    require_scope(ctx, "inventory")
    salon_get(ProductCategory, ctx, category_id).delete()
    return OkOut()


# ---- Ordini fornitore ---------------------------------------------------------


def _orders_qs(ctx):
    return (
        PurchaseOrder.objects.filter(salon=ctx.salon)
        .select_related("supplier")
        .prefetch_related("lines__product")
    )


@router.get("/orders", auth=staff_auth, response=list[OrderOut])
@paginate(LimitOffsetPagination)
def list_orders(request, status: str = "", supplier_id: Optional[int] = None):
    qs = _orders_qs(request.auth)
    if status:
        qs = qs.filter(status=status)
    if supplier_id:
        qs = qs.filter(supplier_id=supplier_id)
    return qs


@router.post("/orders/generate", auth=staff_auth, response=list[OrderOut])
@business_operation
def generate_orders(request):
    """Genera bozze d'ordine per i prodotti sotto soglia, raggruppate per fornitore."""
    ctx = request.auth
    require_scope(ctx, "inventory")
    orders = generate_draft_orders(ctx.salon, author=ctx.user)
    log_activity(
        ctx.salon,
        "order.generated",
        f"Generate {len(orders)} bozze d'ordine da soglie di magazzino",
        actor=ctx.user,
        payload={"order_ids": [o.id for o in orders]},
    )
    return orders


@router.get("/orders/{int:order_id}", auth=staff_auth, response=OrderOut)
def get_order(request, order_id: int):
    return salon_get(PurchaseOrder, request.auth, order_id)


@router.put("/orders/{int:order_id}", auth=staff_auth, response=OrderOut)
@business_operation
def update_order(request, order_id: int, data: OrderUpdateIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    order = salon_get(PurchaseOrder, ctx, order_id)
    if order.status != PurchaseOrder.Status.DRAFT:
        raise HttpError(400, "Solo le bozze d'ordine sono modificabili")
    for row in data.lines:
        line = order.lines.filter(pk=row.id).first()
        if line is None:
            raise HttpError(404, "Riga d'ordine non trovata")
        if row.qty_ordered <= 0:
            line.delete()
        else:
            line.qty_ordered = row.qty_ordered
            line.save(update_fields=["qty_ordered"])
    log_activity(
        ctx.salon,
        "order.updated",
        f"Ordine #{order.id} aggiornato ({order.supplier.name})",
        actor=ctx.user,
        payload={"order_id": order.id},
    )
    return order


@router.post("/orders/{int:order_id}/send", auth=staff_auth, response=OrderOut)
@business_operation
def send_order(request, order_id: int, data: OrderSendIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    order = salon_get(PurchaseOrder, ctx, order_id)
    if order.status != PurchaseOrder.Status.DRAFT:
        raise HttpError(400, "L'ordine è già stato inviato")
    lines = list(order.lines.select_related("product"))
    if not lines:
        raise HttpError(400, "Impossibile inviare un ordine senza righe")
    method = data.method or order.supplier.order_method
    if method not in Supplier.OrderMethod.values:
        raise HttpError(400, "Metodo d'invio non valido")
    order.status = PurchaseOrder.Status.SENT
    order.sent_method = method
    order.sent_at = timezone.now()
    order.save(update_fields=["status", "sent_method", "sent_at", "updated_at"])
    emit_event(
        ctx.salon,
        "supplier.order",
        {
            "order_id": order.id,
            "method": method,
            "supplier": {
                "id": order.supplier_id,
                "name": order.supplier.name,
                "email": order.supplier.email,
                "phone": order.supplier.phone,
            },
            "lines": [
                {
                    "product_id": line.product_id,
                    "name": line.product.name,
                    "sku": line.product.sku,
                    "qty": float(line.qty_ordered),
                    "package_unit": line.product.package_unit,
                }
                for line in lines
            ],
        },
    )
    log_activity(
        ctx.salon,
        "order.sent",
        f"Ordine #{order.id} inviato a {order.supplier.name} ({method})",
        actor=ctx.user,
        payload={"order_id": order.id, "method": method},
    )
    return order


@router.post("/orders/{int:order_id}/receive", auth=staff_auth, response=OrderReceiveOut)
@business_operation
def receive_order_view(request, order_id: int, data: OrderReceiveIn):
    ctx = request.auth
    require_scope(ctx, "inventory")
    order = salon_get(PurchaseOrder, ctx, order_id)
    order, discrepancies = receive_order(
        order, [row.dict() for row in data.lines], author=ctx.user
    )
    log_activity(
        ctx.salon,
        "order.received",
        f"Ordine #{order.id} ricevuto ({order.status})"
        + (f" — {len(discrepancies)} discrepanze" if discrepancies else ""),
        actor=ctx.user,
        payload={
            "order_id": order.id,
            "status": order.status,
            "discrepancies": [
                {
                    "line_id": d["line_id"],
                    "product_id": d["product_id"],
                    "qty_ordered": float(d["qty_ordered"]),
                    "qty_received": float(d["qty_received"]),
                }
                for d in discrepancies
            ],
        },
    )
    return {"order": order, "discrepancies": discrepancies}
