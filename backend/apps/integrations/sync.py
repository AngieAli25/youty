"""Sync fra il salone e Yourang: Clienti↔Contatti, Servizi/Pacchetti→Catalogo,
Appuntamenti↔Eventi.

Chiave naturale condivisa per i contatti = telefono in E.164 (l'external API
Yourang impone il telefono univoco per org e offre le rotte `by-phone`
idempotenti). I servizi vengono spinti in un unico catalogo per salone.
"""

import re
from dataclasses import dataclass, field

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.agenda.models import Appointment, AppointmentService
from apps.catalog.models import Package, Service, ServiceCategory
from apps.clients.models import Client
from apps.staff.models import Operator

from common.portal_access import require_portal_access, PortalAccessDenied

from .access_policy import require_sync_access, record_sync_gap
from .client import YourangClient
from .models import YourangConnection

# Stati evento Yourang (EventStatusEnum, uppercase) → stato Appointment beauty.
_EVENT_STATUS = {
    "confirmed": Appointment.Status.CONFIRMED,
    "approved": Appointment.Status.CONFIRMED,
    "pending": Appointment.Status.CONFIRMED,
    "completed": Appointment.Status.CLOSED,
    "closed": Appointment.Status.CLOSED,
    "no_show": Appointment.Status.NO_SHOW,
    "noshow": Appointment.Status.NO_SHOW,
    "cancelled": Appointment.Status.CANCELLED,
    "canceled": Appointment.Status.CANCELLED,
    "rejected": Appointment.Status.CANCELLED,
    "pending_deletion": Appointment.Status.CANCELLED,
}


# Lo 0 subito dopo il country code è il prefisso interurbano e quasi ovunque va
# tolto: +44 020 7946 0958 e +44 20 7946 0958 sono lo stesso numero di Londra.
# L'Italia è l'eccezione — lo 0 di distretto fa parte del numero nazionale e
# resta: +39 02 1234567 è giusto, +39 2 1234567 non esiste.
#
# La distinzione conta perché il telefono è la chiave naturale dei contatti
# Yourang: sbagliarla da un lato o dall'altro fa chiudere lo stesso numero su
# due chiavi diverse, cioè due contatti nella stessa organizzazione.
TRUNK_ZERO_KEPT = {"39"}

# Per togliere quello 0 bisogna sapere dove finisce il country code, e i CC
# hanno lunghezza variabile. La tabella è volutamente corta (i paesi da cui
# arrivano davvero le clienti) e un CC che non c'è lascia il numero intatto:
# accorciare senza sapere dove finisce il prefisso è peggio che non toccare.
COUNTRY_CODES = ("39", "44", "49", "33", "34", "41", "43", "32", "31", "30", "351", "353", "420")


def _drop_trunk_zero(digits: str) -> str:
    """Toglie l'eventuale 0 interurbano dopo il country code, dove serve."""
    for cc in sorted(COUNTRY_CODES, key=len, reverse=True):
        if not digits.startswith(cc):
            continue
        rest = digits[len(cc):]
        if cc in TRUNK_ZERO_KEPT or not rest.startswith("0"):
            return digits
        return cc + rest[1:]
    return digits


def normalize_phone(raw: str, default_cc: str = "39") -> str | None:
    """Porta un numero a testo libero in E.164 (`+39...`). None se non normalizzabile."""
    if not raw:
        return None
    s = re.sub(r"[^\d+]", "", raw.strip())
    if s.startswith("+"):
        digits = s[1:]
    elif s.startswith("00"):
        digits = s[2:]
    else:
        digits = default_cc + s
    digits = _drop_trunk_zero(digits)
    if not re.fullmatch(r"[1-9]\d{6,14}", digits):
        return None
    return "+" + digits


def _split_name(full: str) -> tuple[str, str]:
    parts = (full or "").strip().split()
    if not parts:
        return ("Cliente", "")
    return (parts[0], " ".join(parts[1:]))


@dataclass
class SyncReport:
    created: int = 0
    linked: int = 0
    updated: int = 0
    pushed: int = 0
    items: int = 0
    errors: list[str] = field(default_factory=list)


# ---- Clienti ↔ Contatti ----------------------------------------------------


