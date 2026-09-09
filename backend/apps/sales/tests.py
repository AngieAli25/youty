"""Test essenziali per apps.sales.

I servizi cross-app (inventory, marketing) sono mockati: qui si verifica solo
che finalize_sale li invochi con gli argomenti giusti, come da SPEC §8.
"""

from decimal import Decimal
from unittest.mock import patch

from common.testing import SubscribedSalonTestCase as TestCase
from ninja.errors import HttpError

from apps.clients.models import Client
from apps.core.models import ActivityLog, Salon
from common.auth import create_staff_tokens

from .models import Payment, Sale, SaleLine
from .services import finalize_sale, line_amount, today_summary

PATCH_DEDUCT = "apps.inventory.services.deduct_stock_for_sale"
PATCH_LOYALTY = "apps.marketing.services.accrue_loyalty"
PATCH_REDEEM = "apps.marketing.services.redeem_gift_card"
PATCH_CREATE_GC = "apps.marketing.services.create_gift_card"


def _blocks(lines, operator_id=None):
    return [{"operator_id": operator_id, "lines": lines}]


class FinalizeSaleTests(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        self.client_obj = Client.objects.create(
            salon=self.salon,
            first_name="Sofia",
            last_name="Ricci",
            phone="+393331112222",
        )

    def _finalize(self, blocks, payments, **kwargs):
        kwargs.setdefault("kind", Sale.Kind.POS)
        kwargs.setdefault("client", self.client_obj)
        with patch(PATCH_DEDUCT) as deduct, patch(PATCH_LOYALTY) as loyalty:
            sale = finalize_sale(self.salon, blocks=blocks, payments=payments, **kwargs)
        return sale, deduct, loyalty

    def test_finalize_sale_ok(self):
        blocks = _blocks(
            [
                {"line_type": "service", "qty": 1, "unit_price": Decimal("50.00")},
                {"line_type": "product", "qty": 2, "unit_price": Decimal("10.00")},
            ]
        )
        payments = [{"method": "cash", "amount": Decimal("70.00")}]
        sale, deduct, loyalty = self._finalize(blocks, payments)

        self.assertEqual(sale.total, Decimal("70.00"))
        self.assertEqual(sale.kind, Sale.Kind.POS)
        self.assertEqual(sale.lines.count(), 2)
        self.assertEqual(sale.payments.count(), 1)
        self.assertEqual(sale.payments.get().amount, Decimal("70.00"))
        deduct.assert_called_once_with(sale)  # righe prodotto → scarico magazzino
        loyalty.assert_called_once_with(sale)
        self.assertTrue(
            ActivityLog.objects.filter(salon=self.salon, type="sale.created").exists()
        )

    def test_finalize_sale_payment_mismatch(self):
        blocks = _blocks([{"line_type": "service", "qty": 1, "unit_price": Decimal("70.00")}])
        with self.assertRaises(HttpError) as caught:
            self._finalize(blocks, [{"method": "cash", "amount": Decimal("60.00")}])
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(str(caught.exception), "I pagamenti non corrispondono al totale")
        self.assertEqual(Sale.objects.count(), 0)  # niente vendita parziale

    def test_payment_tolerance_one_cent(self):
        blocks = _blocks([{"line_type": "service", "qty": 1, "unit_price": Decimal("50.00")}])
        sale, _, _ = self._finalize(blocks, [{"method": "card", "amount": Decimal("49.99")}])
        self.assertEqual(sale.total, Decimal("50.00"))

    def test_discount_and_gift_amounts(self):
        blocks = _blocks(
            [
                {
                    "line_type": "service",
                    "qty": 2,
                    "unit_price": Decimal("30.00"),
                    "discount_pct": 50,
                },
                {
                    "line_type": "product",
                    "qty": 1,
                    "unit_price": Decimal("15.00"),
                    "is_gift": True,
                },
            ]
        )
        payments = [{"method": "card", "amount": Decimal("30.00")}]
        sale, deduct, _ = self._finalize(blocks, payments)

        amounts = sorted(sale.lines.values_list("amount", flat=True))
        self.assertEqual(amounts, [Decimal("0.00"), Decimal("30.00")])
        self.assertEqual(sale.total, Decimal("30.00"))
        deduct.assert_called_once_with(sale)  # anche l'omaggio scarica il magazzino

    def test_deposit_deducted(self):
        blocks = _blocks([{"line_type": "service", "qty": 1, "unit_price": Decimal("80.00")}])
        sale, _, _ = self._finalize(
            blocks,
            [{"method": "cash", "amount": Decimal("60.00")}],
            deposit_deducted=Decimal("20.00"),
        )
        self.assertEqual(sale.total, Decimal("80.00"))
        self.assertEqual(sale.deposit_deducted, Decimal("20.00"))

        # pagare il totale pieno è un errore: il deposito va detratto
        with self.assertRaises(HttpError) as caught:
            self._finalize(
                blocks,
                [{"method": "cash", "amount": Decimal("80.00")}],
                deposit_deducted=Decimal("20.00"),
            )
        self.assertEqual(caught.exception.status_code, 422)

    def test_gift_card_payment_redeems(self):
        blocks = _blocks([{"line_type": "service", "qty": 1, "unit_price": Decimal("40.00")}])
        payments = [
            {"method": "gift_card", "amount": Decimal("40.00"), "gift_card_code": "ABCD1234"}
        ]
        with patch(PATCH_DEDUCT), patch(PATCH_LOYALTY), patch(
            PATCH_REDEEM, return_value=None
        ) as redeem:
            sale = finalize_sale(
                self.salon,
                kind=Sale.Kind.POS,
                blocks=blocks,
                payments=payments,
                client=self.client_obj,
            )
        redeem.assert_called_once_with(self.salon, "ABCD1234", Decimal("40.00"))
        self.assertEqual(sale.payments.get().method, Payment.Method.GIFT_CARD)

    def test_gift_card_payment_without_code(self):
        blocks = _blocks([{"line_type": "service", "qty": 1, "unit_price": Decimal("40.00")}])
        payments = [{"method": "gift_card", "amount": Decimal("40.00")}]
        with self.assertRaises(HttpError) as caught:
            self._finalize(blocks, payments)
        self.assertEqual(caught.exception.status_code, 422)

    def test_gift_card_line_creates_card(self):
        blocks = _blocks(
            [
                {
                    "line_type": "gift_card",
                    "qty": 1,
                    "value": Decimal("100.00"),
                    "recipient_name": "Giulia",
                }
            ]
        )
        payments = [{"method": "card", "amount": Decimal("100.00")}]
        with patch(PATCH_DEDUCT), patch(PATCH_LOYALTY), patch(
            PATCH_CREATE_GC, return_value=None
        ) as create_gc:
            sale = finalize_sale(
                self.salon,
                kind=Sale.Kind.POS,
                blocks=blocks,
                payments=payments,
                client=self.client_obj,
            )
        self.assertEqual(sale.total, Decimal("100.00"))
        create_gc.assert_called_once()
        args, kwargs = create_gc.call_args
        self.assertEqual(args, (self.salon, Decimal("100.00")))
        self.assertEqual(kwargs["buyer_client"], self.client_obj)
        self.assertEqual(kwargs["recipient_name"], "Giulia")
        self.assertTrue(kwargs["paid"])
        self.assertEqual(kwargs["paid_method"], "card")
        self.assertEqual(kwargs["sale"], sale)
        line = sale.lines.get()
        self.assertEqual(line.line_type, SaleLine.LineType.GIFT_CARD)
        self.assertEqual(line.amount, Decimal("100.00"))

    def test_no_lines_rejected(self):
        with self.assertRaises(HttpError) as caught:
            self._finalize([], [])
        self.assertEqual(caught.exception.status_code, 422)

    def test_line_amount_helper(self):
        self.assertEqual(line_amount(2, Decimal("30.00"), 50), Decimal("30.00"))
        self.assertEqual(line_amount(1, Decimal("19.99")), Decimal("19.99"))
        self.assertEqual(line_amount(3, Decimal("10.00"), 0, True), Decimal("0.00"))
        self.assertEqual(line_amount(3, Decimal("9.99"), 33), Decimal("20.08"))


class TodaySummaryTests(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")

    def test_today_summary(self):
        empty = today_summary(self.salon)
        self.assertEqual(empty["total"], Decimal("0.00"))
        self.assertEqual(empty["count"], 0)

        Sale.objects.create(salon=self.salon, kind=Sale.Kind.CHECKOUT, total=Decimal("100.00"))
        Sale.objects.create(salon=self.salon, kind=Sale.Kind.POS, total=Decimal("50.00"))
        other = Salon.objects.create(name="Altro", slug="altro")
        Sale.objects.create(salon=other, kind=Sale.Kind.POS, total=Decimal("99.00"))

        data = today_summary(self.salon)
        self.assertEqual(data["total"], Decimal("150.00"))
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["checkout_total"], Decimal("100.00"))
        self.assertEqual(data["pos_total"], Decimal("50.00"))


class ListSalesApiTests(TestCase):
    """GET /api/sales/: filtro opzionale client_id (staff, per singolo cliente)."""

    def setUp(self):
        from apps.accounts.models import Membership, Role, User

        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        user = User.objects.create_user(email="sole@theparlour.it", password="theparlour")
        role = Role.objects.create(salon=self.salon, name="Manager", scopes=["sales"])
        Membership.objects.create(user=user, salon=self.salon, role=role, is_owner=True)
        tokens = create_staff_tokens(user, self.salon)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}

        self.sofia = Client.objects.create(
            salon=self.salon, first_name="Sofia", last_name="Ricci", phone="+393331112222"
        )
        self.giulia = Client.objects.create(
            salon=self.salon, first_name="Giulia", last_name="Bianchi", phone="+393333334444"
        )
        self.sale_sofia = Sale.objects.create(
            salon=self.salon, kind=Sale.Kind.POS, client=self.sofia, total=Decimal("50.00")
        )
        self.sale_giulia = Sale.objects.create(
            salon=self.salon, kind=Sale.Kind.POS, client=self.giulia, total=Decimal("30.00")
        )

    def test_without_client_id_returns_all(self):
        resp = self.client.get("/api/sales/", **self.auth)
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["count"], 2)
        self.assertEqual(len(body["items"]), 2)

    def test_client_id_filters_to_single_client(self):
        resp = self.client.get(f"/api/sales/?client_id={self.sofia.id}", **self.auth)
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["id"], self.sale_sofia.id)
        self.assertEqual(body["kpi"]["revenue"], "50.00")
