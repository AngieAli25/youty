"""Test essenziali dell'agenda.

I modelli di clients/staff/catalog sono usati direttamente (esistono a livello
di progetto integrato); `shift_windows` e `client_facts` vengono mockati per
isolare l'algoritmo dell'agenda dalla logica interna delle altre app.
"""

import datetime as dt
import json
from decimal import Decimal
from unittest.mock import patch

from common.testing import SubscribedSalonTestCase as TestCase
from django.utils import timezone
from ninja.errors import HttpError

from apps.core.models import DepositRule, OutboxEvent, Salon, SalonSettings
from common.auth import create_staff_tokens

from .models import Appointment, AppointmentService, Pause
from .services import (
    cancel_appointment,
    compute_deposit,
    create_appointment,
    get_free_slots,
    move_appointment,
)


def _aware(day: dt.date, hour: int, minute: int = 0) -> dt.datetime:
    return timezone.make_aware(dt.datetime.combine(day, dt.time(hour, minute)))


class AgendaTestBase(TestCase):
    @classmethod
    def setUpTestData(cls):
        from apps.catalog.models import Service, ServiceCategory
        from apps.clients.models import Client
        from apps.staff.models import Operator

        cls.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        cls.client_obj = Client.objects.create(
            salon=cls.salon,
            first_name="Sofia",
            last_name="Ricci",
            phone="+390000000001",
        )
        category = ServiceCategory.objects.create(
            salon=cls.salon, name_it="Unghie", color="#FFD1DC", order=0
        )
        cls.svc60 = Service.objects.create(
            salon=cls.salon,
            category=category,
            name_it="Manicure completa",
            duration_min=60,
            price=Decimal("50.00"),
        )
        cls.svc30 = Service.objects.create(
            salon=cls.salon,
            category=category,
            name_it="Copertura gel",
            duration_min=30,
            price=Decimal("30.00"),
        )
        cls.op1 = Operator.objects.create(
            salon=cls.salon, first_name="Giulia", last_name="Bianchi", color="#AACCEE"
        )
        cls.op2 = Operator.objects.create(
            salon=cls.salon, first_name="Marta", last_name="Verdi", color="#EECCAA"
        )
        # op1 idonea a entrambi i servizi; op2 a nessuno (verifica idoneità)
        cls.op1.services.add(cls.svc60, cls.svc30)
        # data futura per evitare il filtro "niente slot nel passato"
        cls.day = timezone.localdate() + dt.timedelta(days=7)

    def _windows(self, mapping):
        """Patcha shift_windows: mapping = {operator_id: [(start_min, end_min), ...]}."""
        return patch(
            "apps.staff.services.shift_windows",
            side_effect=lambda operator, date: mapping.get(operator.id, []),
        )


