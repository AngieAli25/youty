"""Logica dell'agenda: disponibilità, depositi, creazione/spostamento/annullamento.

Convenzioni interne:
- tutti i calcoli di disponibilità lavorano in MINUTI DA MEZZANOTTE del giorno
  richiesto, nel fuso del salone (settings.TIME_ZONE);
- gli import verso staff/clients/catalog sono lazy (le app sono sviluppate in
  parallelo e si evita ogni rischio di ciclo);
- le finestre lavorabili arrivano da `staff.services.shift_windows(operator, date)`
  -> list[tuple[int, int]] (minuti), già al netto di pause pranzo e assenze.
"""

from common.portal_access import require_portal_access

import datetime as dt
from collections import defaultdict
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from ninja.errors import HttpError

from apps.core.models import DepositRule
from apps.core.services import emit_event, log_activity
from common.conditions import evaluate

from .models import Appointment, AppointmentService, Pause, WaitlistEntry

# Stati in cui l'appuntamento è ancora "aperto" e quindi modificabile.
OPEN_STATUSES = (
    Appointment.Status.CONFIRMED,
    Appointment.Status.CHECKED_IN,
    Appointment.Status.IN_PROGRESS,
)


# ---------------------------------------------------------------------------
# Primitive su intervalli (minuti da mezzanotte)
# ---------------------------------------------------------------------------


def _minutes_local(value: dt.datetime) -> int:
    local = timezone.localtime(value)
    return local.hour * 60 + local.minute


def _slot_datetime(day: dt.date, minutes: int) -> dt.datetime:
    naive = dt.datetime.combine(day, dt.time.min) + dt.timedelta(minutes=minutes)
    return timezone.make_aware(naive)


def _overlaps(intervals, start: int, end: int) -> bool:
    return any(b_start < end and b_end > start for b_start, b_end in intervals)


def _within_windows(windows, start: int, end: int) -> bool:
    # L'intervallo deve stare per intero DENTRO UNA sola finestra di turno
    # (un servizio non può scavalcare la pausa pranzo).
    return any(w_start <= start and end <= w_end for w_start, w_end in windows)


def _is_free(windows, busy, start: int, end: int, allow_soak: bool = False) -> bool:
    """Vero se [start, end) sta dentro una finestra di turno e non collide con
    alcun intervallo BLOCCANTE dell'operatrice.

    `busy` è una lista di tuple (start_min, end_min, hard):
    - hard=True  -> lavoro attivo o pausa: blocca SEMPRE (conflitto reale);
    - hard=False -> posa (soak): blocca solo se allow_soak è False.

    Con allow_soak=True gli intervalli di posa NON bloccano: una sovrapposizione
    manuale sulla posa altrui è ammessa (decisione dello staff), mai automatica.
    """
    if not _within_windows(windows, start, end):
        return False
    blocking = [(s, e) for s, e, hard in busy if hard or not allow_soak]
    return not _overlaps(blocking, start, end)


def _busy_map(salon, day: dt.date, exclude_appointment_id: int | None = None) -> dict:
    """Intervalli occupati per operatrice: {op_id: [(start_min, end_min, hard), ...]}.

    Due livelli per ogni AppointmentService concatenato da `start`:
    - ATTIVO  (offset .. offset+duration_min)          -> hard=True  (blocca sempre)
    - POSA    (fine attivo .. +soak_min), se soak_min>0 -> hard=False (soft)
    Le pause manuali sono sempre hard. Considera solo gli appuntamenti attivi
    (status non cancelled/no_show).
    """
    busy: dict[int, list[tuple[int, int, bool]]] = defaultdict(list)

    appointments = (
        Appointment.objects.filter(salon=salon, start__date=day)
        .exclude(status__in=Appointment.INACTIVE_STATUSES)
        .prefetch_related("items")
    )
    if exclude_appointment_id:
        appointments = appointments.exclude(id=exclude_appointment_id)
    for appointment in appointments:
        offset = _minutes_local(appointment.start)
        for item in appointment.items.all():  # già ordinati per (order, id)
            active_end = offset + item.duration_min
            busy[item.operator_id].append((offset, active_end, True))
            if item.soak_min:
                busy[item.operator_id].append(
                    (active_end, active_end + item.soak_min, False)
                )
            offset = active_end + item.soak_min

    for pause in Pause.objects.filter(salon=salon, start__date=day):
        start = _minutes_local(pause.start)
        busy[pause.operator_id].append((start, start + pause.duration_min, True))

    return busy


