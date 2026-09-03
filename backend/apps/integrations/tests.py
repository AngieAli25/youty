"""Self-check dell'integrazione Yourang: firma webhook, normalizzazione telefono,
idempotenza import evento.

Niente più round-trip di cifratura: dal passaggio al proxy il portale non
custodisce token, quindi non c'è nulla da cifrare.

    python manage.py test apps.integrations
"""

import hashlib
import hmac
import time
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase, override_settings

from .api import _verify_webhook
from .sync import import_event, normalize_phone

WEBHOOK_SECRET = "s3cret"


@override_settings(YOURANG_PROXY_WEBHOOK_SECRET=WEBHOOK_SECRET)
class SignatureTests(SimpleTestCase):
    """La firma è quella che il PROXY appone ri-emettendo: stesso schema della
    piattaforma (HMAC su "{timestamp}.{body}"), segreto diverso."""

    def _sign(self, body: bytes, ts: str) -> str:
        signed = f"{ts}.".encode() + body
        return "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), signed, hashlib.sha256).hexdigest()

    def test_valid_signature(self):
        body, ts = b'{"a":1}', str(int(time.time()))
        self.assertTrue(_verify_webhook(body, self._sign(body, ts), ts))

    def test_wrong_signature_rejected(self):
        body, ts = b'{"a":1}', str(int(time.time()))
        self.assertFalse(_verify_webhook(body, "sha256=deadbeef", ts))

    def test_stale_timestamp_rejected(self):
        body = b'{"a":1}'
        ts = str(int(time.time()) - 10_000)
        self.assertFalse(_verify_webhook(body, self._sign(body, ts), ts))

    @override_settings(YOURANG_PROXY_WEBHOOK_SECRET="")
    def test_unconfigured_secret_fails_closed(self):
        """La rotta è pubblica: senza segreto si rifiuta, non si accetta."""
        body, ts = b'{"a":1}', str(int(time.time()))
        self.assertFalse(_verify_webhook(body, self._sign(body, ts), ts))


class PhoneTests(SimpleTestCase):
    def test_italian_default_cc(self):
        self.assertEqual(normalize_phone("333 1234567"), "+393331234567")

    def test_passthrough_e164(self):
        self.assertEqual(normalize_phone("+41 79 123 45 67"), "+41791234567")

    def test_double_zero_prefix(self):
        self.assertEqual(normalize_phone("0039 333 1234567"), "+393331234567")

    def test_garbage_returns_none(self):
        self.assertIsNone(normalize_phone("n/a"))


class ContactPushTests(TestCase):
    """Il push usa POST /contacts: l'external API non ha un upsert by-phone."""

    def setUp(self):
        from apps.core.models import Salon
        from apps.integrations.models import YourangConnection

        self.salon = Salon.objects.create(name="Test Salon", slug="test-salon-push")
        self.conn = YourangConnection.objects.create(salon=self.salon, yourang_org_id="org2")

    def _push(self, request_mock):
        from apps.clients.models import Client
        from apps.integrations.sync import sync_clients

        Client.objects.create(
            salon=self.salon, first_name="Mario", last_name="Rossi", phone="+393331234567"
        )
        with patch("apps.integrations.client.YourangClient.list_contacts", return_value=[]), \
             patch("apps.integrations.client.YourangClient._request", request_mock):
            report = sync_clients(self.conn)
        return report, Client.objects.get(phone="+393331234567")

    def test_pushes_with_post(self):
        resp = Mock()
        resp.json.return_value = {"ok": True, "data": {"id": "c-1"}}
        req = Mock(return_value=resp)
        report, client = self._push(req)

        method, path = req.call_args.args
        self.assertEqual((method, path), ("POST", "/contacts"))
        self.assertEqual(req.call_args.kwargs["json"]["phone_number"], "+393331234567")
        self.assertEqual(report.pushed, 1)
        self.assertEqual(client.yourang_contact_id, "c-1")

    def test_duplicate_phone_falls_back_to_lookup(self):
        import httpx

        ok = Mock()
        ok.json.return_value = {"ok": True, "data": {"id": "c-9"}}
        conflict = httpx.HTTPStatusError(
            "400", request=Mock(), response=Mock(status_code=400)
        )
        req = Mock(side_effect=[conflict, ok])
        report, client = self._push(req)

        self.assertEqual(req.call_args.args[0], "GET")
        self.assertIn("/contacts/by-phone/", req.call_args.args[1])
        self.assertEqual(client.yourang_contact_id, "c-9")
        self.assertEqual(report.errors, [])


class LoginIdentityTests(TestCase):
    """Un'org già collegata dà il SALONE, mai l'utente titolare: chi accede
    entra con la propria identità Yourang."""

    def test_mapped_org_does_not_return_the_owner(self):
        from apps.accounts.models import Membership, User
        from apps.core.models import Salon
        from apps.integrations.login import _resolve_salon
        from apps.integrations.models import YourangConnection

        salon = Salon.objects.create(name="Salone", slug="salone-org")
        owner = User.objects.create_user(email="titolare@x.it", password=None)
        Membership.objects.create(user=owner, salon=salon, is_owner=True)
        YourangConnection.objects.create(salon=salon, yourang_org_id="org3")

        self.assertEqual(
            _resolve_salon("org3", "collega@x.it", True), (salon, None)
        )


class ImportEventIdempotencyTests(TestCase):
    def setUp(self):
        from apps.core.models import Salon
        from apps.integrations.models import YourangConnection
        from apps.staff.models import Operator

        self.salon = Salon.objects.create(name="Test Salon", slug="test-salon")
        Operator.objects.create(salon=self.salon, first_name="Anna", last_name="B")
        self.conn = YourangConnection.objects.create(salon=self.salon, yourang_org_id="org1")

    def test_same_event_upserts_once(self):
        from apps.agenda.models import Appointment

        event = {
            "id": "evt-1",
            "client_full_name": "Mario Rossi",
            "client_phone_number": "3331234567",
            "starting_date": "2026-08-01T10:00:00+02:00",
            "status": "confirmed",
        }
        with patch("apps.integrations.sync.YourangClient.get_event", return_value=event):
            import_event(self.conn, "evt-1")
            import_event(self.conn, "evt-1")

        self.assertEqual(Appointment.objects.filter(yourang_event_id="evt-1").count(), 1)
