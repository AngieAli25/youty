"""Test essenziali: shift_windows (turno normale, con pausa, con assenza, cycle_weeks=2)
e l'endpoint pubblico /public/operators (scelta stilista in prenotazione)."""

import datetime as dt
from decimal import Decimal

from common.testing import SubscribedSalonTestCase as TestCase

from apps.core.models import Salon

from .models import Absence, Operator, WeeklyShift
from .services import shift_windows


class ShiftWindowsTests(TestCase):
    def setUp(self):
        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        self.operator = Operator.objects.create(
            salon=self.salon, first_name="Giulia", last_name="Rossi"
        )
        # mercoledì 1 luglio 2026: settimana ISO 27 (27 % 2 == 1)
        self.day = dt.date(2026, 7, 1)
        assert self.day.weekday() == 2

    def test_turno_normale(self):
        WeeklyShift.objects.create(
            operator=self.operator, week_index=0, weekday=2, start_min=540, end_min=1020
        )
        self.assertEqual(shift_windows(self.operator, self.day), [(540, 1020)])

    def test_turno_con_pausa(self):
        WeeklyShift.objects.create(
            operator=self.operator,
            week_index=0,
            weekday=2,
            start_min=540,
            end_min=1020,
            break_start_min=780,
            break_end_min=840,
        )
        self.assertEqual(shift_windows(self.operator, self.day), [(540, 780), (840, 1020)])

    def test_assenza_annulla_il_turno(self):
        WeeklyShift.objects.create(
            operator=self.operator, week_index=0, weekday=2, start_min=540, end_min=1020
        )
        Absence.objects.create(
            operator=self.operator,
            date_from=self.day,
            date_to=self.day,
            type=Absence.Type.VACATION,
        )
        self.assertEqual(shift_windows(self.operator, self.day), [])

    def test_nessun_turno_nessuna_finestra(self):
        self.assertEqual(shift_windows(self.operator, self.day), [])

    def test_cycle_weeks_due(self):
        self.operator.cycle_weeks = 2
        self.operator.save(update_fields=["cycle_weeks"])
        WeeklyShift.objects.create(
            operator=self.operator, week_index=0, weekday=2, start_min=540, end_min=1020
        )
        WeeklyShift.objects.create(
            operator=self.operator, week_index=1, weekday=2, start_min=600, end_min=900
        )
        day_a = self.day  # settimana ISO 27 -> week_index 1
        day_b = self.day + dt.timedelta(days=7)  # settimana ISO 28 -> week_index 0
        self.assertEqual(day_a.isocalendar()[1] % 2, 1)
        self.assertEqual(day_b.isocalendar()[1] % 2, 0)
        self.assertEqual(shift_windows(self.operator, day_a), [(600, 900)])
        self.assertEqual(shift_windows(self.operator, day_b), [(540, 1020)])


class PublicOperatorsApiTests(TestCase):
    """GET /api/staff/public/operators: elenco operatrici attive, senza auth."""

    def setUp(self):
        from apps.catalog.models import Service, ServiceCategory

        self.salon = Salon.objects.create(name="The Parlour", slug="the-parlour")
        category = ServiceCategory.objects.create(salon=self.salon, name_it="Unghie")
        self.service = Service.objects.create(
            salon=self.salon,
            category=category,
            name_it="Manicure",
            duration_min=30,
            price=Decimal("20.00"),
        )
        self.op_active = Operator.objects.create(
            salon=self.salon, first_name="Giulia", last_name="Rossi", color="#AACCEE"
        )
        self.op_active.services.add(self.service)
        self.op_inactive = Operator.objects.create(
            salon=self.salon, first_name="Marta", last_name="Verdi", active=False
        )

    def test_public_operators_no_auth(self):
        resp = self.client.get(f"/api/staff/public/operators?salon={self.salon.slug}")
        self.assertEqual(resp.status_code, 200, resp.content)
        data = resp.json()
        ids = [o["id"] for o in data]
        self.assertIn(self.op_active.id, ids)
        self.assertNotIn(self.op_inactive.id, ids)
        active = next(o for o in data if o["id"] == self.op_active.id)
        self.assertEqual(active["service_ids"], [self.service.id])
        self.assertEqual(active["initials"], "GR")
        self.assertEqual(active["color"], "#AACCEE")

    def test_public_operators_unknown_salon_404(self):
        resp = self.client.get("/api/staff/public/operators?salon=inesistente")
        self.assertEqual(resp.status_code, 404, resp.content)
