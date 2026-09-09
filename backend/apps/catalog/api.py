"""Catalogo: categorie servizi, servizi (listino), pacchetti.

Letture base → solo `staff_auth`. Scritture → scope "pricing".
Endpoint pubblici (`/public/...`) senza auth: usati dalla web app cliente prima
del login per mostrare listino e pacchetti del salone (solo elementi attivi).
"""

from typing import Optional

from django.db.models import Prefetch
from django.db.models.deletion import ProtectedError
from ninja import Router
from ninja.errors import HttpError

from apps.core.models import Salon
from apps.core.services import log_activity
from common.portal_access import business_operation
from common.auth import staff_auth
from common.permissions import require_scope
from common.utils import salon_get

from .models import Package, PackageItem, Service, ServiceCategory
from .schemas import (
    CategoryIn,
    CategoryOut,
    OkOut,
    PackageIn,
    PackageOut,
    PublicCategoryOut,
    PublicPackageOut,
    ReorderIn,
    ServiceIn,
    ServiceOut,
)

router = Router(tags=["catalog"])


def _get_salon_by_slug(slug: str) -> Salon:
    try:
        return Salon.objects.get(slug=slug)
    except Salon.DoesNotExist:
        raise HttpError(404, "Salone non trovato")


# ---- Categorie servizi -------------------------------------------------------


@router.get("/categories", auth=staff_auth, response=list[CategoryOut])
def list_categories(request):
    return request.auth.salon.service_categories.all()


@router.post("/categories", auth=staff_auth, response=CategoryOut)
@business_operation
def create_category(request, data: CategoryIn):
    ctx = request.auth
    require_scope(ctx, "pricing")
    category = ServiceCategory.objects.create(salon=ctx.salon, **data.dict())
    log_activity(
        ctx.salon,
        "category.created",
        f"Categoria creata: {category.name_it}",
        actor=ctx.user,
        payload={"category_id": category.id},
    )
    return category


@router.put("/categories/{int:category_id}", auth=staff_auth, response=CategoryOut)
@business_operation
def update_category(request, category_id: int, data: CategoryIn):
    ctx = request.auth
    require_scope(ctx, "pricing")
    category = salon_get(ServiceCategory, ctx, category_id)
    for name, value in data.dict().items():
        setattr(category, name, value)
    category.save()
    log_activity(
        ctx.salon,
        "category.updated",
        f"Categoria aggiornata: {category.name_it}",
        actor=ctx.user,
        payload={"category_id": category.id},
    )
    return category


