"""Real auth/resolver/guards with only the remote authority mocked."""
import datetime as dt
import importlib
import io
import json
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import Membership, Role, User
from apps.clients.models import Client
from apps.integrations.models import YourangConnection
from common.auth import StaffContext, create_client_tokens, create_staff_tokens
from common.portal_access import PortalAccessDenied, resolve_portal_access, require_portal_access
from .models import ActivityLog, OutboxEvent, Salon, SalonSettings


@override_settings(
    YOURANG_PROXY_URL="https://connect.test", YOURANG_PROXY_SLUG="beauty",
    YOURANG_PROXY_API_KEY="test-portal-key", YOURANG_MARKETPLACE_URL="https://dashboard.test/plans/configure",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class PortalAccessTests(TestCase):
    def setUp(self):
        cache.clear()
        self.now = timezone.now()
        self.salon = Salon.objects.create(name="Salon", slug="salon")
        self.conn = YourangConnection.objects.create(salon=self.salon, yourang_org_id="org-1")
        self.user = User.objects.create_user(email="owner@test.test", password="test-password")
        self.membership = Membership.objects.create(salon=self.salon, user=self.user, is_owner=True)
        self.headers = {"HTTP_AUTHORIZATION": "Bearer " + create_staff_tokens(self.user, self.salon)["access"]}
        self.customer = Client.objects.create(salon=self.salon, first_name="Customer", phone="+393330000001")
        self.client_headers = {"HTTP_AUTHORIZATION": "Bearer " + create_client_tokens(self.customer)["access"]}
        self.remote = patch("apps.integrations.client.YourangClient.portal_access").start()
        self.addCleanup(patch.stopall)
        self.allow(False)

    def allow(self, active, **overrides):
        self.remote.side_effect = None
        self.remote.return_value = {
            "organization_id": self.conn.yourang_org_id, "portal_type": "beauty", "module_type": "portal_beauty",
            "variant": "pro" if active else None, "operational_access": active, "expires_at": None,
            "checked_at": self.now.isoformat(), "valid_until": (self.now + dt.timedelta(seconds=60)).isoformat(),
            "purchase_url": "https://brand.test/plans/configure", **overrides,
        }
        cache.clear()

    def post(self, path, data, headers=None):
        return self.client.post(path, data=json.dumps(data), content_type="application/json", **(headers or {}))

    def test_matching_access_preserves_variant_and_canonical_purchase_link(self):
        self.allow(True)
        access = resolve_portal_access(self.salon)
        self.assertTrue(access["operational_access"])
        self.assertEqual(access["variant"], "pro")
        self.assertEqual(access["purchase_url"], "https://brand.test/plans/configure")
        resolve_portal_access(self.salon)
        self.remote.assert_called_once()

    def test_wrong_organization_or_product_or_portal_fails_closed(self):
        for mismatch in ({"organization_id": "other"}, {"portal_type": "food"}, {"module_type": "portal_food"}, {"operational_access": "true"}):
            with self.subTest(mismatch=mismatch):
                self.allow(True, **mismatch)
                self.assertEqual(resolve_portal_access(self.salon)["status"], "unavailable")

    def test_missing_connection_is_read_only_without_network(self):
        self.conn.delete()
        self.assertEqual(resolve_portal_access(self.salon)["status"], "unavailable")
        self.remote.assert_not_called()

    def test_cache_cannot_extend_deadline_or_expiry(self):
        expiry = self.now + dt.timedelta(seconds=5)
        self.allow(True, expires_at=expiry.isoformat(), valid_until=(self.now + dt.timedelta(hours=1)).isoformat())
        with patch("common.portal_access.timezone.now", return_value=self.now):
            self.assertEqual(resolve_portal_access(self.salon)["valid_until"], expiry.isoformat())
        with patch("common.portal_access.timezone.now", return_value=expiry):
            self.assertFalse(resolve_portal_access(self.salon)["operational_access"])
        self.assertEqual(self.remote.call_count, 2)

    def test_renewing_grant_without_expiry_is_limited_to_sixty_seconds(self):
        self.allow(True, valid_until=(self.now + dt.timedelta(hours=1)).isoformat())
        with patch("common.portal_access.timezone.now", return_value=self.now):
            self.assertEqual(resolve_portal_access(self.salon)["valid_until"], (self.now + dt.timedelta(seconds=60)).isoformat())
        self.remote.side_effect = httpx.ConnectError("unavailable")
        with patch("common.portal_access.timezone.now", return_value=self.now + dt.timedelta(seconds=60)):
            self.assertEqual(resolve_portal_access(self.salon)["status"], "unavailable")

    def test_stale_naive_missing_and_future_decisions_are_unavailable(self):
        for override in ({"valid_until": self.now.isoformat()}, {"checked_at": "2026-09-09T10:00:00"}, {"valid_until": None}, {"checked_at": (self.now + dt.timedelta(minutes=1)).isoformat()}):
            with self.subTest(override=override):
                self.allow(True, **override)
                self.assertEqual(resolve_portal_access(self.salon)["status"], "unavailable")

    def test_credentials_rotation_disconnect_and_org_switch_invalidate_cache(self):
        self.allow(True)
        self.assertTrue(resolve_portal_access(self.salon)["operational_access"])
        self.remote.side_effect = httpx.ConnectError("revoked")
        with override_settings(YOURANG_PROXY_API_KEY="rotated"):
            self.assertFalse(resolve_portal_access(self.salon)["operational_access"])
        self.conn.status = "disconnected"
        self.conn.save()
        self.assertFalse(resolve_portal_access(self.salon)["operational_access"])
        self.conn.status = "connected"
        self.conn.yourang_org_id = "org-2"
        self.conn.save()
        self.remote.side_effect = None
        self.assertFalse(resolve_portal_access(self.salon)["operational_access"])

    def test_auth_and_read_browsing_survive_verification_failure(self):
        self.remote.side_effect = httpx.ConnectError("offline")
        login = self.post("/api/auth/staff/login", {"email": self.user.email, "password": "test-password"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["portal_access"]["status"], "unavailable")
        for url in ("/api/auth/me", "/api/core/salon", "/api/clients/", "/api/catalog/services"):
            self.assertEqual(self.client.get(url, **self.headers).status_code, 200)
        self.assertFalse(SalonSettings.objects.filter(salon=self.salon).exists())

    def test_http_mutation_has_no_business_side_effects(self):
        before = (Client.objects.count(), ActivityLog.objects.count(), OutboxEvent.objects.count())
        response = self.post("/api/clients/", {"first_name": "Blocked", "last_name": "", "phone": "+393330000002"}, self.headers)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "portal_access_subscription_required")
        self.assertEqual(before, (Client.objects.count(), ActivityLog.objects.count(), OutboxEvent.objects.count()))

    def test_direct_business_view_bypass_is_guarded_in_every_domain(self):
        request = SimpleNamespace(auth=StaffContext(self.user, self.salon, self.membership, is_owner=True))
        checked = 0
        for domain in ("accounts", "agenda", "automations", "catalog", "clients", "core", "insights", "inventory", "marketing", "sales", "staff"):
            module = importlib.import_module(f"apps.{domain}.api")
            for name, view in vars(module).items():
                if getattr(view, "portal_business_operation", False):
                    with self.subTest(domain=domain, view=name):
                        with self.assertRaises(PortalAccessDenied):
                            view(request)
                    checked += 1
        self.assertGreater(checked, 90)
        self.assertEqual(ActivityLog.objects.count(), 0)
        self.assertEqual(OutboxEvent.objects.count(), 0)

    def test_public_booking_and_anonymous_leads_are_neutral_and_do_not_write(self):
        response = self.post("/api/agenda/client/appointments", {"items": [], "start": self.now.isoformat()}, self.client_headers)
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("abbonamento", response.json()["detail"].lower())
        with patch("apps.clients.api.Client.objects.create") as create:
            response = self.post("/api/clients/public/hook", {"salon_slug": self.salon.slug, "first_name": "Anon", "phone": "+393330000004", "privacy": True})
            self.assertEqual(response.status_code, 403)
            create.assert_not_called()

    def test_public_access_hides_billing_and_org(self):
        response = self.client.get("/api/core/public/portal-access", {"salon": self.salon.slug})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"operational_access", "checked_at", "valid_until"})
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_paid_subscription_does_not_grant_role_or_cross_tenant_access(self):
        self.allow(True)
        self.membership.is_owner = False
        self.membership.role = Role.objects.create(salon=self.salon, name="Viewer", scopes=[])
        self.membership.save()
        response = self.post("/api/clients/", {"first_name": "Blocked", "phone": "+393330000005"}, self.headers)
        self.assertEqual(response.status_code, 403)
        self.assertIn("Permesso", response.json()["detail"])
        self.membership.is_owner = True
        self.membership.save()
        other = Salon.objects.create(name="Other", slug="other")
        obj = Client.objects.create(salon=other, first_name="Other", phone="+393330000006")
        self.assertEqual(self.client.delete(f"/api/clients/{obj.id}", **self.headers).status_code, 404)
        obj.refresh_from_db()
        self.assertTrue(obj.is_active)

    def test_revoked_local_session_cannot_read_cached_access(self):
        self.allow(True)
        resolve_portal_access(self.salon)
        self.user.token_version += 1
        self.user.save()
        self.assertEqual(self.client.get("/api/auth/portal-access", **self.headers).status_code, 401)

    def test_cached_sessions_observe_purchase_and_cancellation_by_one_minute(self):
        self.assertFalse(self.client.get("/api/auth/portal-access", **self.headers).json()["operational_access"])
        self.remote.return_value.update(operational_access=True, variant="full")
        later = self.now + dt.timedelta(seconds=60)
        self.remote.return_value.update(checked_at=later.isoformat(), valid_until=(later + dt.timedelta(seconds=60)).isoformat())
        with patch("common.portal_access.timezone.now", return_value=later):
            self.assertTrue(self.client.get("/api/auth/portal-access", **self.headers).json()["operational_access"])
        later += dt.timedelta(seconds=60)
        self.remote.return_value.update(operational_access=False, checked_at=later.isoformat(), valid_until=(later + dt.timedelta(seconds=60)).isoformat())
        with patch("common.portal_access.timezone.now", return_value=later):
            self.assertFalse(self.client.get("/api/auth/portal-access", **self.headers).json()["operational_access"])

    def test_failed_check_recovers_without_login(self):
        self.remote.side_effect = httpx.ConnectError("offline")
        self.assertEqual(self.client.get("/api/auth/portal-access", **self.headers).json()["status"], "unavailable")
        self.allow(True)
        self.assertTrue(self.client.get("/api/auth/portal-access", **self.headers).json()["operational_access"])

    def test_sso_login_remains_available_and_skips_initial_sync(self):
        from apps.integrations.login import login_with_link_code
        with patch("apps.integrations.client.redeem_link_code", return_value={"org_id": self.conn.yourang_org_id, "email": self.user.email, "email_verified": True}), patch("apps.integrations.login.sync_clients") as sync:
            session = login_with_link_code("one-time-code")
            self.assertIn("access", session)
            self.assertFalse(session["portal_access"]["operational_access"])
            sync.assert_not_called()

    def test_direct_sync_and_payment_jobs_are_blocked_before_network_or_writes(self):
        from apps.integrations.sync import sync_clients, sync_services, import_event, cancel_event
        from apps.sales.stripe_service import create_setup_intent
        with patch("httpx.request") as network, patch("apps.sales.stripe_service._client") as stripe:
            for fn,args in ((sync_clients,(self.conn,)),(sync_services,(self.conn,)),(import_event,(self.conn,"id")),(cancel_event,(self.conn,"id")),(create_setup_intent,(self.customer,))):
                with self.subTest(fn=fn.__name__), self.assertRaises(PortalAccessDenied):
                    fn(*args)
            network.assert_not_called()
            stripe.assert_not_called()

    def test_background_jobs_log_skip_and_never_requeue_outbox(self):
        event = OutboxEvent.objects.create(salon=self.salon, event_type="communication.send")
        otp = OutboxEvent.objects.create(salon=self.salon, event_type="client.otp")
        with self.assertLogs("youty.portal_access", level="WARNING"):
            call_command("flush_outbox", stdout=io.StringIO())
            call_command("sync_yourang", stdout=io.StringIO())
        event.refresh_from_db(); otp.refresh_from_db(); self.conn.refresh_from_db()
        self.assertEqual(event.status, "failed")
        self.assertEqual(otp.status, "pending")
        self.assertEqual(self.conn.status, "connected")
        self.allow(True)
        call_command("flush_outbox", stdout=io.StringIO())
        event.refresh_from_db()
        self.assertEqual(event.status, "failed")

    def test_automation_webhook_is_acknowledged_without_side_effects(self):
        from apps.automations.models import Automation
        automation = Automation.objects.create(salon=self.salon, name="Automation")
        with self.assertLogs("youty.portal_access", level="WARNING"):
            response = self.post(f"/api/automations/hook/{automation.webhook_token}", {"client_id": self.customer.pk})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ActivityLog.objects.exclude(type="integration.sync_paused").exists())
        self.assertTrue(ActivityLog.objects.filter(type="integration.sync_paused").exists())
        self.assertFalse(OutboxEvent.objects.exists())

    def test_remote_credential_revocation_is_unavailable_at_cache_boundary(self):
        self.allow(True)
        resolve_portal_access(self.salon)
        request = httpx.Request("GET", "https://connect.test/v/beauty/api/portal-access/beauty")
        response = httpx.Response(401, request=request)
        self.remote.side_effect = httpx.HTTPStatusError("revoked", request=request, response=response)
        with patch("common.portal_access.timezone.now", return_value=self.now + dt.timedelta(seconds=60)):
            access = resolve_portal_access(self.salon)
        self.assertEqual(access["status"], "unavailable")
        self.assertFalse(access["operational_access"])

    def test_browser_supplied_org_selectors_cannot_change_access_tenant(self):
        self.allow(True)
        response = self.client.get("/api/auth/portal-access?organization_id=other", HTTP_X_YOURANG_ORG="other", **self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["organization_id"], self.conn.yourang_org_id)

    def test_proxy_contract_uses_server_credentials_and_verified_connection(self):
        from apps.integrations.client import YourangClient
        with patch("httpx.request") as request:
            payload = {"ok": True, "data": {"operational_access": False}}
            request.return_value = httpx.Response(200, json=payload, request=httpx.Request("GET", "https://connect.test"))
            client = YourangClient(self.conn)
            client._request("GET", "/portal-access/beauty", timeout=5.0)
            request.assert_called_once_with(
                "GET", "https://connect.test/v/beauty/api/portal-access/beauty",
                headers={"Authorization": "Bearer test-portal-key", "X-Yourang-Org": "org-1"}, timeout=5.0,
            )

    def test_recovery_url_survives_failed_check_for_same_salon_and_org(self):
        self.allow(True)
        resolve_portal_access(self.salon)
        self.remote.side_effect = httpx.ConnectError("offline")
        with patch("common.portal_access.timezone.now", return_value=self.now + dt.timedelta(seconds=60)):
            access = resolve_portal_access(self.salon)
        self.assertEqual(access["status"], "unavailable")
        self.assertEqual(access["purchase_url"], "https://brand.test/plans/configure")
        self.conn.yourang_org_id = "different-org"
        self.conn.save()
        self.assertEqual(resolve_portal_access(self.salon)["purchase_url"], "https://dashboard.test/plans/configure")

    def test_missing_org_cannot_be_classified_as_missing_subscription(self):
        self.conn.yourang_org_id = ""
        self.conn.save()
        self.assertEqual(resolve_portal_access(self.salon)["status"], "unavailable")
        self.remote.assert_not_called()

    def test_reactivation_does_not_replay_skipped_periodic_login_or_connect_sync(self):
        from apps.integrations.access_policy import AutomaticSyncPaused, PAUSED
        from apps.integrations.login import login_with_link_code
        from apps.integrations.sync import sync_clients
        call_command("sync_yourang", stdout=io.StringIO())
        self.assertTrue(ActivityLog.objects.filter(salon=self.salon, type=PAUSED).exists())
        self.allow(True)
        native_count = Client.objects.count()
        with patch("httpx.request") as network:
            call_command("sync_yourang", stdout=io.StringIO())
            with self.assertRaises(AutomaticSyncPaused):
                sync_clients(self.conn)
            with patch("apps.integrations.client.redeem_link_code", return_value={"org_id": self.conn.yourang_org_id, "email": self.user.email, "email_verified": True}):
                self.assertIn("access", login_with_link_code("fresh-login"))
                response = self.post("/api/integrations/yourang/oauth/exchange", {"code": "fresh-connect", "mode": "connect"}, self.headers)
                self.assertEqual(response.status_code, 200)
            network.assert_not_called()
        self.assertEqual(Client.objects.count(), native_count)
        self.customer.refresh_from_db(); self.conn.refresh_from_db()
        self.assertEqual(self.customer.yourang_contact_id, "")
        self.assertEqual(self.conn.catalogue_id, "")
        self.assertIsNone(self.conn.last_sync_at)

    def test_explicit_manual_backfill_is_scoped_authorized_and_audited(self):
        from django.core.management.base import CommandError
        from apps.integrations.access_policy import latest_sync_audit, PAUSED, RESUMED
        from apps.integrations.sync import SyncReport
        call_command("sync_yourang", stdout=io.StringIO())
        with self.assertRaises(CommandError):
            call_command("sync_yourang", allow_backfill=True, stdout=io.StringIO())
        with patch("apps.integrations.management.commands.sync_yourang.sync_clients", return_value=SyncReport()) as clients, patch("apps.integrations.management.commands.sync_yourang.sync_services", return_value=SyncReport()):
            call_command("sync_yourang", salon=self.salon.pk, allow_backfill=True, stdout=io.StringIO())
            clients.assert_not_called()
            self.assertEqual(latest_sync_audit(self.salon).type, PAUSED)
            self.allow(True)
            call_command("sync_yourang", salon=self.salon.pk, allow_backfill=True, stdout=io.StringIO())
            self.assertEqual(clients.call_args.kwargs, {"allow_backfill": True})
            self.assertEqual(latest_sync_audit(self.salon).type, RESUMED)

    @override_settings(YOURANG_PROXY_WEBHOOK_SECRET="sync-test-secret")
    def test_new_signed_contact_events_sync_only_the_named_resource_after_a_gap(self):
        import hashlib
        import hmac
        import time
        from apps.integrations.access_policy import latest_sync_audit, PAUSED
        payload = {"id": "skipped-delivery", "organization_id": self.conn.yourang_org_id, "type": "contact.created", "resource_id": "old-contact"}
        def deliver(body):
            timestamp = str(int(time.time()))
            signature = hmac.new(b"sync-test-secret", timestamp.encode() + b"." + json.dumps(body).encode(), hashlib.sha256).hexdigest()
            return self.post("/api/integrations/yourang/webhook", body, {"HTTP_X_YOURANG_TIMESTAMP": timestamp, "HTTP_X_YOURANG_SIGNATURE": "sha256=" + signature})
        self.assertEqual(deliver(payload).status_code, 200)
        self.assertEqual(latest_sync_audit(self.salon).type, PAUSED)
        self.allow(True)
        with patch("apps.integrations.client.YourangClient.get_contact", return_value={"id": "new-contact", "phone_number": "+393330009999", "first_name": "New"}) as get_contact, patch("httpx.request") as network:
            # A retried delivery skipped while unpaid remains terminal.
            self.assertEqual(deliver(payload).status_code, 200)
            get_contact.assert_not_called()
            payload.update(id="new-delivery", resource_id="new-contact")
            self.assertEqual(deliver(payload).status_code, 200)
            get_contact.assert_called_once_with("new-contact")
            network.assert_not_called()
        self.assertTrue(Client.objects.filter(salon=self.salon, yourang_contact_id="new-contact").exists())
        self.assertFalse(Client.objects.filter(salon=self.salon, yourang_contact_id="old-contact").exists())
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.yourang_contact_id, "")
        self.assertEqual(latest_sync_audit(self.salon).type, PAUSED)


    def test_disconnected_scheduled_work_is_audited_and_cannot_catch_up_on_reconnect(self):
        from apps.integrations.access_policy import PAUSED, latest_sync_audit
        self.conn.status = "disconnected"
        self.conn.save()
        call_command("sync_yourang", stdout=io.StringIO())
        self.assertEqual(latest_sync_audit(self.salon).type, PAUSED)
        self.conn.status = "connected"
        self.conn.save()
        self.allow(True)
        with patch("httpx.request") as network:
            call_command("sync_yourang", stdout=io.StringIO())
            network.assert_not_called()