class GetFreeSlotsTests(AgendaTestBase):
    def test_shifts_overlap_and_eligibility(self):
        # op1: 9-13. op2 ha un turno più ampio ma NON è idonea al servizio.
        mapping = {self.op1.id: [(9 * 60, 13 * 60)], self.op2.id: [(9 * 60, 18 * 60)]}
        # appuntamento esistente per op1: 10:00-11:00
        existing = Appointment.objects.create(
            salon=self.salon,
            client=self.client_obj,
            operator=self.op1,
            start=_aware(self.day, 10),
        )
        AppointmentService.objects.create(
            appointment=existing,
            service=self.svc60,
            operator=self.op1,
            duration_min=60,
            price=Decimal("50.00"),
        )

        with self._windows(mapping):
            slots = get_free_slots(
                self.salon, self.day, [{"service_id": self.svc60.id, "operator_id": None}]
            )

        starts = [slot["start"] for slot in slots]
        # liberi: 9:00 poi da 11:00 a 12:00 (l'ultimo che finisce entro le 13)
        self.assertIn(_aware(self.day, 9).isoformat(), starts)
        self.assertIn(_aware(self.day, 11).isoformat(), starts)
        self.assertIn(_aware(self.day, 12).isoformat(), starts)
        # 9:15 finirebbe alle 10:15: si sovrappone all'appuntamento esistente
        self.assertNotIn(_aware(self.day, 9, 15).isoformat(), starts)
        self.assertNotIn(_aware(self.day, 10).isoformat(), starts)
        # 12:15 finirebbe alle 13:15: fuori turno
        self.assertNotIn(_aware(self.day, 12, 15).isoformat(), starts)
        self.assertEqual(len(slots), 6)
        # tutte le assegnazioni sono su op1: op2 non è in service.operators
        for slot in slots:
            self.assertEqual(slot["assignment"][0]["operator_id"], self.op1.id)

    def test_requested_operator_not_eligible_returns_no_slots(self):
        mapping = {self.op2.id: [(9 * 60, 18 * 60)]}
        with self._windows(mapping):
            slots = get_free_slots(
                self.salon,
                self.day,
                [{"service_id": self.svc60.id, "operator_id": self.op2.id}],
            )
        self.assertEqual(slots, [])

    def test_multi_service_sequential_chain(self):
        # Finestra stretta 9:00-10:00: due servizi da 30' entrano solo alle 9:00.
        mapping = {self.op1.id: [(9 * 60, 10 * 60)]}
        items = [
            {"service_id": self.svc30.id, "operator_id": None},
            {"service_id": self.svc30.id, "operator_id": None},
        ]
        with self._windows(mapping):
            slots = get_free_slots(self.salon, self.day, items)

        self.assertEqual(len(slots), 1)
        self.assertEqual(slots[0]["start"], _aware(self.day, 9).isoformat())
        self.assertEqual(
            [a["operator_id"] for a in slots[0]["assignment"]],
            [self.op1.id, self.op1.id],
        )

    def test_pause_blocks_slots(self):
        mapping = {self.op1.id: [(9 * 60, 13 * 60)]}
        Pause.objects.create(
            salon=self.salon,
            operator=self.op1,
            start=_aware(self.day, 9),
            duration_min=30,
        )
        with self._windows(mapping):
            slots = get_free_slots(
                self.salon, self.day, [{"service_id": self.svc30.id, "operator_id": None}]
            )
        starts = [slot["start"] for slot in slots]
        self.assertNotIn(_aware(self.day, 9).isoformat(), starts)
        self.assertNotIn(_aware(self.day, 9, 15).isoformat(), starts)
        self.assertIn(_aware(self.day, 9, 30).isoformat(), starts)


class SlotIntervalTests(AgendaTestBase):
    """L'intervallo fasce orarie del salone (SalonSettings.slot_interval_min)
    guida il passo della disponibilità; senza riga impostazioni si usa il
    default globale (AGENDA_SLOT_STEP_MIN = 15)."""

    def test_default_step_is_15_without_settings(self):
        # nessuna SalonSettings: passo di default 15'
        mapping = {self.op1.id: [(9 * 60, 11 * 60)]}
        with self._windows(mapping):
            slots = get_free_slots(
                self.salon, self.day, [{"service_id": self.svc30.id, "operator_id": None}]
            )
        starts = [s["start"] for s in slots]
        self.assertIn(_aware(self.day, 9, 15).isoformat(), starts)

    def test_step_30_offers_half_hour_grid(self):
        SalonSettings.objects.create(salon=self.salon, slot_interval_min=30)
        mapping = {self.op1.id: [(9 * 60, 11 * 60)]}
        with self._windows(mapping):
            slots = get_free_slots(
                self.salon, self.day, [{"service_id": self.svc30.id, "operator_id": None}]
            )
        starts = [s["start"] for s in slots]
        # passo 30': 9:00, 9:30, 10:00, 10:30 (l'ultimo finisce alle 11:00)
        self.assertEqual(
            starts,
            [
                _aware(self.day, 9).isoformat(),
                _aware(self.day, 9, 30).isoformat(),
                _aware(self.day, 10).isoformat(),
                _aware(self.day, 10, 30).isoformat(),
            ],
        )
        self.assertNotIn(_aware(self.day, 9, 15).isoformat(), starts)

    def test_step_20_offers_twenty_minute_grid(self):
        SalonSettings.objects.create(salon=self.salon, slot_interval_min=20)
        mapping = {self.op1.id: [(9 * 60, 10 * 60)]}
        with self._windows(mapping):
            slots = get_free_slots(
                self.salon, self.day, [{"service_id": self.svc30.id, "operator_id": None}]
            )
        starts = [s["start"] for s in slots]
        # passo 20' entro 9:00-10:00 con servizio 30': 9:00 (→9:30), 9:20 (→9:50)
        self.assertEqual(
            starts,
            [_aware(self.day, 9).isoformat(), _aware(self.day, 9, 20).isoformat()],
        )


