"""Test essenziali: import CSV (upsert), client_facts su dati minimi (sales/agenda
non ancora pronte → degrado a 0/[] senza eccezioni), immutabilità delle schede
tecniche (nessuna rotta di update/delete registrata sul router).

Le view sono chiamate direttamente (bypassando l'HTTP layer): usano solo
`request.auth`, quindi basta un `SimpleNamespace` con uno `StaffContext`
costruito a mano — evita di dipendere dal login reale di apps.accounts.
"""

import datetime as dt
from decimal import Decimal
from types import SimpleNamespace

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from ninja.errors import HttpError

from apps.core.models import ActivityLog, Salon, SalonSettings
from common.auth import StaffContext, create_staff_tokens

from .api import (
    create_category,
    create_client,
    create_note,
    create_sheet,
    delete_client,
    delete_note,
    get_client,
    import_clients,
    list_clients,
    list_notes,
    list_sheets,
    router,
    update_client,
)
from .models import Client, ClientCategory, ClientNote, TechnicalSheet
from .schemas import CategoryIn, ClientIn, ImportIn, ImportRowIn, NoteIn, TechnicalSheetIn
from .services import client_facts, client_stats, import_rows


class ClientsTestCase(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        ctx = StaffContext(
            user=None, salon=self.salon, membership=None, scopes={"clients"}, is_owner=False
        )
        self.request = SimpleNamespace(auth=ctx)

    def make_client(self, **kwargs):
        defaults = dict(salon=self.salon, first_name="Sofia", last_name="Ricci", phone="+391110000000")
        defaults.update(kwargs)
        return Client.objects.create(**defaults)


class ClientCrudTests(ClientsTestCase):
    def test_create_and_update_client(self):
        data = ClientIn(first_name="Giulia", last_name="Bianchi", phone="+393331112222")
        client = create_client(self.request, data)
        self.assertEqual(client.full_name, "Giulia Bianchi")
        self.assertTrue(Client.objects.filter(id=client.id, salon=self.salon).exists())

        update_data = ClientIn(first_name="Giulia", last_name="Verdi", phone="+393331112222")
        updated = update_client(self.request, client.id, update_data)
        self.assertEqual(updated.last_name, "Verdi")

    def test_duplicate_phone_rejected_on_create(self):
        self.make_client(phone="+393339990000")
        data = ClientIn(first_name="Altra", last_name="Persona", phone="+393339990000")
        with self.assertRaises(HttpError) as exc:
            create_client(self.request, data)
        self.assertEqual(exc.exception.status_code, 400)

    def test_soft_delete_sets_is_active_false_and_logs(self):
        client = self.make_client()
        delete_client(self.request, client.id)
        client.refresh_from_db()
        self.assertFalse(client.is_active)
        self.assertTrue(ActivityLog.objects.filter(type="client.deleted").exists())

    def test_detail_has_zeroed_computed_fields_without_sales_app(self):
        client = self.make_client()
        detail = get_client(self.request, client.id)
        self.assertEqual(detail.visits, 0)
        self.assertEqual(detail.total_spent, Decimal("0"))
        self.assertIsNone(detail.last_visit)


class ClientListTests(ClientsTestCase):
    def test_list_filters_by_query(self):
        self.make_client(first_name="Sofia", last_name="Ricci", phone="+391110001111")
        self.make_client(first_name="Elena", last_name="Conti", phone="+391110002222")
        result = list_clients(self.request, q="Sofia")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["items"][0].first_name, "Sofia")

    def test_list_filters_by_is_active(self):
        active = self.make_client(phone="+391110003333")
        inactive = self.make_client(phone="+391110004444", is_active=False)
        result = list_clients(self.request, is_active=True)
        ids = [c.id for c in result["items"]]
        self.assertIn(active.id, ids)
        self.assertNotIn(inactive.id, ids)


