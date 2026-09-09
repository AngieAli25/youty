import json
from datetime import timedelta
from decimal import Decimal

from common.testing import SubscribedSalonTestCase as TestCase
from django.utils import timezone
from ninja.errors import HttpError

from apps.core.models import OutboxEvent, Salon
from common.auth import create_staff_tokens

from .models import Communication, Coupon, GiftCard, LoyaltyAccount, LoyaltyProgram
from .services import (
    accrue_loyalty,
    create_gift_card,
    redeem_gift_card,
    send_communication,
    validate_coupon,
)


def _make_client(salon, first_name="Sofia", phone="+393331112233", marketing=True):
    from apps.clients.models import Client  # lazy: app di un altro agente

    return Client.objects.create(
        salon=salon,
        first_name=first_name,
        last_name="Ricci",
        phone=phone,
        consents={"privacy": True, "marketing": marketing, "card_charge": False},
    )


class GiftCardTests(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")

    def test_create_gift_card_defaults(self):
        card = create_gift_card(self.salon, Decimal("100"))
        self.assertEqual(len(card.code), 12)
        self.assertEqual(card.balance, Decimal("100"))
        self.assertEqual(card.payment_status, GiftCard.PaymentStatus.UNPAID)
        self.assertEqual(card.status, GiftCard.Status.ACTIVE)

    def test_redeem_scales_balance_and_blocks_over_balance(self):
        card = create_gift_card(self.salon, Decimal("100"), paid=True, paid_method="cash")
        redeem_gift_card(self.salon, card.code, Decimal("40"))
        card.refresh_from_db()
        self.assertEqual(card.balance, Decimal("60"))
        self.assertEqual(card.status, GiftCard.Status.ACTIVE)

        with self.assertRaises(HttpError) as caught:
            redeem_gift_card(self.salon, card.code, Decimal("70"))
        self.assertEqual(caught.exception.status_code, 422)
        card.refresh_from_db()
        self.assertEqual(card.balance, Decimal("60"))  # saldo intatto

        redeem_gift_card(self.salon, card.code, Decimal("60"))
        card.refresh_from_db()
        self.assertEqual(card.balance, Decimal("0"))
        self.assertEqual(card.status, GiftCard.Status.REDEEMED)

    def test_redeem_expired_card(self):
        card = create_gift_card(self.salon, Decimal("50"))
        card.expires_at = timezone.now() - timedelta(days=1)
        card.save(update_fields=["expires_at"])
        with self.assertRaises(HttpError) as caught:
            redeem_gift_card(self.salon, card.code, Decimal("10"))
        self.assertEqual(caught.exception.status_code, 422)
        card.refresh_from_db()
        self.assertEqual(card.status, GiftCard.Status.EXPIRED)


class GiftCardServiceApiTests(TestCase):
    """POST /gift-cards con gift_service_id: valore = prezzo del servizio."""

    def setUp(self):
        from apps.accounts.models import Membership, Role, User
        from apps.catalog.models import Service, ServiceCategory

        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        user = User.objects.create_user(email="sole@theparlour.it", password="theparlour")
        role = Role.objects.create(salon=self.salon, name="Manager", scopes=["marketing"])
        Membership.objects.create(user=user, salon=self.salon, role=role, is_owner=True)
        tokens = create_staff_tokens(user, self.salon)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}

        category = ServiceCategory.objects.create(salon=self.salon, name_it="Viso")
        self.service = Service.objects.create(
            salon=self.salon,
            category=category,
            name_it="Trattamento viso",
            duration_min=60,
            price=Decimal("75.00"),
        )

    def _post(self, payload):
        return self.client.post(
            "/api/marketing/gift-cards",
            data=json.dumps(payload),
            content_type="application/json",
            **self.auth,
        )

    def test_create_treatment_gift_card_uses_service_price(self):
        # `value` volutamente diverso dal prezzo: dev'essere ignorato.
        resp = self._post({"value": "10", "gift_service_id": self.service.id})
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(Decimal(body["initial_value"]), Decimal("75.00"))
        self.assertEqual(Decimal(body["balance"]), Decimal("75.00"))
        self.assertEqual(body["gift_service_id"], self.service.id)
        self.assertEqual(body["gift_service_name"], "Trattamento viso")

        card = GiftCard.objects.get(id=body["id"])
        self.assertEqual(card.gift_service_id, self.service.id)
        self.assertEqual(card.initial_value, Decimal("75.00"))
        self.assertEqual(card.balance, Decimal("75.00"))

    def test_monetary_gift_card_unaffected(self):
        resp = self._post({"value": "50"})
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(Decimal(body["initial_value"]), Decimal("50"))
        self.assertEqual(Decimal(body["balance"]), Decimal("50"))
        self.assertIsNone(body["gift_service_id"])
        self.assertIsNone(body["gift_service_name"])

        card = GiftCard.objects.get(id=body["id"])
        self.assertIsNone(card.gift_service_id)

    def test_unknown_service_id_404(self):
        resp = self._post({"value": "75", "gift_service_id": 999999})
        self.assertEqual(resp.status_code, 404, resp.content)