class SoakTimeTests(AgendaTestBase):
    """Semantica del tempo di posa (soak): attivo = hard-busy (blocca sempre),
    posa = soft-busy (sovrapposizione manuale ammessa, mai automatica)."""

    def setUp(self):
        from apps.catalog.models import Service

        category = self.svc60.category
        # servizio con posa: 30' attivi + 45' di posa
        self.svc_soak = Service.objects.create(
            salon=self.salon,
            category=category,
            name_it="Colore",
            duration_min=30,
            soak_min=45,
            price=Decimal("60.00"),
        )
        # servizio piano (nessuna posa), idoneo a op1 e op2
        self.svc_plain = Service.objects.create(
            salon=self.salon,
            category=category,
            name_it="Taglio",
            duration_min=30,
            soak_min=0,
            price=Decimal("25.00"),
        )
        self.svc_soak.operators.add(self.op1, self.op2)
        self.svc_plain.operators.add(self.op1, self.op2)
        self.wide = {
            self.op1.id: [(8 * 60, 20 * 60)],
            self.op2.id: [(8 * 60, 20 * 60)],
        }

    def _soak_appt_for_op1(self):
        """Appuntamento con posa per op1: attivo 10:00-10:30, posa 10:30-11:15."""
        appt = Appointment.objects.create(
            salon=self.salon,
            client=self.client_obj,
            operator=self.op1,
            start=_aware(self.day, 10),
        )
        AppointmentService.objects.create(
            appointment=appt,
            service=self.svc_soak,
            operator=self.op1,
            duration_min=30,
            soak_min=45,
            price=Decimal("60.00"),
        )
        return appt

    def test_booking_soak_service_spans_active_plus_soak(self):
        from .api import _item_out

        with self._windows(self.wide):
            appt = create_appointment(
                self.salon,
                self.client_obj,
                [{"service_id": self.svc_soak.id, "operator_id": self.op1.id}],
                _aware(self.day, 10),
                via="dashboard",
            )
        item = appt.items.get()
        self.assertEqual(item.duration_min, 30)  # attivo
        self.assertEqual(item.soak_min, 45)       # posa
        # total_duration_min = attivo + posa -> l'orario di fine è corretto
        self.assertEqual(appt.total_duration_min, 75)
        self.assertEqual(appt.end, _aware(self.day, 11, 15))
        # ItemOut espone soak_min (duration_min resta l'ATTIVO)
        out = _item_out(item)
        self.assertEqual(out["duration_min"], 30)
        self.assertEqual(out["soak_min"], 45)

    def test_availability_never_offers_start_inside_soak(self):
        # op1 impegnata: attivo 10:00-10:30, posa 10:30-11:15
        self._soak_appt_for_op1()
        with self._windows(self.wide):
            slots = get_free_slots(
                self.salon,
                self.day,
                [{"service_id": self.svc_plain.id, "operator_id": self.op1.id}],
            )
        starts = [s["start"] for s in slots]
        # nessuno start che cadrebbe nella posa altrui (auto NON riempie la posa)
        self.assertNotIn(_aware(self.day, 10, 30).isoformat(), starts)
        self.assertNotIn(_aware(self.day, 10, 45).isoformat(), starts)
        self.assertNotIn(_aware(self.day, 11).isoformat(), starts)
        # a posa finita torna disponibile
        self.assertIn(_aware(self.day, 11, 15).isoformat(), starts)

    def test_manual_move_into_soak_window_succeeds(self):
        self._soak_appt_for_op1()  # posa op1 10:30-11:15
        with self._windows(self.wide):
            appt_b = create_appointment(
                self.salon,
                self.client_obj,
                [{"service_id": self.svc_plain.id, "operator_id": self.op1.id}],
                _aware(self.day, 8),
                via="dashboard",
            )
            # spostato a 10:45 -> attivo 10:45-11:15: cade SOLO nella posa di A
            moved = move_appointment(appt_b, _aware(self.day, 10, 45))
        self.assertEqual(moved.start, _aware(self.day, 10, 45))

    def test_manual_move_into_active_window_conflicts(self):
        self._soak_appt_for_op1()  # attivo op1 10:00-10:30
        with self._windows(self.wide):
            appt_b = create_appointment(
                self.salon,
                self.client_obj,
                [{"service_id": self.svc_plain.id, "operator_id": self.op1.id}],
                _aware(self.day, 8),
                via="dashboard",
            )
            with self.assertRaises(HttpError) as caught:
                # 10:15-10:45 si sovrappone all'ATTIVO 10:00-10:30 di A -> conflitto
                move_appointment(appt_b, _aware(self.day, 10, 15))
        self.assertEqual(caught.exception.status_code, 409)

    def test_auto_assign_avoids_operator_in_soak(self):
        self._soak_appt_for_op1()  # op1 in posa 10:30-11:15
        with self._windows(self.wide):
            # auto (operator_id=None) a 10:45: op1 sarebbe nella posa -> sceglie op2
            appt = create_appointment(
                self.salon,
                self.client_obj,
                [{"service_id": self.svc_plain.id, "operator_id": None}],
                _aware(self.day, 10, 45),
                via="dashboard",
            )
        self.assertEqual(appt.operator_id, self.op2.id)
        self.assertEqual(appt.items.get().operator_id, self.op2.id)

    def test_auto_assign_no_alternative_raises_409(self):
        # solo op1 idoneo: in auto durante la posa nessun candidato -> 409
        self.svc_plain.operators.remove(self.op2)
        self._soak_appt_for_op1()  # op1 in posa 10:30-11:15
        with self._windows({self.op1.id: [(8 * 60, 20 * 60)]}):
            with self.assertRaises(HttpError) as caught:
                create_appointment(
                    self.salon,
                    self.client_obj,
                    [{"service_id": self.svc_plain.id, "operator_id": None}],
                    _aware(self.day, 10, 45),
                    via="dashboard",
                )
        self.assertEqual(caught.exception.status_code, 409)