@router.delete("/categories/{int:category_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_category(request, category_id: int):
    ctx = request.auth
    require_scope(ctx, "pricing")
    category = salon_get(ServiceCategory, ctx, category_id)
    name_it = category.name_it
    try:
        category.delete()
    except ProtectedError:
        raise HttpError(400, "Impossibile eliminare: categoria con servizi collegati")
    log_activity(
        ctx.salon,
        "category.deleted",
        f"Categoria eliminata: {name_it}",
        actor=ctx.user,
        payload={"category_id": category_id},
    )
    return OkOut()


@router.post("/categories/reorder", auth=staff_auth, response=list[CategoryOut])
@business_operation
def reorder_categories(request, data: ReorderIn):
    ctx = request.auth
    require_scope(ctx, "pricing")
    categories = {
        c.id: c
        for c in ServiceCategory.objects.filter(salon=ctx.salon, id__in=data.ids)
    }
    for order, cat_id in enumerate(data.ids):
        category = categories.get(cat_id)
        if category is None:
            continue
        if category.order != order:
            category.order = order
            category.save(update_fields=["order"])
    log_activity(
        ctx.salon,
        "category.reordered",
        "Categorie riordinate",
        actor=ctx.user,
        payload={"ids": data.ids},
    )
    return ServiceCategory.objects.filter(salon=ctx.salon).order_by("order", "id")


# ---- Servizi ------------------------------------------------------------------


@router.get("/services", auth=staff_auth, response=list[ServiceOut])
def list_services(request, category_id: Optional[int] = None, active: Optional[bool] = None):
    ctx = request.auth
    qs = Service.objects.filter(salon=ctx.salon)
    if category_id is not None:
        qs = qs.filter(category_id=category_id)
    if active is not None:
        qs = qs.filter(active=active)
    return qs.order_by("category__order", "order", "id")


@router.post("/services", auth=staff_auth, response=ServiceOut)
@business_operation
def create_service(request, data: ServiceIn):
    ctx = request.auth
    require_scope(ctx, "pricing")
    payload = data.dict()
    category = salon_get(ServiceCategory, ctx, payload.pop("category_id"))
    service = Service.objects.create(salon=ctx.salon, category=category, **payload)
    log_activity(
        ctx.salon,
        "service.created",
        f"Servizio creato: {service.name_it}",
        actor=ctx.user,
        payload={"service_id": service.id},
    )
    return service


@router.put("/services/{int:service_id}", auth=staff_auth, response=ServiceOut)
@business_operation
def update_service(request, service_id: int, data: ServiceIn):
    ctx = request.auth
    require_scope(ctx, "pricing")
    service = salon_get(Service, ctx, service_id)
    old_price = service.price
    payload = data.dict()
    service.category = salon_get(ServiceCategory, ctx, payload.pop("category_id"))
    for name, value in payload.items():
        setattr(service, name, value)
    service.save()
    log_activity(
        ctx.salon,
        "service.updated",
        f"Servizio aggiornato: {service.name_it}",
        actor=ctx.user,
        payload={"service_id": service.id},
    )
    if service.price != old_price:
        log_activity(
            ctx.salon,
            "service.price_changed",
            f"Prezzo aggiornato: {service.name_it}",
            actor=ctx.user,
            payload={"old": str(old_price), "new": str(service.price)},
        )
    return service


@router.delete("/services/{int:service_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_service(request, service_id: int):
    ctx = request.auth
    require_scope(ctx, "pricing")
    service = salon_get(Service, ctx, service_id)
    service.active = False
    service.save(update_fields=["active"])
    log_activity(
        ctx.salon,
        "service.deleted",
        f"Servizio disattivato: {service.name_it}",
        actor=ctx.user,
        payload={"service_id": service.id},
    )
    return OkOut()


# ---- Pacchetti ------------------------------------------------------------------


def _package_out(package: Package) -> dict:
    return {
        "id": package.id,
        "name": package.name,
        "description": package.description,
        "price": package.price,
        "active": package.active,
        "items": list(package.items.all()),
    }


def _sync_package_items(ctx, package: Package, items: list[dict]) -> None:
    """Ricrea integralmente gli items del pacchetto (spec: ricreati a ogni update)."""
    package.items.all().delete()
    for item in items:
        service = salon_get(Service, ctx, item["service_id"])
        PackageItem.objects.create(package=package, service=service, qty=item.get("qty", 1))


@router.get("/packages", auth=staff_auth, response=list[PackageOut])
def list_packages(request):
    ctx = request.auth
    qs = Package.objects.filter(salon=ctx.salon).prefetch_related("items")
    return [_package_out(p) for p in qs]


@router.post("/packages", auth=staff_auth, response=PackageOut)
@business_operation
def create_package(request, data: PackageIn):
    ctx = request.auth
    require_scope(ctx, "pricing")
    payload = data.dict()
    items = payload.pop("items")
    package = Package.objects.create(salon=ctx.salon, **payload)
    _sync_package_items(ctx, package, items)
    log_activity(
        ctx.salon,
        "package.created",
        f"Pacchetto creato: {package.name}",
        actor=ctx.user,
        payload={"package_id": package.id},
    )
    return _package_out(package)


@router.put("/packages/{int:package_id}", auth=staff_auth, response=PackageOut)
@business_operation
def update_package(request, package_id: int, data: PackageIn):
    ctx = request.auth
    require_scope(ctx, "pricing")
    package = salon_get(Package, ctx, package_id)
    payload = data.dict()
    items = payload.pop("items")
    for name, value in payload.items():
        setattr(package, name, value)
    package.save()
    _sync_package_items(ctx, package, items)
    log_activity(
        ctx.salon,
        "package.updated",
        f"Pacchetto aggiornato: {package.name}",
        actor=ctx.user,
        payload={"package_id": package.id},
    )
    return _package_out(package)


@router.delete("/packages/{int:package_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_package(request, package_id: int):
    ctx = request.auth
    require_scope(ctx, "pricing")
    package = salon_get(Package, ctx, package_id)
    package.active = False
    package.save(update_fields=["active"])
    log_activity(
        ctx.salon,
        "package.deleted",
        f"Pacchetto disattivato: {package.name}",
        actor=ctx.user,
        payload={"package_id": package.id},
    )
    return OkOut()


# ---- Endpoint pubblici (web app cliente, no auth) ----------------------------


@router.get("/public/services", response=list[PublicCategoryOut])
def public_services(request, salon: str):
    """Listino pubblico raggruppato per categoria (ordinata), solo servizi attivi."""
    s = _get_salon_by_slug(salon)
    categories = ServiceCategory.objects.filter(salon=s).order_by("order", "id").prefetch_related(
        Prefetch(
            "services",
            queryset=Service.objects.filter(active=True).order_by("order", "id"),
        )
    )
    return [
        {
            "id": c.id,
            "name_it": c.name_it,
            "name_en": c.name_en,
            "color": c.color,
            "services": list(c.services.all()),
        }
        for c in categories
    ]


@router.get("/public/packages", response=list[PublicPackageOut])
def public_packages(request, salon: str):
    """Pacchetti pubblici attivi, con dettaglio dei servizi inclusi."""
    s = _get_salon_by_slug(salon)
    packages = Package.objects.filter(salon=s, active=True).prefetch_related("items__service")
    return [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "price": p.price,
            "items": [
                {
                    "service_id": item.service_id,
                    "name_it": item.service.name_it,
                    "name_en": item.service.name_en,
                    "qty": item.qty,
                }
                for item in p.items.all()
            ],
        }
        for p in packages
    ]