class LoyaltyTests(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        self.client_obj = _make_client(self.salon)
        self.program = LoyaltyProgram.objects.create(
            salon=self.salon,
            name="Punti Parlour",
            type=LoyaltyProgram.Type.POINTS,
            earn_metric=LoyaltyProgram.EarnMetric.PER_EURO,
            earn_ratio=Decimal("1"),
            reward_type=LoyaltyProgram.RewardType.COUPON_AMOUNT,
            reward_value=Decimal("10"),
            threshold=80,
            enrollment=LoyaltyProgram.Enrollment.AUTO,
        )

    def _sale(self, total, client=None):
        from apps.sales.models import Sale  # lazy: app di un altro agente

        return Sale.objects.create(
            salon=self.salon, kind="pos", client=client, total=Decimal(total)
        )

    def test_accrue_threshold_creates_loyalty_coupon(self):
        accrue_loyalty(self._sale("100", client=self.client_obj))

        account = LoyaltyAccount.objects.get(program=self.program, client=self.client_obj)
        self.assertEqual(account.points, 20)  # 100 accreditati − 80 di soglia

        coupon = Coupon.objects.get(salon=self.salon, origin=Coupon.Origin.LOYALTY)
        self.assertEqual(coupon.client_id, self.client_obj.id)
        self.assertEqual(coupon.kind, Coupon.Kind.AMOUNT)
        self.assertEqual(coupon.value, Decimal("10"))
        self.assertEqual(len(coupon.code), 8)

        event = OutboxEvent.objects.get(salon=self.salon, event_type="loyalty.reward")
        self.assertEqual(event.payload["coupon_code"], coupon.code)

    def test_accrue_below_threshold_no_coupon(self):
        accrue_loyalty(self._sale("30", client=self.client_obj))
        account = LoyaltyAccount.objects.get(program=self.program, client=self.client_obj)
        self.assertEqual(account.points, 30)
        self.assertFalse(Coupon.objects.exists())

    def test_accrue_noop_without_client(self):
        accrue_loyalty(self._sale("100", client=None))
        self.assertFalse(LoyaltyAccount.objects.exists())
        self.assertFalse(Coupon.objects.exists())

    def test_no_auto_enroll_when_enrollment_request(self):
        self.program.enrollment = LoyaltyProgram.Enrollment.REQUEST
        self.program.save(update_fields=["enrollment"])
        accrue_loyalty(self._sale("100", client=self.client_obj))
        self.assertFalse(LoyaltyAccount.objects.exists())


class CouponTests(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")

    def test_validate_coupon_expired(self):
        coupon = Coupon.objects.create(
            salon=self.salon,
            code="ABCD2345",
            kind=Coupon.Kind.AMOUNT,
            value=Decimal("10"),
            expires_at=timezone.now() - timedelta(days=1),
        )
        with self.assertRaises(HttpError) as caught:
            validate_coupon(self.salon, "ABCD2345")
        self.assertEqual(caught.exception.status_code, 422)
        coupon.refresh_from_db()
        self.assertEqual(coupon.status, Coupon.Status.EXPIRED)

    def test_validate_coupon_not_found_and_client_bound(self):
        with self.assertRaises(HttpError) as caught:
            validate_coupon(self.salon, "MANCANTE")
        self.assertEqual(caught.exception.status_code, 404)

        owner = _make_client(self.salon, first_name="Anna", phone="+393334445566")
        other = _make_client(self.salon, first_name="Marta", phone="+393337778899")
        Coupon.objects.create(
            salon=self.salon,
            client=owner,
            code="XYZ98765",
            kind=Coupon.Kind.PERCENT,
            value=Decimal("15"),
        )
        self.assertEqual(validate_coupon(self.salon, "XYZ98765", client=owner).code, "XYZ98765")
        with self.assertRaises(HttpError) as caught:
            validate_coupon(self.salon, "XYZ98765", client=other)
        self.assertEqual(caught.exception.status_code, 422)


class ClientIdFilterApiTests(TestCase):
    """GET /coupons e /gift-cards: filtro opzionale client_id (staff, per singolo cliente)."""

    def setUp(self):
        from apps.accounts.models import Membership, Role, User

        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        user = User.objects.create_user(email="sole@theparlour.it", password="theparlour")
        role = Role.objects.create(salon=self.salon, name="Manager", scopes=["marketing"])
        Membership.objects.create(user=user, salon=self.salon, role=role, is_owner=True)
        tokens = create_staff_tokens(user, self.salon)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}

        self.sofia = _make_client(self.salon, first_name="Sofia", phone="+393331110001")
        self.giulia = _make_client(self.salon, first_name="Giulia", phone="+393331110002")

    def test_list_coupons_filters_by_client_id(self):
        mine = Coupon.objects.create(
            salon=self.salon,
            client=self.sofia,
            code="MINE0001",
            kind=Coupon.Kind.AMOUNT,
            value=Decimal("10"),
        )
        Coupon.objects.create(
            salon=self.salon,
            client=self.giulia,
            code="OTHR0001",
            kind=Coupon.Kind.AMOUNT,
            value=Decimal("5"),
        )
        Coupon.objects.create(
            salon=self.salon,
            code="NOCLI001",
            kind=Coupon.Kind.PERCENT,
            value=Decimal("15"),
        )

        resp = self.client.get("/api/marketing/coupons", **self.auth)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["count"], 3)  # invariato senza il filtro

        resp = self.client.get(
            f"/api/marketing/coupons?client_id={self.sofia.id}", **self.auth
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["items"][0]["id"], mine.id)

    def test_list_gift_cards_filters_by_buyer_or_recipient(self):
        bought = create_gift_card(self.salon, Decimal("50"), buyer_client=self.sofia)
        received = create_gift_card(self.salon, Decimal("30"))
        received.recipient_client = self.sofia
        received.save(update_fields=["recipient_client"])
        create_gift_card(self.salon, Decimal("20"), buyer_client=self.giulia)

        resp = self.client.get("/api/marketing/gift-cards", **self.auth)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(resp.json()["items"]), 3)  # invariato senza il filtro

        resp = self.client.get(
            f"/api/marketing/gift-cards?client_id={self.sofia.id}", **self.auth
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = {item["id"] for item in resp.json()["items"]}
        self.assertEqual(ids, {bought.id, received.id})


class CommunicationTests(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")

    def test_send_resolves_labels_and_marketing_consent(self):
        from apps.clients.models import ClientCategory  # lazy: app di un altro agente

        category = ClientCategory.objects.create(
            salon=self.salon, name="VIP", color="#F59E0B", order=0
        )
        with_consent = _make_client(self.salon, first_name="Sofia", phone="+393331112233")
        without_consent = _make_client(
            self.salon, first_name="Marta", phone="+393334445566", marketing=False
        )
        with_consent.categories.add(category)
        without_consent.categories.add(category)

        comm = Communication.objects.create(
            salon=self.salon,
            title="Promo estate",
            body="Sconto 20% su tutti i trattamenti viso",
            audience_type=Communication.AudienceType.LABELS,
            audience=[category.id],
        )
        send_communication(comm)

        comm.refresh_from_db()
        self.assertEqual(comm.status, Communication.Status.SENT)
        self.assertIsNotNone(comm.sent_at)

        event = OutboxEvent.objects.get(salon=self.salon, event_type="communication.send")
        self.assertEqual(event.payload["client_ids"], [with_consent.id])
        self.assertEqual(event.payload["langs"], {str(with_consent.id): with_consent.lang})
        self.assertNotIn("scheduled_at", event.payload)

    def test_send_scheduled_emits_event_immediately(self):
        client = _make_client(self.salon)
        when = timezone.now() + timedelta(days=2)
        comm = Communication.objects.create(
            salon=self.salon,
            title="Auguri",
            body="Buone feste!",
            audience_type=Communication.AudienceType.CLIENTS,
            audience=[client.id],
        )
        send_communication(comm, scheduled_at=when)

        comm.refresh_from_db()
        self.assertEqual(comm.status, Communication.Status.SCHEDULED)
        self.assertIsNone(comm.sent_at)

        event = OutboxEvent.objects.get(salon=self.salon, event_type="communication.send")
        self.assertEqual(event.payload["scheduled_at"], when.isoformat())
        self.assertEqual(event.payload["client_ids"], [client.id])
