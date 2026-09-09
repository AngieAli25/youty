import json
import uuid as uuid_lib

from ninja import Router
from ninja.errors import HttpError

from apps.core.services import emit_event, log_activity
from common.portal_access import business_operation, background_allowed
from common.auth import staff_auth
from common.permissions import require_scope
from common.utils import salon_get

from .models import Automation
from .schemas import (
    AutomationIn,
    AutomationOut,
    EventsCatalogOut,
    OkOut,
    WebhookTriggerOut,
)

router = Router(tags=["automations"])


# ---- Catalogo statico per il costruttore UI --------------------------------

EVENTS = [
    ("new_client", "Nuovo cliente", "New client"),
    ("appointment_created", "Appuntamento creato", "Appointment created"),
    ("appointment_upcoming", "Appuntamento in arrivo", "Upcoming appointment"),
    ("visit_completed", "Visita completata", "Visit completed"),
    ("birthday", "Compleanno", "Birthday"),
    ("client_inactive", "Cliente inattivo", "Inactive client"),
    ("no_show", "Mancata presentazione", "No-show"),
    ("slot_freed", "Slot liberato", "Slot freed"),
]

OPERATORS = [
    ("eq", "Uguale a", "Equal to"),
    ("neq", "Diverso da", "Not equal to"),
    ("lt", "Minore di", "Less than"),
    ("lte", "Minore o uguale a", "Less than or equal to"),
    ("gt", "Maggiore di", "Greater than"),
    ("gte", "Maggiore o uguale a", "Greater than or equal to"),
    ("contains", "Contiene", "Contains"),
]

FILTER_FIELDS = [
    ("reliability", "Affidabilità", "Reliability"),
    ("categories", "Etichette", "Categories"),
    ("total_spent", "Speso totale", "Total spent"),
    ("visits", "Visite", "Visits"),
    ("noshow_count", "Mancate presentazioni", "No-shows"),
]


def _catalog_items(rows):
    return [{"value": value, "label_it": label_it, "label_en": label_en} for value, label_it, label_en in rows]


def _definition(automation: Automation) -> dict:
    """Definizione completa della regola, inviata a Yourang per la sincronizzazione."""
    return {
        "id": automation.id,
        "salon_id": automation.salon_id,
        "name": automation.name,
        "event": automation.event,
        "offset_direction": automation.offset_direction,
        "offset_value": automation.offset_value,
        "offset_unit": automation.offset_unit,
        "send_time": automation.send_time.isoformat() if automation.send_time else None,
        "conditions": automation.conditions,
        "trigger_origin": automation.trigger_origin,
        "webhook_token": str(automation.webhook_token),
        "message_preview": automation.message_preview,
        "active": automation.active,
    }


# ---- CRUD --------------------------------------------------------------


@router.get("/", auth=staff_auth, response=list[AutomationOut])
def list_automations(request):
    return request.auth.salon.automations.all()


@router.post("/", auth=staff_auth, response=AutomationOut)
@business_operation
def create_automation(request, data: AutomationIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    automation = Automation.objects.create(salon=ctx.salon, **data.dict())
    log_activity(
        ctx.salon,
        "automation.created",
        f"Automazione creata: {automation.name}",
        actor=ctx.user,
        payload={"automation_id": automation.id},
    )
    emit_event(ctx.salon, "automation.updated", _definition(automation))
    return automation


@router.put("/{int:automation_id}", auth=staff_auth, response=AutomationOut)
@business_operation
def update_automation(request, automation_id: int, data: AutomationIn):
    ctx = request.auth
    require_scope(ctx, "marketing")
    automation = salon_get(Automation, ctx, automation_id)
    for name, value in data.dict().items():
        setattr(automation, name, value)
    automation.save()
    log_activity(
        ctx.salon,
        "automation.updated",
        f"Automazione aggiornata: {automation.name}",
        actor=ctx.user,
        payload={"automation_id": automation.id},
    )
    emit_event(ctx.salon, "automation.updated", _definition(automation))
    return automation


@router.delete("/{int:automation_id}", auth=staff_auth, response=OkOut)
@business_operation
def delete_automation(request, automation_id: int):
    ctx = request.auth
    require_scope(ctx, "marketing")
    automation = salon_get(Automation, ctx, automation_id)
    name = automation.name
    automation_id_value = automation.id
    definition = _definition(automation)
    definition["deleted"] = True
    automation.delete()
    log_activity(
        ctx.salon,
        "automation.deleted",
        f"Automazione eliminata: {name}",
        actor=ctx.user,
        payload={"automation_id": automation_id_value},
    )
    emit_event(ctx.salon, "automation.updated", definition)
    return OkOut()


@router.post("/{int:automation_id}/toggle", auth=staff_auth, response=AutomationOut)
@business_operation
def toggle_automation(request, automation_id: int):
    ctx = request.auth
    require_scope(ctx, "marketing")
    automation = salon_get(Automation, ctx, automation_id)
    automation.active = not automation.active
    automation.save(update_fields=["active", "updated_at"])
    log_activity(
        ctx.salon,
        "automation.updated",
        f"Automazione {'attivata' if automation.active else 'disattivata'}: {automation.name}",
        actor=ctx.user,
        payload={"automation_id": automation.id, "active": automation.active},
    )
    emit_event(ctx.salon, "automation.updated", _definition(automation))
    return automation


# ---- Catalogo eventi/operatori/campi (per il costruttore UI) ---------------


@router.get("/events-catalog", auth=staff_auth, response=EventsCatalogOut)
def events_catalog(request):
    return {
        "events": _catalog_items(EVENTS),
        "operators": _catalog_items(OPERATORS),
        "fields": _catalog_items(FILTER_FIELDS),
    }


# ---- Webhook esterno (Yourang → youty), nessuna autenticazione -------------


@router.post("/hook/{webhook_token}", response=WebhookTriggerOut)
def trigger_webhook(request, webhook_token: str):
    try:
        token = uuid_lib.UUID(str(webhook_token))
    except (ValueError, TypeError, AttributeError):
        raise HttpError(404, "Automazione non trovata")

    automation = Automation.objects.filter(webhook_token=token).select_related("salon").first()
    if automation is None:
        raise HttpError(404, "Automazione non trovata")

    if not background_allowed(automation.salon, "automation_webhook"):
        return {"ok": True, "automation_id": automation.id}

    try:
        payload = json.loads(request.body) if request.body else {}
    except (json.JSONDecodeError, UnicodeDecodeError):
        payload = {}

    log_activity(
        automation.salon,
        "automation.triggered",
        f"Automazione attivata via webhook: {automation.name}",
        payload={"automation_id": automation.id, "payload": payload},
    )
    emit_event(
        automation.salon,
        "automation.triggered",
        {"automation_id": automation.id, "payload": payload},
    )
    return {"ok": True, "automation_id": automation.id}