class ClientFactsTests(ClientsTestCase):
    """client_facts deve degradare a 0/[] senza eccezioni quando sales/agenda
    non sono installate (come in questo ambiente di sviluppo/test)."""

    def test_client_facts_minimal_data_no_exceptions(self):
        client = self.make_client(reliability=80, deposit_always=True)
        facts = client_facts(client)
        self.assertEqual(
            facts,
            {
                "reliability": 80,
                "categories": [],
                "total_spent": Decimal("0"),
                "visits": 0,
                "noshow_count": 0,
                "latecancel_count": 0,
                "deposit_always": True,
            },
        )

    def test_client_facts_includes_category_names(self):
        client = self.make_client()
        cat = ClientCategory.objects.create(salon=self.salon, name="VIP")
        client.categories.add(cat)
        facts = client_facts(client)
        self.assertEqual(facts["categories"], ["VIP"])

    def test_client_stats_degrades_to_zero_without_sales_app(self):
        client = self.make_client()
        stats = client_stats(client)
        self.assertEqual(stats, {"visits": 0, "total_spent": Decimal("0"), "last_visit": None})


class ImportUpsertTests(ClientsTestCase):
    def test_import_creates_and_updates(self):
        existing = self.make_client(phone="+393330001111", first_name="Old", last_name="Name")
        rows = [
            {"first_name": "New", "last_name": "Name", "phone": "+393330001111", "email": ""},
            {"first_name": "Fresh", "last_name": "Client", "phone": "+393339998888", "email": ""},
        ]
        result = import_rows(self.salon, rows)
        self.assertEqual(result, {"created": 1, "updated": 1})
        existing.refresh_from_db()
        self.assertEqual(existing.first_name, "New")
        self.assertTrue(Client.objects.filter(salon=self.salon, phone="+393339998888").exists())

    def test_import_matches_by_email_when_no_phone_match(self):
        existing = self.make_client(phone="+393330005555", email="giulia@example.com")
        result = import_rows(
            self.salon, [{"first_name": "Giulia", "email": "giulia@example.com", "phone": ""}]
        )
        self.assertEqual(result, {"created": 0, "updated": 1})
        existing.refresh_from_db()
        self.assertEqual(existing.first_name, "Giulia")

    def test_import_row_without_phone_or_match_is_skipped(self):
        result = import_rows(self.salon, [{"first_name": "Nessuno", "email": "", "phone": ""}])
        self.assertEqual(result, {"created": 0, "updated": 0})

    def test_import_endpoint_logs_activity(self):
        data = ImportIn(rows=[ImportRowIn(first_name="A", phone="+393330000000")])
        result = import_clients(self.request, data)
        self.assertEqual(result["created"], 1)
        self.assertTrue(ActivityLog.objects.filter(type="client.imported").exists())


class NotesTests(ClientsTestCase):
    def test_create_and_delete_note(self):
        client = self.make_client()
        note = create_note(self.request, client.id, NoteIn(text="Allergica al lattice"))
        self.assertEqual(list_notes(self.request, client.id).count(), 1)
        delete_note(self.request, client.id, note.id)
        self.assertFalse(ClientNote.objects.filter(id=note.id).exists())


class TechnicalSheetTests(ClientsTestCase):
    def test_create_sheet(self):
        client = self.make_client()
        sheet = create_sheet(
            self.request,
            client.id,
            TechnicalSheetIn(category="hair", treatment="Colore"),
        )
        self.assertEqual(TechnicalSheet.objects.filter(client=client).count(), 1)
        self.assertEqual(list(list_sheets(self.request, client.id)), [sheet])

    def test_no_update_or_delete_routes_for_sheets(self):
        """Verifica di contratto: le schede tecniche sono sola lettura dopo la
        creazione, quindi il router non deve esporre PUT/PATCH/DELETE su di esse."""
        methods: set[str] = set()
        for path, path_view in router.path_operations.items():
            if "sheets" in path:
                for operation in path_view.operations:
                    methods.update(operation.methods)
        self.assertIn("GET", methods)
        self.assertIn("POST", methods)
        self.assertNotIn("PUT", methods)
        self.assertNotIn("PATCH", methods)
        self.assertNotIn("DELETE", methods)

    def test_no_update_or_delete_view_functions_exported(self):
        import apps.clients.api as api_module

        self.assertFalse(hasattr(api_module, "update_sheet"))
        self.assertFalse(hasattr(api_module, "delete_sheet"))


