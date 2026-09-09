from decimal import Decimal
from types import SimpleNamespace

from common.testing import SubscribedSalonTestCase as TestCase
from ninja.errors import HttpError

from apps.core.models import Salon
from apps.staff.models import Operator
from common.auth import StaffContext

from .api import create_category, unload_product, update_category
from .models import Product, ProductCategory, PurchaseOrder, StockMovement, Supplier
from .schemas import CategoryIn, MovementOut, ProductUnloadIn
from .services import apply_movement, generate_draft_orders, receive_order


class InventoryTests(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        self.supplier_a = Supplier.objects.create(salon=self.salon, name="Davines")
        self.supplier_b = Supplier.objects.create(salon=self.salon, name="Kerastase")

    def _product(self, name, *, supplier=None, stock=0, threshold=0, reorder=0, **extra):
        return Product.objects.create(
            salon=self.salon,
            name=name,
            supplier=supplier or self.supplier_a,
            stock_qty=Decimal(stock),
            min_threshold=Decimal(threshold),
            reorder_qty=Decimal(reorder),
            **extra,
        )

    # ---- apply_movement ------------------------------------------------------

    def test_apply_movement_updates_stock(self):
        product = self._product("Shampoo")
        movement = apply_movement(product, StockMovement.Kind.LOAD, Decimal("10"))
        self.assertEqual(movement.kind, "load")
        self.assertEqual(product.stock_qty, Decimal("10"))
        apply_movement(product, StockMovement.Kind.INTERNAL_USE, Decimal("-4"))
        self.assertEqual(product.stock_qty, Decimal("6"))
        self.assertEqual(product.movements.count(), 2)

    def test_apply_movement_blocks_negative_stock(self):
        product = self._product("Shampoo", stock=6)
        with self.assertRaises(HttpError) as caught:
            apply_movement(product, StockMovement.Kind.SALE, Decimal("-7"))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("Giacenza insufficiente", str(caught.exception))
        product.refresh_from_db()
        self.assertEqual(product.stock_qty, Decimal("6"))
        self.assertEqual(product.movements.count(), 0)  # nessun movimento creato

    def test_stock_state_property(self):
        product = self._product("Shampoo", stock=2, threshold=5)
        self.assertEqual(product.stock_state, "low")
        product.stock_qty = Decimal("7")  # ≤ 5×1.5
        self.assertEqual(product.stock_state, "warning")
        product.stock_qty = Decimal("8")
        self.assertEqual(product.stock_state, "ok")

    # ---- generate_draft_orders -----------------------------------------------

    def test_generate_draft_orders_groups_by_supplier(self):
        p1 = self._product("Shampoo", supplier=self.supplier_a, stock=1, threshold=5, reorder=10)
        p2 = self._product("Balsamo", supplier=self.supplier_a, stock=0, threshold=3)  # reorder 0
        p3 = self._product("Maschera", supplier=self.supplier_b, stock=2, threshold=2, reorder=6)
        self._product("Olio", supplier=self.supplier_b, stock=50, threshold=2)  # sopra soglia
        self._product("Vecchio", supplier=self.supplier_b, stock=0, threshold=2, reorder=1, active=False)

        orders = generate_draft_orders(self.salon)
        self.assertEqual(len(orders), 2)
        by_supplier = {o.supplier_id: o for o in orders}

        order_a = by_supplier[self.supplier_a.id]
        self.assertEqual(order_a.status, PurchaseOrder.Status.DRAFT)
        qty_by_product = {l.product_id: l.qty_ordered for l in order_a.lines.all()}
        self.assertEqual(qty_by_product[p1.id], Decimal("10"))  # reorder_qty
        self.assertEqual(qty_by_product[p2.id], Decimal("3"))  # soglia − stock

        order_b = by_supplier[self.supplier_b.id]
        self.assertEqual(order_b.lines.count(), 1)
        self.assertEqual(order_b.lines.get().product_id, p3.id)

        # secondo run: i prodotti sono già in bozza → niente duplicati
        self.assertEqual(generate_draft_orders(self.salon), [])

    # ---- receive_order ---------------------------------------------------------

    def test_receive_complete_marks_received(self):
        product = self._product("Shampoo", stock=0, threshold=1, reorder=4)
        [order] = generate_draft_orders(self.salon)
        line = order.lines.get()
        order, discrepancies = receive_order(
            order, [{"id": line.id, "qty_received": Decimal("4")}]
        )
        self.assertEqual(order.status, PurchaseOrder.Status.RECEIVED)
        self.assertEqual(discrepancies, [])
        product.refresh_from_db()
        self.assertEqual(product.stock_qty, Decimal("4"))
        movement = product.movements.get()
        self.assertEqual(movement.kind, "load")
        self.assertEqual(movement.order_id, order.id)

    def test_receive_with_discrepancy_marks_partial(self):
        p1 = self._product("Shampoo", stock=0, threshold=2, reorder=10)
        p2 = self._product("Balsamo", stock=0, threshold=2, reorder=5)
        [order] = generate_draft_orders(self.salon)
        line1 = order.lines.get(product=p1)
        line2 = order.lines.get(product=p2)

        order, discrepancies = receive_order(
            order,
            [
                {"id": line1.id, "qty_received": Decimal("10")},  # combacia
                {"id": line2.id, "qty_received": Decimal("3")},  # ordinati 5
            ],
        )
        self.assertEqual(order.status, PurchaseOrder.Status.PARTIAL)
        self.assertEqual(len(discrepancies), 1)
        self.assertEqual(discrepancies[0]["line_id"], line2.id)
        self.assertEqual(discrepancies[0]["delta"], Decimal("-2"))

        p1.refresh_from_db()
        p2.refresh_from_db()
        self.assertEqual(p1.stock_qty, Decimal("10"))
        self.assertEqual(p2.stock_qty, Decimal("3"))

        # una seconda ricezione è vietata
        with self.assertRaises(HttpError):
            receive_order(order, [])


class InventoryApiTests(TestCase):
    """Endpoint-level: colore delle categorie e operatrice sullo scarico.

    Le view sono chiamate direttamente con uno `StaffContext` costruito a mano
    (stesso pattern di apps.catalog.tests): usano solo `request.auth`.
    """

    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        self.supplier = Supplier.objects.create(salon=self.salon, name="Davines")
        ctx = StaffContext(
            user=None,
            salon=self.salon,
            membership=None,
            scopes={"inventory"},
            is_owner=False,
        )
        self.request = SimpleNamespace(auth=ctx)

    def _product(self, name, *, stock=0):
        return Product.objects.create(
            salon=self.salon,
            name=name,
            supplier=self.supplier,
            stock_qty=Decimal(stock),
        )

    # ---- colore categorie ----------------------------------------------------

    def test_create_category_persists_color(self):
        cat = create_category(self.request, CategoryIn(name="Tinte", color="#FF0000"))
        self.assertEqual(cat.color, "#FF0000")
        self.assertEqual(ProductCategory.objects.get(pk=cat.id).color, "#FF0000")

    def test_create_category_defaults_color(self):
        cat = create_category(self.request, CategoryIn(name="Cura"))
        self.assertEqual(cat.color, "#E0E7FF")

    def test_update_category_without_color_keeps_existing(self):
        cat = create_category(self.request, CategoryIn(name="Tinte", color="#123456"))
        # payload senza color (come dal gestore categorie delle impostazioni)
        update_category(self.request, cat.id, CategoryIn(name="Colori", order=3))
        cat.refresh_from_db()
        self.assertEqual(cat.color, "#123456")  # colore invariato
        self.assertEqual(cat.name, "Colori")
        self.assertEqual(cat.order, 3)

    def test_update_category_with_color_updates_it(self):
        cat = create_category(self.request, CategoryIn(name="Tinte", color="#123456"))
        update_category(self.request, cat.id, CategoryIn(name="Tinte", color="#00FF00"))
        cat.refresh_from_db()
        self.assertEqual(cat.color, "#00FF00")

    # ---- operatrice sullo scarico --------------------------------------------

    def test_unload_with_operator_records_it(self):
        operator = Operator.objects.create(
            salon=self.salon, first_name="Anna", last_name="Rossi"
        )
        product = self._product("Shampoo", stock=10)
        movement = unload_product(
            self.request,
            product.id,
            ProductUnloadIn(
                qty=Decimal("2"), kind="internal_use", operator_id=operator.id
            ),
        )
        self.assertEqual(movement.operator_id, operator.id)
        self.assertEqual(MovementOut.resolve_operator_name(movement), "Anna Rossi")
        product.refresh_from_db()
        self.assertEqual(product.stock_qty, Decimal("8"))

    def test_unload_without_operator(self):
        product = self._product("Balsamo", stock=5)
        movement = unload_product(
            self.request,
            product.id,
            ProductUnloadIn(qty=Decimal("1"), kind="adjustment"),
        )
        self.assertIsNone(movement.operator_id)
        self.assertEqual(MovementOut.resolve_operator_name(movement), "")
        product.refresh_from_db()
        self.assertEqual(product.stock_qty, Decimal("4"))
