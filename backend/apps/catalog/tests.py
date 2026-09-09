"""Test essenziali: reorder categorie, pacchetto con items (ricreati a ogni
update), endpoint pubblici (raggruppamento + filtro attivi + 404 salone).

Le view sono chiamate direttamente (bypassando l'HTTP layer): usano solo
`request.auth`, quindi basta un `SimpleNamespace` con un `StaffContext` costruito
a mano — evita di dipendere da apps.accounts (fuori dal perimetro di questa app).
"""

from decimal import Decimal
from types import SimpleNamespace

from common.testing import SubscribedSalonTestCase as TestCase
from ninja.errors import HttpError

from apps.core.models import ActivityLog, Salon
from common.auth import StaffContext

from .api import (
    create_category,
    create_package,
    create_service,
    public_packages,
    public_services,
    reorder_categories,
    update_package,
    update_service,
)
from .models import Package, PackageItem, Service, ServiceCategory
from .schemas import CategoryIn, PackageIn, PackageItemIn, ReorderIn, ServiceIn


class CatalogTestCase(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        ctx = StaffContext(
            user=None, salon=self.salon, membership=None, scopes={"pricing"}, is_owner=False
        )
        self.request = SimpleNamespace(auth=ctx)


class ReorderCategoriesTests(CatalogTestCase):
    def test_reorder_updates_order_field(self):
        c1 = create_category(self.request, CategoryIn(name_it="Unghie"))
        c2 = create_category(self.request, CategoryIn(name_it="Capelli"))
        c3 = create_category(self.request, CategoryIn(name_it="Viso"))
        self.assertEqual([c1.order, c2.order, c3.order], [0, 0, 0])

        reorder_categories(self.request, ReorderIn(ids=[c3.id, c1.id, c2.id]))

        c1.refresh_from_db()
        c2.refresh_from_db()
        c3.refresh_from_db()
        self.assertEqual(c3.order, 0)
        self.assertEqual(c1.order, 1)
        self.assertEqual(c2.order, 2)

    def test_reorder_ignores_unknown_ids(self):
        c1 = create_category(self.request, CategoryIn(name_it="Unghie"))
        result = list(reorder_categories(self.request, ReorderIn(ids=[999, c1.id])))
        self.assertEqual([c.id for c in result], [c1.id])


class PackageWithItemsTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        cat = ServiceCategory.objects.create(salon=self.salon, name_it="Unghie")
        self.s1 = Service.objects.create(
            salon=self.salon, category=cat, name_it="Manicure", duration_min=30, price=Decimal("20.00")
        )
        self.s2 = Service.objects.create(
            salon=self.salon, category=cat, name_it="Pedicure", duration_min=45, price=Decimal("30.00")
        )

    def test_create_package_creates_nested_items(self):
        data = PackageIn(
            name="Combo mani-piedi",
            price=Decimal("45.00"),
            items=[PackageItemIn(service_id=self.s1.id, qty=2)],
        )
        out = create_package(self.request, data)

        package = Package.objects.get(id=out["id"])
        self.assertEqual(package.items.count(), 1)
        self.assertEqual(package.items.first().service_id, self.s1.id)
        self.assertEqual(package.items.first().qty, 2)
        # la view ritorna istanze PackageItem (serializzate da ninja a livello HTTP)
        self.assertEqual(out["items"][0].qty, 2)

    def test_update_package_recreates_items(self):
        data = PackageIn(
            name="Combo",
            price=Decimal("45.00"),
            items=[PackageItemIn(service_id=self.s1.id, qty=2)],
        )
        out = create_package(self.request, data)
        package_id = out["id"]
        old_item_id = PackageItem.objects.get(package_id=package_id).id

        data2 = PackageIn(
            name="Combo",
            price=Decimal("45.00"),
            items=[PackageItemIn(service_id=self.s2.id, qty=1)],
        )
        update_package(self.request, package_id, data2)

        items = list(PackageItem.objects.filter(package_id=package_id))
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].service_id, self.s2.id)
        self.assertEqual(items[0].qty, 1)
        self.assertFalse(PackageItem.objects.filter(id=old_item_id).exists())