class CategoryTests(ClientsTestCase):
    def test_create_category(self):
        category = create_category(self.request, CategoryIn(name="VIP"))
        self.assertTrue(ClientCategory.objects.filter(id=category.id).exists())


class ClientAppointmentsApiTests(TestCase):
    """GET /api/clients/{id}/appointments: storico appuntamenti del cliente (staff)."""

    def setUp(self):
        from apps.accounts.models import Membership, Role, User
        from apps.staff.models import Operator

        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        user = User.objects.create_user(email="sole@theparlour.it", password="theparlour")
        role = Role.objects.create(salon=self.salon, name="Manager", scopes=["agenda"])
        Membership.objects.create(user=user, salon=self.salon, role=role, is_owner=True)
        tokens = create_staff_tokens(user, self.salon)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}

        self.operator = Operator.objects.create(
            salon=self.salon, first_name="Giulia", last_name="Bianchi", color="#AACCEE"
        )
        self.client_obj = Client.objects.create(
            salon=self.salon, first_name="Sofia", last_name="Ricci", phone="+391112223333"
        )

    def _appointment(self, client, start):
        from apps.agenda.models import Appointment

        return Appointment.objects.create(
            salon=self.salon, client=client, operator=self.operator, start=start
        )

    def test_returns_past_and_future_ordered_by_start(self):
        past = self._appointment(self.client_obj, timezone.now() - dt.timedelta(days=10))
        future = self._appointment(self.client_obj, timezone.now() + dt.timedelta(days=5))
        resp = self.client.get(
            f"/api/clients/{self.client_obj.id}/appointments", **self.auth
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        ids = [a["id"] for a in resp.json()]
        self.assertEqual(ids, [past.id, future.id])

    def test_only_returns_appointments_of_that_client(self):
        other_client = Client.objects.create(
            salon=self.salon, first_name="Altra", last_name="Persona", phone="+399998887777"
        )
        mine = self._appointment(self.client_obj, timezone.now())
        self._appointment(other_client, timezone.now())
        resp = self.client.get(
            f"/api/clients/{self.client_obj.id}/appointments", **self.auth
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual([a["id"] for a in resp.json()], [mine.id])

    def test_unknown_client_404(self):
        resp = self.client.get("/api/clients/999999/appointments", **self.auth)
        self.assertEqual(resp.status_code, 404)

    def test_client_of_other_salon_404(self):
        """Isolamento multi-tenant: un cliente di un altro salone non è raggiungibile."""
        other_salon = Salon.objects.create(name="Altro", slug="altro")
        foreign_client = Client.objects.create(
            salon=other_salon, first_name="Estranea", last_name="Cliente", phone="+390001112222"
        )
        resp = self.client.get(
            f"/api/clients/{foreign_client.id}/appointments", **self.auth
        )
        self.assertEqual(resp.status_code, 404)


class PublicHookTests(TestCase):
    """POST /api/clients/public/hook: il form pubblico di raccolta contatti.

    Testato via HTTP e non chiamando la view: è l'unico endpoint del router
    senza auth, e metà del suo comportamento (403, 404, sempre 200) sta nei
    codici di stato.
    """

    URL = "/api/clients/public/hook"

    def setUp(self):
        cache.clear()  # il rate limit è per (salone, IP): senza reset i test si contaminano
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")

    def _open_the_form(self):
        SalonSettings.objects.create(
            salon=self.salon, privacy_policy_url="https://theparlour.it/privacy"
        )

    def _post(self, **overrides):
        body = {
            "salon_slug": "the-parlour",
            "first_name": "Sofia",
            "last_name": "Ricci",
            "phone": "3331234567",
            "email": "sofia@esempio.it",
            "marketing": True,
            "privacy": True,
        }
        body.update(overrides)
        return self.client.post(self.URL, body, content_type="application/json")

    def test_lead_lands_in_the_address_book(self):
        self._open_the_form()
        self.assertEqual(self._post().status_code, 200)
        client = Client.objects.get(salon=self.salon, phone="3331234567")
        self.assertEqual(client.origin, "hook")
        self.assertTrue(client.consents["privacy"])
        self.assertTrue(client.consents["privacy_at"])  # senza data non è dimostrabile
        self.assertTrue(client.categories.filter(name="Da form").exists())

    def test_closed_without_privacy_policy(self):
        """Consenso a un'informativa che non esiste: niente titolo a raccogliere."""
        resp = self._post()
        self.assertEqual(resp.status_code, 403)
        self.assertFalse(Client.objects.filter(salon=self.salon).exists())

    def test_unknown_salon_404(self):
        resp = self._post(salon_slug="non-esiste")
        self.assertEqual(resp.status_code, 404)

    def test_existing_client_keeps_their_data(self):
        """Chi è già in rubrica: si aggiornano i consensi, non si riscrive la scheda."""
        self._open_the_form()
        existing = Client.objects.create(
            salon=self.salon, first_name="Sofia", last_name="Ricci",
            phone="3331234567", email="vera@esempio.it",
        )
        self.assertEqual(self._post(first_name="Impostora", email="falsa@esempio.it").status_code, 200)
        existing.refresh_from_db()
        self.assertEqual(existing.first_name, "Sofia")
        self.assertEqual(existing.email, "vera@esempio.it")
        self.assertTrue(existing.consents["marketing"])
        self.assertFalse(existing.categories.filter(name="Da form").exists())

    def test_honeypot_is_dropped_silently(self):
        self._open_the_form()
        self.assertEqual(self._post(trap=True).status_code, 200)  # 200 per non istruire i bot
        self.assertFalse(Client.objects.filter(salon=self.salon).exists())

    def test_privacy_consent_required(self):
        self._open_the_form()
        self.assertEqual(self._post(privacy=False).status_code, 400)
        self.assertFalse(Client.objects.filter(salon=self.salon).exists())

    def test_rate_limit_stops_the_flood(self):
        self._open_the_form()
        for i in range(20):
            self.assertEqual(self._post(phone=f"33300000{i:02d}").status_code, 200)
        self.assertEqual(self._post(phone="3339999999").status_code, 200)  # scartata, non 429
        self.assertEqual(Client.objects.filter(salon=self.salon).count(), 20)

    def test_forged_forwarded_for_does_not_reset_the_counter(self):
        """La catena X-Forwarded-For è scrivibile dal client, ma il nostro proxy
        accoda in fondo il peer che ha davvero aperto la connessione: cambiare i
        primi elementi non regala quota nuova.

        Qui il proxy lo simuliamo noi — `peer` è quello che Traefik accoderebbe.
        """
        self._open_the_form()
        peer = "203.0.113.7"

        def post(prefix, phone):
            return self.client.post(
                self.URL,
                {"salon_slug": "the-parlour", "first_name": "Sofia", "phone": phone, "privacy": True},
                content_type="application/json",
                HTTP_X_FORWARDED_FOR=f"{prefix}, {peer}",
            )

        for i in range(20):
            self.assertEqual(post(f"10.0.0.{i}", f"33300000{i:02d}").status_code, 200)
        # 21ª richiesta, prefisso mai visto ma stesso peer in fondo → scartata.
        self.assertEqual(post("9.9.9.9", "3339999999").status_code, 200)
        self.assertEqual(Client.objects.filter(salon=self.salon).count(), 20)