class ComputeDepositTests(AgendaTestBase):
    def setUp(self):
        self.rule = DepositRule.objects.create(
            salon=self.salon,
            name="Bassa affidabilità",
            conditions={
                "op": "and",
                "rules": [{"field": "reliability", "cmp": "lt", "value": 60}],
            },
            amount_type=DepositRule.AmountType.PERCENT,
            amount=Decimal("30"),
            priority=0,
        )

    def test_percent_rule_matches_facts(self):
        with patch(
            "apps.clients.services.client_facts", return_value={"reliability": 50}
        ):
            self.assertEqual(
                compute_deposit(self.salon, self.client_obj, Decimal("100")),
                Decimal("30.00"),
            )

    def test_no_matching_rule_returns_zero(self):
        with patch(
            "apps.clients.services.client_facts", return_value={"reliability": 90}
        ):
            self.assertEqual(
                compute_deposit(self.salon, self.client_obj, Decimal("100")),
                Decimal("0.00"),
            )

    def test_deposit_always_uses_first_active_rule(self):
        self.client_obj.deposit_always = True
        # le condizioni NON matcherebbero: deposit_always prende comunque la prima regola
        with patch(
            "apps.clients.services.client_facts", return_value={"reliability": 90}
        ):
            self.assertEqual(
                compute_deposit(self.salon, self.client_obj, Decimal("200")),
                Decimal("60.00"),
            )

    def test_fixed_rule_and_priority_fallback(self):
        DepositRule.objects.create(
            salon=self.salon,
            name="Default fisso",
            conditions={},  # condizioni vuote: matcha sempre
            amount_type=DepositRule.AmountType.FIXED,
            amount=Decimal("20"),
            priority=1,
        )
        with patch(
            "apps.clients.services.client_facts", return_value={"reliability": 90}
        ):
            self.assertEqual(
                compute_deposit(self.salon, self.client_obj, Decimal("100")),
                Decimal("20.00"),
            )