class ServicePriceChangeLogTests(CatalogTestCase):
    def test_price_change_logs_activity_with_old_and_new(self):
        cat = ServiceCategory.objects.create(salon=self.salon, name_it="Unghie")
        service = create_service(
            self.request,
            ServiceIn(category_id=cat.id, name_it="Manicure", duration_min=30, price=Decimal("20.00")),
        )
        update_service(
            self.request,
            service.id,
            ServiceIn(category_id=cat.id, name_it="Manicure", duration_min=30, price=Decimal("25.00")),
        )
        log = ActivityLog.objects.get(type="service.price_changed")
        self.assertEqual(log.payload["old"], "20.00")
        self.assertEqual(log.payload["new"], "25.00")

    def test_no_price_change_does_not_log(self):
        cat = ServiceCategory.objects.create(salon=self.salon, name_it="Unghie")
        service = create_service(
            self.request,
            ServiceIn(category_id=cat.id, name_it="Manicure", duration_min=30, price=Decimal("20.00")),
        )
        update_service(
            self.request,
            service.id,
            ServiceIn(category_id=cat.id, name_it="Manicure", duration_min=35, price=Decimal("20.00")),
        )
        self.assertFalse(ActivityLog.objects.filter(type="service.price_changed").exists())


class ServiceSoakMinTests(CatalogTestCase):
    """Il tempo di posa (soak_min) fa round-trip su create/update del servizio."""

    def setUp(self):
        super().setUp()
        self.cat = ServiceCategory.objects.create(salon=self.salon, name_it="Capelli")

    def test_create_service_persists_soak_min(self):
        service = create_service(
            self.request,
            ServiceIn(
                category_id=self.cat.id,
                name_it="Colore",
                duration_min=30,
                soak_min=45,
                price=Decimal("60.00"),
            ),
        )
        service.refresh_from_db()
        self.assertEqual(service.duration_min, 30)
        self.assertEqual(service.soak_min, 45)

    def test_create_service_soak_min_defaults_to_zero(self):
        service = create_service(
            self.request,
            ServiceIn(
                category_id=self.cat.id,
                name_it="Piega",
                duration_min=40,
                price=Decimal("25.00"),
            ),
        )
        self.assertEqual(service.soak_min, 0)

    def test_update_service_persists_soak_min(self):
        service = create_service(
            self.request,
            ServiceIn(
                category_id=self.cat.id,
                name_it="Colore",
                duration_min=30,
                soak_min=45,
                price=Decimal("60.00"),
            ),
        )
        update_service(
            self.request,
            service.id,
            ServiceIn(
                category_id=self.cat.id,
                name_it="Colore",
                duration_min=30,
                soak_min=20,
                price=Decimal("60.00"),
            ),
        )
        service.refresh_from_db()
        self.assertEqual(service.soak_min, 20)


class PublicEndpointsTests(CatalogTestCase):
    def test_public_services_groups_by_category_and_hides_inactive(self):
        cat_a = ServiceCategory.objects.create(salon=self.salon, name_it="Unghie", order=1)
        cat_b = ServiceCategory.objects.create(salon=self.salon, name_it="Capelli", order=0)
        Service.objects.create(
            salon=self.salon, category=cat_a, name_it="Manicure", duration_min=30,
            price=Decimal("20.00"), active=True,
        )
        Service.objects.create(
            salon=self.salon, category=cat_a, name_it="Vecchio trattamento", duration_min=30,
            price=Decimal("10.00"), active=False,
        )
        Service.objects.create(
            salon=self.salon, category=cat_b, name_it="Piega", duration_min=40,
            price=Decimal("25.00"), active=True,
        )

        result = public_services(None, self.salon.slug)

        # ordinate per "order" della categoria: Capelli (0) prima di Unghie (1)
        self.assertEqual([c["id"] for c in result], [cat_b.id, cat_a.id])
        unghie = next(c for c in result if c["id"] == cat_a.id)
        self.assertEqual(len(unghie["services"]), 1)
        self.assertEqual(unghie["services"][0].name_it, "Manicure")

    def test_public_services_unknown_salon_returns_404(self):
        with self.assertRaises(HttpError) as exc:
            public_services(None, "salone-inesistente")
        self.assertEqual(exc.exception.status_code, 404)

    def test_public_packages_hides_inactive_and_includes_items(self):
        cat = ServiceCategory.objects.create(salon=self.salon, name_it="Unghie")
        service = Service.objects.create(
            salon=self.salon, category=cat, name_it="Manicure", duration_min=30, price=Decimal("20.00")
        )
        active_pkg = Package.objects.create(salon=self.salon, name="Combo attivo", price=Decimal("40.00"), active=True)
        PackageItem.objects.create(package=active_pkg, service=service, qty=1)
        Package.objects.create(salon=self.salon, name="Combo disattivo", price=Decimal("40.00"), active=False)

        result = public_packages(None, self.salon.slug)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "Combo attivo")
        self.assertEqual(result[0]["items"][0]["name_it"], "Manicure")

    def test_public_packages_unknown_salon_returns_404(self):
        with self.assertRaises(HttpError) as exc:
            public_packages(None, "salone-inesistente")
        self.assertEqual(exc.exception.status_code, 404)
