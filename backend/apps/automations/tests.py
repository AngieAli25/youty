import json
import uuid

from common.testing import SubscribedSalonTestCase as TestCase

from apps.accounts.models import Membership, Role, User
from apps.core.models import OutboxEvent, Salon
from common.auth import create_staff_tokens

from .models import Automation


class AutomationsApiTests(TestCase):
    """CRUD + toggle su outbox; webhook con token valido/invalido."""

    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        self.user = User.objects.create_user(email="owner@the-parlour.test", password="pw12345!")
        self.role = Role.objects.create(salon=self.salon, name="Manager", scopes=["marketing"])
        Membership.objects.create(
            user=self.user, salon=self.salon, role=self.role, is_owner=True
        )
        tokens = create_staff_tokens(self.user, self.salon)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}

    def _post(self, path, payload=None):
        return self.client.post(
            path,
            data=json.dumps(payload or {}),
            content_type="application/json",
            **self.auth,
        )

    def _put(self, path, payload):
        return self.client.put(
            path, data=json.dumps(payload), content_type="application/json", **self.auth
        )

    def test_crud_and_toggle_emit_outbox_events(self):
        create_payload = {
            "name": "Promemoria appuntamento",
            "event": "appointment_upcoming",
            "offset_direction": "before",
            "offset_value": 2,
            "offset_unit": "hours",
        }
        resp = self._post("/api/automations/", create_payload)
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        automation_id = body["id"]
        self.assertTrue(body["active"])
        self.assertEqual(body["message_preview"], "")
        self.assertIn(str(Automation.objects.get(id=automation_id).webhook_token), body["webhook_url"])
        self.assertEqual(
            OutboxEvent.objects.filter(salon=self.salon, event_type="automation.updated").count(), 1
        )

        # update (PUT è sostituzione integrale)
        update_payload = dict(create_payload, name="Promemoria appuntamento (modificato)")
        resp = self._put(f"/api/automations/{automation_id}", update_payload)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["name"], update_payload["name"])
        self.assertEqual(
            OutboxEvent.objects.filter(salon=self.salon, event_type="automation.updated").count(), 2
        )

        # toggle
        resp = self.client.post(f"/api/automations/{automation_id}/toggle", **self.auth)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(resp.json()["active"])
        self.assertEqual(
            OutboxEvent.objects.filter(salon=self.salon, event_type="automation.updated").count(), 3
        )

        # list
        resp = self.client.get("/api/automations/", **self.auth)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

        # delete
        resp = self.client.delete(f"/api/automations/{automation_id}", **self.auth)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertFalse(Automation.objects.filter(id=automation_id).exists())
        self.assertEqual(
            OutboxEvent.objects.filter(salon=self.salon, event_type="automation.updated").count(), 4
        )

    def test_write_requires_marketing_scope(self):
        other_role = Role.objects.create(salon=self.salon, name="Front desk", scopes=["agenda"])
        other_user = User.objects.create_user(email="frontdesk@the-parlour.test", password="pw12345!")
        Membership.objects.create(
            user=other_user, salon=self.salon, role=other_role, is_owner=False
        )
        tokens = create_staff_tokens(other_user, self.salon)
        auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}
        resp = self.client.post(
            "/api/automations/",
            data=json.dumps({"name": "X", "event": "birthday"}),
            content_type="application/json",
            **auth,
        )
        self.assertEqual(resp.status_code, 403)

    def test_events_catalog(self):
        resp = self.client.get("/api/automations/events-catalog", **self.auth)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["events"]), 8)
        self.assertTrue(any(e["value"] == "appointment_upcoming" for e in data["events"]))
        self.assertTrue(any(o["value"] == "contains" for o in data["operators"]))
        self.assertTrue(any(f["value"] == "reliability" for f in data["fields"]))

    def test_webhook_valid_token_emits_and_logs(self):
        automation = Automation.objects.create(
            salon=self.salon,
            name="Automazione via webhook",
            event="no_show",
            trigger_origin=Automation.TriggerOrigin.WEBHOOK,
        )
        resp = self.client.post(
            f"/api/automations/hook/{automation.webhook_token}",
            data=json.dumps({"client_id": 42}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["automation_id"], automation.id)
        self.assertEqual(
            OutboxEvent.objects.filter(
                salon=self.salon, event_type="automation.triggered"
            ).count(),
            1,
        )
        event = OutboxEvent.objects.get(salon=self.salon, event_type="automation.triggered")
        self.assertEqual(event.payload["automation_id"], automation.id)
        self.assertEqual(event.payload["payload"], {"client_id": 42})

    def test_webhook_unknown_token_returns_404(self):
        resp = self.client.post(f"/api/automations/hook/{uuid.uuid4()}")
        self.assertEqual(resp.status_code, 404)

    def test_webhook_malformed_token_returns_404(self):
        resp = self.client.post("/api/automations/hook/not-a-valid-uuid")
        self.assertEqual(resp.status_code, 404)
