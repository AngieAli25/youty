"""Organization-bound marketplace access, shared by HTTP and background work.

The stored connection is the only org selector. Never accept an org from a
browser. A cached grant is usable only until the earliest server deadline.
"""

import hashlib
import logging
from datetime import timedelta
from functools import wraps

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from ninja import Schema
from ninja.errors import HttpError

logger = logging.getLogger("youty.portal_access")
MAX_AGE = 60
PUBLIC_MESSAGE = "Operazione al momento non disponibile. Contatta il salone."


class PortalAccessOut(Schema):
    organization_id: str | None = None
    portal_type: str = "beauty"
    module_type: str = "portal_beauty"
    variant: str | None = None
    operational_access: bool = False
    status: str
    expires_at: str | None = None
    checked_at: str
    valid_until: str
    purchase_url: str = ""


def _date(value):
    if not isinstance(value, str):
        raise ValueError("Missing access deadline")
    parsed = parse_datetime(value)
    if parsed is None or timezone.is_naive(parsed):
        raise ValueError("Invalid access deadline")
    return parsed


def _fallback(status, org=None, purchase_url=""):
    now = timezone.now()
    return PortalAccessOut(
        organization_id=org, status=status, checked_at=now.isoformat(),
        valid_until=now.isoformat(), purchase_url=purchase_url or settings.YOURANG_MARKETPLACE_URL,
    ).model_dump()


def resolve_portal_access(salon):
    from apps.integrations.client import YourangClient
    from apps.integrations.models import YourangConnection

    conn = YourangConnection.objects.filter(salon=salon).first()
    if conn is None or not conn.yourang_org_id:
        return _fallback("unavailable")
    # A recovery link is not an entitlement: keep it across transient check
    # failures, partitioned by the same salon/org and configured proxy origin.
    recovery_identity = "|".join((settings.YOURANG_PROXY_URL, settings.YOURANG_PROXY_SLUG,
                                  str(salon.pk), conn.yourang_org_id))
    recovery_key = "portal-recovery:" + hashlib.sha256(recovery_identity.encode()).hexdigest()
    try:
        purchase_url = cache.get(recovery_key) or settings.YOURANG_MARKETPLACE_URL
    except Exception:
        purchase_url = settings.YOURANG_MARKETPLACE_URL
    if (conn.status != YourangConnection.Status.CONNECTED
            or not settings.YOURANG_PROXY_URL or not settings.YOURANG_PROXY_API_KEY):
        return _fallback("unavailable", conn.yourang_org_id, purchase_url)

    # Include deployment/proxy/credentials/connection revision: relinking or
    # rotating a key must never reuse an old organization's access decision.
    identity = "|".join((settings.YOURANG_PROXY_URL, settings.YOURANG_PROXY_SLUG,
                         settings.YOURANG_PROXY_API_KEY, str(conn.pk), str(salon.pk),
                         conn.yourang_org_id, conn.updated_at.isoformat()))
    key = "portal-access:" + hashlib.sha256(identity.encode()).hexdigest()
    try:
        cached = cache.get(key)
        if cached and timezone.now() < _date(cached["valid_until"]):
            if not cached["operational_access"] or not cached["expires_at"] or timezone.now() < _date(cached["expires_at"]):
                return cached
        data = YourangClient(conn).portal_access()
        now = timezone.now()
        if (data.get("organization_id") != conn.yourang_org_id
                or data.get("portal_type") != "beauty"
                or data.get("module_type") != "portal_beauty"
                or type(data.get("operational_access")) is not bool
                or (data.get("variant") is not None and not isinstance(data["variant"], str))):
            raise ValueError("Invalid portal access identity")
        checked = _date(data["checked_at"])
        deadline = min(_date(data["valid_until"]), checked + timedelta(seconds=MAX_AGE),
                       now + timedelta(seconds=MAX_AGE))
        expiry = _date(data["expires_at"]) if data.get("expires_at") else None
        if expiry and data["operational_access"]:
            deadline = min(deadline, expiry)
        if checked > now + timedelta(seconds=5) or deadline <= now:
            raise ValueError("Expired portal access decision")
        result = PortalAccessOut(
            organization_id=conn.yourang_org_id, variant=data.get("variant"),
            operational_access=data["operational_access"],
            status="active" if data["operational_access"] else "subscription_required",
            expires_at=expiry.isoformat() if expiry else None,
            checked_at=checked.isoformat(), valid_until=deadline.isoformat(),
            purchase_url=data.get("purchase_url") or settings.YOURANG_MARKETPLACE_URL,
        ).model_dump()
        cache.set(key, result, timeout=max(1, int((deadline - now).total_seconds())))
        if result["purchase_url"]:
            cache.set(recovery_key, result["purchase_url"], timeout=86400)
        return result
    except Exception as exc:  # Access verification must never prevent login/browsing.
        logger.warning("portal_access_unavailable salon=%s error=%s", salon.pk, type(exc).__name__)
        return _fallback("unavailable", conn.yourang_org_id, purchase_url)


class PortalAccessDenied(HttpError):
    def __init__(self, access, public=False):
        self.access = access
        unavailable = access["status"] == "unavailable"
        message = (PUBLIC_MESSAGE if public else
                   "Verifica dell'abbonamento temporaneamente non disponibile. Riprova."
                   if unavailable else "Abbonamento Beauty richiesto. Accesso in sola lettura.")
        super().__init__(503 if unavailable else 403, message)


def require_portal_access(salon, *, public=False):
    access = resolve_portal_access(salon)
    if not access["operational_access"]:
        logger.warning("portal_operation_blocked salon=%s reason=%s", salon.pk, access["status"])
        raise PortalAccessDenied(access, public=public)
    return access


def business_operation(view):
    """Explicit semantic marker, independent of HTTP verb; auth runs first."""
    @wraps(view)
    def guarded(request, *args, **kwargs):
        ctx = request.auth
        require_portal_access(ctx.salon, public=not hasattr(ctx, "membership"))
        return view(request, *args, **kwargs)
    guarded.portal_business_operation = True
    return guarded


def background_allowed(salon, operation):
    access = resolve_portal_access(salon)
    if access["operational_access"]:
        return True
    from apps.integrations.access_policy import record_sync_gap
    record_sync_gap(salon, operation, access["status"])
    logger.warning("portal_activity_skipped salon=%s operation=%s reason=%s",
                   salon.pk, operation, access["status"])
    return False