class CreateAppointmentTests(AgendaTestBase):
    def test_collision_raises_409(self):
        mapping = {self.op1.id: [(8 * 60, 20 * 60)], self.op2.id: [(8 * 60, 20 * 60)]}
        items = [{"service_id": self.svc60.id, "operator_id": self.op1.id}]
        with self._windows(mapping):
            first = create_appointment(
                self.salon, self.client_obj, items, _aware(self.day, 10), via="dashboard"
            )
            self.assertEqual(first.status, Appointment.Status.CONFIRMED)
            self.assertEqual(first.operator_id, self.op1.id)
            self.assertEqual(first.total_price, Decimal("50.00"))

            # stesso slot (sovrapposto): 409
            with self.assertRaises(HttpError) as caught:
                create_appointment(
                    self.salon,
                    self.client_obj,
                    items,
                    _aware(self.day, 10, 30),
                    via="dashboard",
                )
            self.assertEqual(caught.exception.status_code, 409)

            # anche in auto-assegnazione: op1 occupata, op2 non idonea -> 409
            with self.assertRaises(HttpError) as caught:
                create_appointment(
                    self.salon,
                    self.client_obj,
                    [{"service_id": self.svc60.id, "operator_id": None}],
                    _aware(self.day, 10, 30),
                    via="dashboard",
                )
            self.assertEqual(caught.exception.status_code, 409)

            # slot adiacente libero: ok
            second = create_appointment(
                self.salon, self.client_obj, items, _aware(self.day, 11), via="dashboard"
            )
            self.assertEqual(second.status, Appointment.Status.CONFIRMED)

        self.assertEqual(
            OutboxEvent.objects.filter(event_type="appointment.created").count(), 2
        )

    def test_snapshot_and_deposit_none_without_rules(self):
        mapping = {self.op1.id: [(8 * 60, 20 * 60)]}
        items = [
            {"service_id": self.svc60.id, "operator_id": None},
            {"service_id": self.svc30.id, "operator_id": None},
        ]
        with self._windows(mapping):
            appointment = create_appointment(
                self.salon, self.client_obj, items, _aware(self.day, 9), via="app"
            )
        self.assertEqual(appointment.total_duration_min, 90)
        self.assertEqual(appointment.total_price, Decimal("80.00"))
        self.assertEqual(appointment.end, _aware(self.day, 10, 30))
        self.assertEqual(appointment.deposit_status, Appointment.DepositStatus.NONE)
        self.assertEqual(appointment.created_via, "app")


class CancelAppointmentTests(AgendaTestBase):
    def _make(self, start, deposit_status=Appointment.DepositStatus.PAID):
        return Appointment.objects.create(
            salon=self.salon,
            client=self.client_obj,
            operator=self.op1,
            start=start,
            deposit_status=deposit_status,
            deposit_amount=Decimal("15.00"),
        )

    def test_late_cancel_forfeits_deposit(self):
        appointment = self._make(timezone.now() + dt.timedelta(hours=2))
        cancel_appointment(appointment, reason="imprevisto")
        appointment.refresh_from_db()
        self.assertEqual(appointment.status, Appointment.Status.CANCELLED)
        self.assertTrue(appointment.cancelled_late)
        self.assertEqual(
            appointment.deposit_status, Appointment.DepositStatus.FORFEITED
        )
        self.assertEqual(appointment.cancel_reason, "imprevisto")
        types = set(OutboxEvent.objects.values_list("event_type", flat=True))
        self.assertIn("appointment.cancelled", types)
        self.assertIn("slot.freed", types)

    def test_early_cancel_refunds_deposit(self):
        appointment = self._make(timezone.now() + dt.timedelta(hours=72))
        cancel_appointment(appointment)
        appointment.refresh_from_db()
        self.assertFalse(appointment.cancelled_late)
        self.assertEqual(
            appointment.deposit_status, Appointment.DepositStatus.REFUNDED
        )

    def test_cancelled_appointment_is_not_editable(self):
        appointment = self._make(timezone.now() + dt.timedelta(hours=72))
        cancel_appointment(appointment)
        with self.assertRaises(HttpError) as caught:
            cancel_appointment(appointment)
        self.assertEqual(caught.exception.status_code, 400)


