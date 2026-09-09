"""Durable suppression of automatic backfill after skipped business activity.

ActivityLog is the existing operational audit trail, not subscription storage.
Entitlement reactivation never changes these records. Only an explicitly requested
manual reconciliation can resume full automatic synchronization.
"""
import logging

from apps.core.models import ActivityLog
from apps.core.services import log_activity
from common.portal_access import PortalAccessDenied, background_allowed, require_portal_access

logger = logging.getLogger("youty.integrations")
PAUSED = "integration.sync_paused"
RESUMED = "integration.sync_resumed"


class AutomaticSyncPaused(RuntimeError):
    pass


def latest_sync_audit(salon):
    return ActivityLog.objects.filter(salon=salon, type__in=(PAUSED, RESUMED)).order_by("-id").first()


def record_sync_gap(salon, operation, reason):
    return log_activity(
        salon, PAUSED, "Sincronizzazione automatica sospesa: attività saltata",
        payload={"operation": operation, "reason": reason, "replay": False},
    )


def automatic_sync_allowed(salon, operation):
    if not background_allowed(salon, operation):
        return False
    audit = latest_sync_audit(salon)
    if audit and audit.type == PAUSED:
        logger.warning("automatic_sync_skipped salon=%s operation=%s reason=backfill_requires_manual_request", salon.pk, operation)
        return False
    return True


def require_sync_access(salon, *, allow_backfill=False):
    try:
        require_portal_access(salon)
    except PortalAccessDenied as exc:
        record_sync_gap(salon, "full_sync", exc.access["status"])
        raise
    audit = latest_sync_audit(salon)
    if not allow_backfill and audit and audit.type == PAUSED:
        raise AutomaticSyncPaused("Sincronizzazione sospesa: recupero manuale richiesto")


def resume_after_manual_sync(salon, previous_audit_id):
    # A concurrently skipped operation must not be erased by this older run.
    latest = latest_sync_audit(salon)
    if latest and latest.type == PAUSED and latest.pk == previous_audit_id:
        log_activity(salon, RESUMED, "Sincronizzazione completa richiesta manualmente e completata",
                     payload={"paused_activity_id": latest.pk, "manual": True})


WEBHOOK_SKIPPED = "integration.webhook_skipped"


def webhook_was_skipped(salon, delivery_key):
    return ActivityLog.objects.filter(salon=salon, type=WEBHOOK_SKIPPED,
                                      payload__delivery_key=delivery_key).exists()


def record_skipped_webhook(salon, delivery_key):
    if not webhook_was_skipped(salon, delivery_key):
        log_activity(salon, WEBHOOK_SKIPPED, "Notifica di sincronizzazione saltata: nessun recupero automatico",
                     payload={"delivery_key": delivery_key, "replay": False})