def sync_clients(conn: YourangConnection, *, allow_backfill=False) -> SyncReport:
    """Riconcilia per telefono E.164: linkati→aggiorna, stesso telefono→linka,
    mancanti→crea; i clienti nativi non ancora su Yourang vengono spinti."""
    require_sync_access(conn.salon, allow_backfill=allow_backfill)
    report = SyncReport()
    client = YourangClient(conn)
    salon = conn.salon

    # 1) scarica tutti i contatti Yourang
    remote: list[dict] = []
    offset = 0
    while True:
        page = client.list_contacts(limit=100, offset=offset)
        remote.extend(page)
        if len(page) < 100:
            break
        offset += 100

    locals_by_id = {
        c.yourang_contact_id: c
        for c in Client.objects.filter(salon=salon).exclude(yourang_contact_id="")
    }
    locals_by_phone = {}
    # Anche i disattivati: il vincolo unique (salon, phone) vale comunque, quindi
    # senza di loro un contatto remoto con quel numero farebbe fallire la create.
    for c in Client.objects.filter(salon=salon):
        norm = normalize_phone(c.phone)
        if norm:
            locals_by_phone.setdefault(norm, c)

    linked_ids = set()

    # 2) Yourang → locale
    for rc in remote:
        require_sync_access(salon, allow_backfill=allow_backfill)
        rid = str(rc.get("id") or "")
        phone = normalize_phone(rc.get("phone_number", ""))
        first = rc.get("first_name") or "Cliente"
        last = rc.get("last_name") or ""
        email = rc.get("email") or ""

        local = locals_by_id.get(rid)
        if local is None and phone:
            local = locals_by_phone.get(phone)
            if local and not local.yourang_contact_id:
                local.yourang_contact_id = rid
                local.save(update_fields=["yourang_contact_id"])
                report.linked += 1
        if local is None:
            if not phone:
                continue
            Client.objects.create(
                salon=salon,
                first_name=first,
                last_name=last,
                phone=phone,
                email=email,
                yourang_contact_id=rid,
            )
            report.created += 1
        else:
            changed = []
            if local.email != email and email:
                local.email = email
                changed.append("email")
            if local.last_name != last and last:
                local.last_name = last
                changed.append("last_name")
            if changed:
                local.save(update_fields=changed)
                report.updated += 1
        if rid:
            linked_ids.add(rid)

    # 3) locali senza corrispondenza → push su Yourang
    for local in Client.objects.filter(salon=salon, is_active=True):
        require_sync_access(salon, allow_backfill=allow_backfill)
        if local.yourang_contact_id:
            continue
        phone = normalize_phone(local.phone)
        if not phone:
            continue
        try:
            created = client.create_or_get_contact(
                phone,
                {
                    "first_name": local.first_name,
                    "last_name": local.last_name,
                    "email": local.email or None,
                },
            )
        except PortalAccessDenied as exc:
            record_sync_gap(salon, "full_sync", exc.access["status"])
            raise
        except Exception as exc:  # 403 senza scope contacts:write → degrada
            report.errors.append(f"push {phone}: {exc}")
            continue
        if created.get("id"):
            local.yourang_contact_id = str(created["id"])
            local.save(update_fields=["yourang_contact_id"])
            report.pushed += 1

    return report


# ---- Servizi / Pacchetti → Catalogo ----------------------------------------


def sync_services(conn: YourangConnection, *, allow_backfill=False) -> SyncReport:
    require_sync_access(conn.salon, allow_backfill=allow_backfill)
    report = SyncReport()
    client = YourangClient(conn)
    salon = conn.salon

    if not conn.catalogue_id:
        cat = client.create_catalogue(f"{salon.name} — Servizi")
        if not cat.get("id"):
            report.errors.append("creazione catalogo fallita")
            return report
        conn.catalogue_id = str(cat["id"])
        conn.save(update_fields=["catalogue_id"])

    for svc in Service.objects.filter(salon=salon, active=True).select_related("category"):
        require_sync_access(salon, allow_backfill=allow_backfill)
        payload = {
            "name": svc.name_it or svc.name_en,
            "sku": f"service-{svc.id}",
            "price": str(svc.price),
            "currency": salon.currency,
            "category": svc.category.name_it if svc.category else "",
            "catalogue_id": conn.catalogue_id,
        }
        try:
            item = client.upsert_catalogue_item(svc.yourang_item_id or None, payload)
        except PortalAccessDenied as exc:
            record_sync_gap(salon, "full_sync", exc.access["status"])
            raise
        except Exception as exc:
            report.errors.append(f"servizio {svc.id}: {exc}")
            continue
        if item.get("id") and str(item["id"]) != svc.yourang_item_id:
            svc.yourang_item_id = str(item["id"])
            svc.save(update_fields=["yourang_item_id"])
        report.items += 1

    for pkg in Package.objects.filter(salon=salon, active=True):
        require_sync_access(salon, allow_backfill=allow_backfill)
        payload = {
            "name": pkg.name,
            "sku": f"package-{pkg.id}",
            "description": pkg.description,
            "price": str(pkg.price),
            "currency": salon.currency,
            "category": "Pacchetti",
            "catalogue_id": conn.catalogue_id,
        }
        try:
            item = client.upsert_catalogue_item(pkg.yourang_item_id or None, payload)
        except PortalAccessDenied as exc:
            record_sync_gap(salon, "full_sync", exc.access["status"])
            raise
        except Exception as exc:
            report.errors.append(f"pacchetto {pkg.id}: {exc}")
            continue
        if item.get("id") and str(item["id"]) != pkg.yourang_item_id:
            pkg.yourang_item_id = str(item["id"])
            pkg.save(update_fields=["yourang_item_id"])
        report.items += 1

    return report