class AppointmentEditApiTests(AgendaTestBase):
    """PUT /appointments/{id} con durate editabili + add/remove servizi + GET singolo."""

    def setUp(self):
        from apps.accounts.models import Membership, Role, User

        self.user = User.objects.create_user(
            email="sole@theparlour.it", password="theparlour"
        )
        role = Role.objects.create(salon=self.salon, name="Manager", scopes=["agenda"])
        Membership.objects.create(
            user=self.user, salon=self.salon, role=role, is_owner=True
        )
        tokens = create_staff_tokens(self.user, self.salon)
        self.auth = {"HTTP_AUTHORIZATION": f"Bearer {tokens['access']}"}
        # finestra ampia per op1: le durate di listino entrano comodamente
        self.mapping = {self.op1.id: [(8 * 60, 20 * 60)]}

    def _put(self, path, payload):
        return self.client.put(
            path,
            data=json.dumps(payload),
            content_type="application/json",
            **self.auth,
        )

    def _make(self, items, start_hour=10, windows=None):
        with self._windows(windows or self.mapping):
            return create_appointment(
                self.salon,
                self.client_obj,
                items,
                _aware(self.day, start_hour),
                via="dashboard",
            )

    # (d) GET singolo appuntamento
    def test_get_single_appointment(self):
        appointment = self._make(
            [{"service_id": self.svc60.id, "operator_id": self.op1.id}]
        )
        resp = self.client.get(
            f"/api/agenda/appointments/{appointment.id}", **self.auth
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body["id"], appointment.id)
        self.assertEqual(body["total_duration_min"], 60)
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["service_id"], self.svc60.id)
        self.assertEqual(body["items"][0]["duration_min"], 60)

    def test_get_unknown_appointment_404(self):
        resp = self.client.get("/api/agenda/appointments/999999", **self.auth)
        self.assertEqual(resp.status_code, 404)

    # (a) override durata persiste (NON re-snapshottata dal listino)
    def test_put_duration_override_persists(self):
        appointment = self._make(
            [{"service_id": self.svc60.id, "operator_id": self.op1.id}]
        )
        item = appointment.items.get()
        payload = {
            "items": [
                {
                    "id": item.id,
                    "service_id": self.svc60.id,
                    "operator_id": self.op1.id,
                    "duration_min": 90,  # override; il listino è 60
                }
            ]
        }
        with self._windows(self.mapping):
            resp = self._put(f"/api/agenda/appointments/{appointment.id}", payload)
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["duration_min"], 90)
        self.assertEqual(body["total_duration_min"], 90)
        # persistito e NON riportato al valore di listino (60)
        appointment.refresh_from_db()
        self.assertEqual(appointment.items.get().duration_min, 90)

    def test_put_zero_duration_falls_back_to_catalog(self):
        appointment = self._make(
            [{"service_id": self.svc60.id, "operator_id": self.op1.id}]
        )
        item = appointment.items.get()
        payload = {
            "items": [
                {
                    "id": item.id,
                    "service_id": self.svc60.id,
                    "operator_id": self.op1.id,
                    "duration_min": 0,  # non valido: usa la durata di listino (60)
                }
            ]
        }
        with self._windows(self.mapping):
            resp = self._put(f"/api/agenda/appointments/{appointment.id}", payload)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["items"][0]["duration_min"], 60)

    # (b) aggiunta di un servizio (voce senza id) accodata come blocco successivo
    def test_put_add_item_appends_block(self):
        appointment = self._make(
            [{"service_id": self.svc60.id, "operator_id": self.op1.id}]
        )
        item = appointment.items.get()
        payload = {
            "items": [
                {"id": item.id, "service_id": self.svc60.id, "operator_id": self.op1.id},
                {"service_id": self.svc30.id, "operator_id": self.op1.id},  # nuovo
            ]
        }
        with self._windows(self.mapping):
            resp = self._put(f"/api/agenda/appointments/{appointment.id}", payload)
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(len(body["items"]), 2)
        self.assertEqual(body["items"][0]["service_id"], self.svc60.id)
        self.assertEqual(body["items"][1]["service_id"], self.svc30.id)
        self.assertEqual([i["order"] for i in body["items"]], [0, 1])
        self.assertEqual(body["total_duration_min"], 90)
        self.assertEqual(body["total_price"], "80.00")

    # (c) rimozione di un servizio (voce omessa dalla lista)
    def test_put_remove_item(self):
        appointment = self._make(
            [
                {"service_id": self.svc60.id, "operator_id": self.op1.id},
                {"service_id": self.svc30.id, "operator_id": self.op1.id},
            ]
        )
        self.assertEqual(appointment.items.count(), 2)
        first = appointment.items.order_by("order").first()
        payload = {
            "items": [
                {"id": first.id, "service_id": self.svc60.id, "operator_id": self.op1.id}
            ]
        }
        with self._windows(self.mapping):
            resp = self._put(f"/api/agenda/appointments/{appointment.id}", payload)
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["items"][0]["service_id"], self.svc60.id)
        self.assertEqual(body["total_duration_min"], 60)
        self.assertEqual(appointment.items.count(), 1)

    # (e) override durata che non ci sta più (sfora il turno) -> 409, DB invariato
    def test_put_duration_override_out_of_window_409(self):
        narrow = {self.op1.id: [(9 * 60, 11 * 60)]}
        appointment = self._make(
            [{"service_id": self.svc30.id, "operator_id": self.op1.id}],
            start_hour=10,
            windows=narrow,
        )
        item = appointment.items.get()
        payload = {
            "items": [
                {
                    "id": item.id,
                    "service_id": self.svc30.id,
                    "operator_id": self.op1.id,
                    "duration_min": 120,  # 10:00-12:00 sfora la finestra (chiude alle 11:00)
                }
            ]
        }
        with self._windows(narrow):
            resp = self._put(f"/api/agenda/appointments/{appointment.id}", payload)
        self.assertEqual(resp.status_code, 409, resp.content)
        appointment.refresh_from_db()
        self.assertEqual(appointment.items.get().duration_min, 30)

    def test_put_empty_items_400(self):
        appointment = self._make(
            [{"service_id": self.svc60.id, "operator_id": self.op1.id}]
        )
        resp = self._put(
            f"/api/agenda/appointments/{appointment.id}", {"items": []}
        )
        self.assertEqual(resp.status_code, 400)

    # Il GET singolo non oscura le rotte con suffisso letterale (/check-in, /margin, /move).
    def test_action_routes_not_shadowed_by_get(self):
        appointment = self._make(
            [{"service_id": self.svc60.id, "operator_id": self.op1.id}]
        )
        resp = self.client.post(
            f"/api/agenda/appointments/{appointment.id}/check-in", **self.auth
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()["status"], Appointment.Status.CHECKED_IN)

        resp = self.client.get(
            f"/api/agenda/appointments/{appointment.id}/margin", **self.auth
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIn("margin", resp.json())


class PublicAvailabilityApiTests(AgendaTestBase):
    """GET /api/agenda/public/availability: disponibilità pubblica, senza auth."""

    def setUp(self):
        self.service = self.svc60
        self.date_str = self.day.isoformat()

    def test_public_availability_no_auth(self):
        # nessun header di auth
        items = json.dumps([{"service_id": self.service.id}])
        resp = self.client.get(
            f"/api/agenda/public/availability?salon={self.salon.slug}"
            f"&date={self.date_str}&items={items}"
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertIsInstance(resp.json(), list)

    def test_public_availability_unknown_salon_404(self):
        items = json.dumps([{"service_id": self.service.id}])
        resp = self.client.get(
            f"/api/agenda/public/availability?salon=inesistente"
            f"&date={self.date_str}&items={items}"
        )
        self.assertEqual(resp.status_code, 404, resp.content)
