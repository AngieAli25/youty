"""Self-check dell'integrazione Yourang: firma webhook, normalizzazione telefono,
round-trip cifratura, idempotenza import evento.

    python manage.py test apps.integrations
"""

import hashlib
import hmac
import time
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase, override_settings

from . import crypto
from .sync import import_event, normalize_phone

# 32-byte hex key (openssl rand -hex 32) — stesso formato di food/real_estate.
TEST_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"


class SignatureTests(SimpleTestCase):
    secret = "s3cret"

    def _sign(self, body: bytes, ts: str) -> str:
        signed = f"{ts}.".encode() + body
        return "sha256=" + hmac.new(self.secret.encode(), signed, hashlib.sha256).hexdigest()

    def test_valid_signature(self):
        body, ts = b'{"a":1}', str(int(time.time()))
        self.assertTrue(crypto.verify_signature(body, self._sign(body, ts), ts, self.secret))

    def test_wrong_signature_rejected(self):
        body, ts = b'{"a":1}', str(int(time.time()))
        self.assertFalse(crypto.verify_signature(body, "sha256=deadbeef", ts, self.secret))

    def test_stale_timestamp_rejected(self):
        body = b'{"a":1}'
        ts = str(int(time.time()) - 10_000)
        self.assertFalse(crypto.verify_signature(body, self._sign(body, ts), ts, self.secret))


class PhoneTests(SimpleTestCase):
    def test_italian_default_cc(self):
        self.assertEqual(normalize_phone("333 1234567"), "+393331234567")

    def test_passthrough_e164(self):
        self.assertEqual(normalize_phone("+41 79 123 45 67"), "+41791234567")

    def test_double_zero_prefix(self):
        self.assertEqual(normalize_phone("0039 333 1234567"), "+393331234567")

    def test_italian_landline_keeps_the_area_zero(self):
        # In Italia lo 0 di distretto fa parte del numero: +39 02 …, non +39 2 …
        self.assertEqual(normalize_phone("02 1234567"), "+39021234567")
        self.assertEqual(normalize_phone("0577 12345"), "+39057712345")

    def test_italian_landline_spellings_converge(self):
        # Il fallimento vero: due modi di scrivere lo stesso fisso non devono
        # dare due chiavi diverse, o diventano due contatti Yourang.
        self.assertEqual(normalize_phone("011 1234567"), normalize_phone("+39 011 1234567"))
        self.assertEqual(normalize_phone("011 1234567"), normalize_phone("0039 011 1234567"))

    def test_foreign_trunk_zero_dropped(self):
        # Fuori dall'Italia lo 0 iniziale è prefisso interurbano e va tolto.
        self.assertEqual(normalize_phone("0161 4960000", default_cc="44"), "+441614960000")

    def test_foreign_landline_spellings_converge(self):
        # L'altra faccia dello stesso errore: lo 0 va tolto anche quando il
        # numero arriva già con il suo prefisso internazionale.
        self.assertEqual(normalize_phone("+44 020 7946 0958"), "+442079460958")
        self.assertEqual(normalize_phone("+44 020 7946 0958"), normalize_phone("+44 20 7946 0958"))
        self.assertEqual(normalize_phone("0049 030 12345678"), normalize_phone("+49 30 12345678"))

    def test_unknown_country_code_left_untouched(self):
        # CC fuori tabella: intatto è meglio che accorciato a caso.
        self.assertEqual(normalize_phone("+675 0123456"), "+6750123456")

    def test_garbage_returns_none(self):
        self.assertIsNone(normalize_phone("n/a"))


@override_settings(ENCRYPTION_KEY=TEST_KEY)
class CryptoRoundTripTests(SimpleTestCase):
    def test_round_trip(self):
        self.assertEqual(crypto.decrypt(crypto.encrypt("token-abc")), "token-abc")

    def test_empty(self):
        self.assertEqual(crypto.encrypt(""), "")
        self.assertEqual(crypto.decrypt(""), "")


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