def _operators_qs(salon, location=None):
    from apps.staff.models import Operator  # lazy

    qs = Operator.objects.filter(salon=salon, active=True)
    if location is not None:
        # Operatrici della sede richiesta + quelle senza sede assegnata.
        qs = qs.filter(Q(location__isnull=True) | Q(location=location))
    return qs.order_by("order", "id")


# ---------------------------------------------------------------------------
# Disponibilità
# ---------------------------------------------------------------------------


def get_free_slots(salon, date: dt.date, items: list[dict], location=None) -> list[dict]:
    """Slot liberi per una sequenza di servizi.

    items = [{"service_id": int, "operator_id": int | None}]  (None = qualsiasi idonea)

    Griglia dall'intervallo fasce orarie del salone (SalonSettings.slot_interval_min,
    default settings.AGENDA_SLOT_STEP_MIN). Un orario t è valido se i servizi
    si concatenano in sequenza da t e per ciascuno esiste un'operatrice idonea
    (in `service.operators`) libera per l'intera finestra: dentro le proprie
    shift_windows, senza sovrapposizioni con appuntamenti attivi né pause.
    I servizi sono sequenziali (mai sovrapposti tra loro), quindi la scelta
    greedy per singolo servizio è completa: non serve backtracking.

    Ritorna [{"start": iso, "assignment": [{"service_id", "operator_id"}]}].
    """
    from apps.catalog.models import Service  # lazy
    from apps.staff.services import shift_windows  # lazy

    if not items:
        raise HttpError(400, "Nessun servizio selezionato")

    salon_settings = getattr(salon, "settings", None)
    step = getattr(salon_settings, "slot_interval_min", None) or settings.AGENDA_SLOT_STEP_MIN
    operators = list(_operators_qs(salon, location))
    operator_by_id = {op.id: op for op in operators}

    # (servizio, [operatrici candidate]) per ogni voce richiesta
    plan: list[tuple[object, list]] = []
    for raw in items:
        service = Service.objects.filter(id=raw.get("service_id"), salon=salon).first()
        if service is None:
            raise HttpError(404, "Servizio non trovato")
        eligible_ids = set(service.operators.values_list("id", flat=True))
        requested = raw.get("operator_id")
        if requested:
            operator = operator_by_id.get(requested)
            candidates = [operator] if operator and operator.id in eligible_ids else []
        else:
            candidates = [op for op in operators if op.id in eligible_ids]
        if not candidates:
            return []  # nessuna operatrice idonea: mai disponibile
        plan.append((service, candidates))

    windows = {op.id: shift_windows(op, date) for op in operators}
    busy = _busy_map(salon, date)

    all_windows = [
        w for _, candidates in plan for op in candidates for w in windows.get(op.id, [])
    ]
    if not all_windows:
        return []
    grid_start = min(w[0] for w in all_windows)
    grid_end = max(w[1] for w in all_windows)
    first_tick = ((grid_start + step - 1) // step) * step  # allinea alla griglia

    now = timezone.now()
    slots = []
    for tick in range(first_tick, grid_end, step):
        cursor = tick
        assignment = []
        feasible = True
        for service, candidates in plan:
            end = cursor + service.duration_min
            # disponibilità automatica: la posa altrui conta come occupata
            # (allow_soak=False), quindi uno slot non viene MAI offerto se
            # cadrebbe nella finestra di posa di un altro appuntamento.
            chosen = next(
                (
                    op
                    for op in candidates
                    if _is_free(
                        windows.get(op.id, []), busy.get(op.id, ()), cursor, end,
                        allow_soak=False,
                    )
                ),
                None,
            )
            if chosen is None:
                feasible = False
                break
            assignment.append({"service_id": service.id, "operator_id": chosen.id})
            # il prossimo servizio parte dopo lavoro attivo + posa di questo
            cursor = end + (service.soak_min or 0)
        if not feasible:
            continue
        start_dt = _slot_datetime(date, tick)
        if start_dt < now:  # niente slot nel passato
            continue
        slots.append({"start": start_dt.isoformat(), "assignment": assignment})
    return slots


# ---------------------------------------------------------------------------
# Deposito
# ---------------------------------------------------------------------------


def compute_deposit(salon, client, total_price) -> Decimal:
    """Importo del deposito richiesto per il cliente sul totale indicato.

    - client.deposit_always -> prima regola attiva qualunque (per priority);
    - altrimenti prima DepositRule attiva le cui conditions matchano i facts
      del cliente (clients.services.client_facts);
    - pct -> percentuale del totale, fixed -> importo. 0 se nessuna regola.
    """
    rules = list(DepositRule.objects.filter(salon=salon, active=True))  # ordering: priority
    if not rules:
        return Decimal("0.00")

    if getattr(client, "deposit_always", False):
        rule = rules[0]
    else:
        from apps.clients.services import client_facts  # lazy

        facts = client_facts(client)
        rule = next((r for r in rules if evaluate(r.conditions, facts)), None)

    if rule is None:
        return Decimal("0.00")
    if rule.amount_type == DepositRule.AmountType.PERCENT:
        return (Decimal(total_price) * rule.amount / Decimal("100")).quantize(
            Decimal("0.01")
        )
    return Decimal(rule.amount).quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------
# Validazione slot per creazione / spostamento
# ---------------------------------------------------------------------------


def resolve_items(
    salon,
    items: list[dict],
    start: dt.datetime,
    *,
    exclude_appointment_id: int | None = None,
    location=None,
) -> list[tuple]:
    """Risolve e valida la sequenza richiesta a partire da `start`.

    Per ogni item individua il servizio e l'operatrice (quella indicata, se
    idonea e libera, altrimenti la prima idonea libera). La libertà è verificata
    sulla sola finestra ATTIVA del servizio; la catena avanza di attivo + posa.
    Con operatrice indicata a mano è ammessa la sovrapposizione alla posa altrui
    (allow_soak=True); in auto-assegnazione mai (allow_soak=False). Solleva:
    - 404 servizio inesistente, 400 operatrice non idonea,
    - 409 "Orario non più disponibile" se lo slot non è libero.

    Ritorna [(service, operator), ...] nell'ordine richiesto.
    """
    from apps.catalog.models import Service  # lazy
    from apps.staff.services import shift_windows  # lazy

    if not items:
        raise HttpError(400, "Nessun servizio selezionato")

    local = timezone.localtime(start)
    day = local.date()
    cursor = local.hour * 60 + local.minute

    busy = _busy_map(salon, day, exclude_appointment_id=exclude_appointment_id)
    operators = list(_operators_qs(salon, location))
    operator_by_id = {op.id: op for op in operators}
    windows_cache: dict[int, list] = {}

    def _windows(op):
        if op.id not in windows_cache:
            windows_cache[op.id] = shift_windows(op, day)
        return windows_cache[op.id]

    resolved = []
    for raw in items:
        service = Service.objects.filter(id=raw.get("service_id"), salon=salon).first()
        if service is None:
            raise HttpError(404, "Servizio non trovato")
        eligible_ids = set(service.operators.values_list("id", flat=True))
        active = service.duration_min
        end = cursor + active
        requested = raw.get("operator_id")
        # operatrice scelta a mano -> può sovrapporsi alla posa altrui;
        # assegnazione automatica (requested is None) -> mai nella posa altrui.
        allow_soak = requested is not None
        chosen = None
        if requested:
            operator = operator_by_id.get(requested)
            if operator is None or operator.id not in eligible_ids:
                raise HttpError(400, "Operatrice non idonea per il servizio selezionato")
            if _is_free(
                _windows(operator), busy.get(operator.id, ()), cursor, end,
                allow_soak=allow_soak,
            ):
                chosen = operator
        else:
            chosen = next(
                (
                    op
                    for op in operators
                    if op.id in eligible_ids
                    and _is_free(
                        _windows(op), busy.get(op.id, ()), cursor, end,
                        allow_soak=False,
                    )
                ),
                None,
            )
        if chosen is None:
            raise HttpError(409, "Orario non più disponibile")
        resolved.append((service, chosen))
        cursor = end + (service.soak_min or 0)
    return resolved


def resolve_items_edit(
    salon,
    items: list[dict],
    start: dt.datetime,
    *,
    exclude_appointment_id: int | None = None,
    location=None,
) -> list[tuple]:
    """Come resolve_items ma con durata per-item sovrascrivibile manualmente.

    Per ogni item la durata EFFETTIVA è raw["duration_min"] quando è un int
    positivo, altrimenti service.duration_min (dal listino). La catena avanza
    sulla durata effettiva e la libertà viene validata su quell'intervallo.
    Regole di scelta operatrice identiche a resolve_items:
    - 404 servizio inesistente, 400 operatrice non idonea,
    - 409 "Orario non più disponibile" se lo slot non è libero.

    Ritorna [(service, operator, duration_min), ...] con duration_min effettiva.
    """
    from apps.catalog.models import Service  # lazy
    from apps.staff.services import shift_windows  # lazy

    if not items:
        raise HttpError(400, "Nessun servizio selezionato")

    local = timezone.localtime(start)
    day = local.date()
    cursor = local.hour * 60 + local.minute

    busy = _busy_map(salon, day, exclude_appointment_id=exclude_appointment_id)
    operators = list(_operators_qs(salon, location))
    operator_by_id = {op.id: op for op in operators}
    windows_cache: dict[int, list] = {}

    def _windows(op):
        if op.id not in windows_cache:
            windows_cache[op.id] = shift_windows(op, day)
        return windows_cache[op.id]

    resolved = []
    for raw in items:
        service = Service.objects.filter(id=raw.get("service_id"), salon=salon).first()
        if service is None:
            raise HttpError(404, "Servizio non trovato")
        raw_duration = raw.get("duration_min")
        # durata ATTIVA effettiva: override solo se int positivo, altrimenti listino
        duration_min = (
            raw_duration
            if isinstance(raw_duration, int) and not isinstance(raw_duration, bool) and raw_duration > 0
            else service.duration_min
        )
        # la posa arriva sempre dal listino (non sovrascrivibile per-item)
        soak = service.soak_min or 0
        eligible_ids = set(service.operators.values_list("id", flat=True))
        end = cursor + duration_min
        requested = raw.get("operator_id")
        allow_soak = requested is not None
        chosen = None
        if requested:
            operator = operator_by_id.get(requested)
            if operator is None or operator.id not in eligible_ids:
                raise HttpError(400, "Operatrice non idonea per il servizio selezionato")
            if _is_free(
                _windows(operator), busy.get(operator.id, ()), cursor, end,
                allow_soak=allow_soak,
            ):
                chosen = operator
        else:
            chosen = next(
                (
                    op
                    for op in operators
                    if op.id in eligible_ids
                    and _is_free(
                        _windows(op), busy.get(op.id, ()), cursor, end,
                        allow_soak=False,
                    )
                ),
                None,
            )
        if chosen is None:
            raise HttpError(409, "Orario non più disponibile")
        resolved.append((service, chosen, duration_min))
        cursor = end + soak
    return resolved


def _validate_segments(
    salon,
    start: dt.datetime,
    segments: list[tuple],
    *,
    exclude_appointment_id: int | None = None,
) -> None:
    """Valida una sequenza già assegnata: segments = [(active_min, soak_min, operator)].

    Usata per lo spostamento (durate = snapshot attivo/posa degli item). Essendo
    un'azione MANUALE dello staff, ogni finestra attiva è validata con
    allow_soak=True: può sovrapporsi alla posa altrui, mai al lavoro attivo/pausa.
    Solleva 409 se un segmento non è dentro turno o collide con un intervallo
    bloccante. La catena avanza di attivo + posa.
    """
    from apps.staff.services import shift_windows  # lazy

    local = timezone.localtime(start)
    day = local.date()
    cursor = local.hour * 60 + local.minute
    busy = _busy_map(salon, day, exclude_appointment_id=exclude_appointment_id)
    windows_cache: dict[int, list] = {}
    for active_min, soak_min, operator in segments:
        end = cursor + active_min
        if operator.id not in windows_cache:
            windows_cache[operator.id] = shift_windows(operator, day)
        if not _is_free(
            windows_cache[operator.id], busy.get(operator.id, ()), cursor, end,
            allow_soak=True,
        ):
            raise HttpError(409, "Orario non più disponibile")
        cursor = end + (soak_min or 0)


# ---------------------------------------------------------------------------
# Mutazioni
# ---------------------------------------------------------------------------


def _ensure_open(appointment: Appointment) -> None:
    if appointment.status not in OPEN_STATUSES:
        raise HttpError(400, "Appuntamento non modificabile nello stato attuale")


def _event_payload(appointment: Appointment) -> dict:
    """Payload standard per Yourang: id + dati utili (nome, telefono, lingua, orari ISO)."""
    client = appointment.client
    return {
        "appointment_id": appointment.id,
        "client_id": client.id,
        "client_name": client.full_name,
        "phone": client.phone,
        "lang": client.lang,
        "start": appointment.start.isoformat(),
        "end": appointment.end.isoformat(),
        "operator_id": appointment.operator_id,
        "services": [
            {
                "id": item.service_id,
                "name": item.service.name_it,
                "duration_min": item.duration_min,
            }
            for item in appointment.items.select_related("service")
        ],
        "total_price": str(appointment.total_price),
        "deposit_amount": str(appointment.deposit_amount),
        "deposit_status": appointment.deposit_status,
    }


def snapshot_items(appointment: Appointment, resolved: list[tuple]) -> None:
    """Crea gli AppointmentService con snapshot durata/posa/prezzo dal listino."""
    for index, (service, operator) in enumerate(resolved):
        AppointmentService.objects.create(
            appointment=appointment,
            service=service,
            operator=operator,
            duration_min=service.duration_min,
            soak_min=service.soak_min,
            price=service.price,
            order=index,
        )


def snapshot_items_edit(appointment: Appointment, resolved: list[tuple]) -> None:
    """Crea gli AppointmentService usando la durata ATTIVA EFFETTIVA (dalla tupla),
    la posa dal listino, prezzo dal listino e order = indice. Le tuple arrivano
    da resolve_items_edit come (service, operator, duration_min)."""
    for index, (service, operator, duration_min) in enumerate(resolved):
        AppointmentService.objects.create(
            appointment=appointment,
            service=service,
            operator=operator,
            duration_min=duration_min,
            soak_min=service.soak_min,
            price=service.price,
            order=index,
        )


@transaction.atomic
def create_appointment(
    salon,
    client,
    items: list[dict],
    start: dt.datetime,
    *,
    via: str,
    actor=None,
    flexible: bool = False,
    note: str = "",
    location=None,
) -> Appointment:
    """Crea l'appuntamento rivalidando che lo slot sia libero (altrimenti 409)."""
    require_portal_access(salon)
    resolved = resolve_items(salon, items, start, location=location)

    total_price = sum((service.price for service, _ in resolved), start=Decimal("0"))
    deposit = compute_deposit(salon, client, total_price)

    appointment = Appointment.objects.create(
        salon=salon,
        location=location,
        client=client,
        operator=resolved[0][1],  # operatrice principale = quella del primo servizio
        start=start,
        flexible=flexible,
        note=note,
        created_via=via,
        deposit_amount=deposit,
        deposit_status=(
            Appointment.DepositStatus.REQUIRED
            if deposit > 0
            else Appointment.DepositStatus.NONE
        ),
    )
    snapshot_items(appointment, resolved)

    log_activity(
        salon,
        "appointment.created",
        f"Nuovo appuntamento per {client.full_name}",
        actor=actor,
        location=location,
        payload={
            "appointment_id": appointment.id,
            "client_id": client.id,
            "start": appointment.start.isoformat(),
            "via": via,
        },
    )
    emit_event(salon, "appointment.created", _event_payload(appointment))
    return appointment


@transaction.atomic
def move_appointment(
    appointment: Appointment,
    new_start: dt.datetime,
    *,
    operator=None,
    actor=None,
) -> Appointment:
    """Sposta l'appuntamento (items con lo stesso delta, essendo sequenziali da start).

    Se `operator` è indicata, subentra all'operatrice principale sui suoi item
    (previa verifica di idoneità). Rivalida lo slot escludendo l'appuntamento
    stesso; emette appointment.moved e slot.freed sul vecchio orario.
    """
    require_portal_access(appointment.salon)
    _ensure_open(appointment)
    old_start = appointment.start
    old_operator_id = appointment.operator_id

    items = list(appointment.items.select_related("service", "operator"))
    if not items:
        raise HttpError(400, "Appuntamento senza servizi")

    target_operators = []
    for item in items:
        if operator is not None and item.operator_id == old_operator_id:
            if not item.service.operators.filter(id=operator.id).exists():
                raise HttpError(400, "Operatrice non idonea per il servizio selezionato")
            target_operators.append(operator)
        else:
            target_operators.append(item.operator)

    _validate_segments(
        appointment.salon,
        new_start,
        [
            (item.duration_min, item.soak_min, op)
            for item, op in zip(items, target_operators)
        ],
        exclude_appointment_id=appointment.id,
    )

    appointment.start = new_start
    if operator is not None:
        appointment.operator = operator
        for item, target in zip(items, target_operators):
            if item.operator_id != target.id:
                item.operator = target
                item.save(update_fields=["operator"])
    appointment.save()

    log_activity(
        appointment.salon,
        "appointment.moved",
        f"Appuntamento di {appointment.client.full_name} spostato",
        actor=actor,
        payload={
            "appointment_id": appointment.id,
            "old_start": old_start.isoformat(),
            "new_start": appointment.start.isoformat(),
        },
    )
    emit_event(
        appointment.salon,
        "appointment.moved",
        {**_event_payload(appointment), "old_start": old_start.isoformat()},
    )
    free_slot_event(appointment, start=old_start, operator_id=old_operator_id)
    return appointment


@transaction.atomic
def check_in(appointment: Appointment, *, actor=None) -> Appointment:
    require_portal_access(appointment.salon)
    _ensure_open(appointment)
    appointment.status = Appointment.Status.CHECKED_IN
    appointment.save(update_fields=["status", "updated_at"])
    log_activity(
        appointment.salon,
        "appointment.checked_in",
        f"Check-in di {appointment.client.full_name}",
        actor=actor,
        payload={"appointment_id": appointment.id},
    )
    emit_event(appointment.salon, "appointment.checked_in", _event_payload(appointment))
    return appointment


@transaction.atomic
def start_appointment(appointment: Appointment, *, actor=None) -> Appointment:
    require_portal_access(appointment.salon)
    _ensure_open(appointment)
    appointment.status = Appointment.Status.IN_PROGRESS
    appointment.save(update_fields=["status", "updated_at"])
    log_activity(
        appointment.salon,
        "appointment.started",
        f"Trattamento iniziato per {appointment.client.full_name}",
        actor=actor,
        payload={"appointment_id": appointment.id},
    )
    return appointment


@transaction.atomic
def mark_no_show(appointment: Appointment, *, reason: str = "", actor=None) -> Appointment:
    """No-show: stato + deposito paid->forfeited. L'addebito Stripe è di sales."""
    require_portal_access(appointment.salon)
    _ensure_open(appointment)
    appointment.status = Appointment.Status.NO_SHOW
    appointment.cancel_reason = reason or ""
    if appointment.deposit_status == Appointment.DepositStatus.PAID:
        appointment.deposit_status = Appointment.DepositStatus.FORFEITED
    appointment.save()
    log_activity(
        appointment.salon,
        "appointment.no_show",
        f"No-show di {appointment.client.full_name}",
        actor=actor,
        payload={"appointment_id": appointment.id, "reason": reason},
    )
    emit_event(
        appointment.salon,
        "appointment.no_show",
        {**_event_payload(appointment), "reason": reason},
    )
    free_slot_event(appointment)
    return appointment


@transaction.atomic
def cancel_appointment(appointment: Appointment, *, reason: str = "", actor=None) -> Appointment:
    """Annulla: cancelled_late se mancano meno di CLIENT_MOVE_CANCEL_MIN_HOURS ore.

    Deposito pagato: forfeited se tardivo, altrimenti refunded.
    """
    require_portal_access(appointment.salon)
    _ensure_open(appointment)
    late = appointment.start - timezone.now() < dt.timedelta(
        hours=settings.CLIENT_MOVE_CANCEL_MIN_HOURS
    )
    appointment.status = Appointment.Status.CANCELLED
    appointment.cancel_reason = reason or ""
    appointment.cancelled_late = late
    if appointment.deposit_status == Appointment.DepositStatus.PAID:
        appointment.deposit_status = (
            Appointment.DepositStatus.FORFEITED
            if late
            else Appointment.DepositStatus.REFUNDED
        )
    appointment.save()
    log_activity(
        appointment.salon,
        "appointment.cancelled",
        f"Appuntamento di {appointment.client.full_name} annullato"
        + (" (tardivo)" if late else ""),
        actor=actor,
        payload={"appointment_id": appointment.id, "reason": reason, "late": late},
    )
    emit_event(
        appointment.salon,
        "appointment.cancelled",
        {**_event_payload(appointment), "reason": reason, "late": late},
    )
    free_slot_event(appointment)
    return appointment


def free_slot_event(appointment: Appointment, *, start=None, operator_id=None):
    """Emette slot.freed con le voci di lista d'attesa compatibili.

    Compatibilità: entry attiva, stesso servizio di uno degli item e operatrice
    non indicata oppure tra quelle coinvolte nell'appuntamento.
    """
    require_portal_access(appointment.salon)
    start = start or appointment.start
    operator_id = operator_id or appointment.operator_id
    items = list(appointment.items.all())
    service_ids = {item.service_id for item in items}
    operator_ids = {item.operator_id for item in items} | {operator_id}

    matching = (
        WaitlistEntry.objects.filter(
            salon=appointment.salon,
            status=WaitlistEntry.Status.ACTIVE,
            service_id__in=service_ids,
        )
        .filter(Q(operator__isnull=True) | Q(operator_id__in=operator_ids))
        .values_list("id", flat=True)
    )
    return emit_event(
        appointment.salon,
        "slot.freed",
        {
            "appointment_id": appointment.id,
            "start": start.isoformat(),
            "duration_min": sum(item.duration_min for item in items),
            "operator_id": operator_id,
            "matching_waitlist": list(matching),
        },
    )