# ---- Appuntamenti ↔ Eventi -------------------------------------------------


def _default_operator(salon) -> Operator:
    op = Operator.objects.filter(salon=salon, active=True).order_by("order", "id").first()
    if op is None:
        # ponytail: un evento Yourang non porta un'operatrice → una di default,
        # così le prenotazioni in ingresso hanno sempre dove atterrare.
        op = Operator.objects.create(salon=salon, first_name="Yourang", last_name="", active=True)
    return op


def _yourang_service(salon) -> Service:
    svc = Service.objects.filter(salon=salon, name_it="Prenotazione Yourang").first()
    if svc is None:
        cat = (
            ServiceCategory.objects.filter(salon=salon).order_by("order", "id").first()
            or ServiceCategory.objects.create(salon=salon, name_it="Yourang")
        )
        svc = Service.objects.create(
            salon=salon, category=cat, name_it="Prenotazione Yourang", duration_min=60, price=0,
        )
    return svc


def _event_duration_min(data: dict, start) -> int:
    end = parse_datetime(data.get("ending_date") or "")
    if end:
        if timezone.is_naive(end):
            end = timezone.make_aware(end)
        mins = int((end - start).total_seconds() // 60)
        if mins > 0:
            return mins
    return 60


def import_event(conn: YourangConnection, event_id: str) -> Appointment | None:
    """Scarica un evento Yourang e fa upsert dell'Appointment (idempotente su id)."""
    require_portal_access(conn.salon)
    salon = conn.salon
    data = YourangClient(conn).get_event(event_id)
    if not data:
        return None
    require_portal_access(salon)

    operator = _default_operator(salon)

    phone = normalize_phone(data.get("client_phone_number", "") or "") or ""
    first, last = _split_name(data.get("client_full_name", ""))
    # get_or_create anche senza telefono: il vincolo unique (salon, phone) permette
    # UN solo cliente con phone="" per salone. ponytail: le prenotazioni Yourang
    # senza numero condividono un cliente segnaposto; deduplica per contact-id
    # quando l'evento lo espone.
    client_obj, _ = Client.objects.get_or_create(
        salon=salon, phone=phone,
        defaults={"first_name": first or "Cliente", "last_name": last},
    )

    start = parse_datetime(data.get("starting_date") or "")
    if start is None:
        return None
    if timezone.is_naive(start):
        start = timezone.make_aware(start)

    status = _EVENT_STATUS.get(str(data.get("status", "")).lower(), Appointment.Status.CONFIRMED)

    appt, _ = Appointment.objects.update_or_create(
        salon=salon,
        yourang_event_id=str(event_id),
        defaults={
            "client": client_obj,
            "operator": operator,
            "start": start,
            "status": status,
            "created_via": Appointment.CreatedVia.YOURANG,
            "note": "Prenotazione da Yourang",
        },
    )
    # ponytail: nessun mapping affidabile Evento→Servizio locale → una riga
    # segnaposto "Prenotazione Yourang" con la durata reale dell'evento, così
    # l'appuntamento è visibile in agenda (la durata deriva dagli items).
    if not appt.items.exists():
        AppointmentService.objects.create(
            appointment=appt,
            service=_yourang_service(salon),
            operator=operator,
            duration_min=_event_duration_min(data, start),
            soak_min=0,
            price=0,
        )
    return appt


def cancel_event(conn: YourangConnection, event_id: str) -> None:
    require_portal_access(conn.salon)
    Appointment.objects.filter(
        salon=conn.salon, yourang_event_id=str(event_id)
    ).update(status=Appointment.Status.CANCELLED)


def import_contact(conn: YourangConnection, contact_id: str) -> Client | None:
    """Apply only the contact named by a newly received signed notification.

    This must never call full reconciliation: unrelated contacts skipped while
    access was unavailable stay untouched after reactivation.
    """
    require_portal_access(conn.salon)
    data = YourangClient(conn).get_contact(contact_id)
    require_portal_access(conn.salon)
    if str(data.get("id") or "") != contact_id:
        raise ValueError("Unexpected Yourang contact identity")
    salon = conn.salon
    phone = normalize_phone(data.get("phone_number", ""))
    local = Client.objects.filter(salon=salon, yourang_contact_id=contact_id).first()
    if local is None and phone:
        local = Client.objects.filter(salon=salon, phone=phone).first()
        if local and local.yourang_contact_id and local.yourang_contact_id != contact_id:
            raise ValueError("Contact already linked to a different Yourang identity")
    if local is None:
        if not phone:
            return None
        return Client.objects.create(
            salon=salon, phone=phone, first_name=data.get("first_name") or "Cliente",
            last_name=data.get("last_name") or "", email=data.get("email") or "",
            yourang_contact_id=contact_id,
        )
    local.yourang_contact_id = contact_id
    if data.get("email"):
        local.email = data["email"]
    if data.get("last_name"):
        local.last_name = data["last_name"]
    local.save(update_fields=["yourang_contact_id", "email", "last_name"])
    return local
