"""Rotte integrazione Yourang: connect via proxy, webhook in ingresso, stato.

Flusso "Collega Yourang" (tutti i portali passano dal proxy connect.<brand>):
  1. dashboard apre un popup su /oauth-popup/start
  2. la pagina chiama GET /oauth/start → riceve l'URL di login sul proxy
  3. il proxy gestisce consenso e PKCE e torna su /oauth-popup/done?yr_link=…
  4. exchange riscatta il link code lato server e fa il primo sync

Niente PKCE, niente state, niente token da queste parti: sono tutti nel proxy.
"""

import hashlib
import hmac
import json
import logging
import time

from django.conf import settings
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError

from common.auth import StaffAuth, staff_auth
from common.permissions import require_owner
from common.portal_access import background_allowed, PortalAccessDenied

from . import client as yc
from . import sync
from .access_policy import automatic_sync_allowed, record_skipped_webhook, record_sync_gap, webhook_was_skipped
from .login import login_with_link_code
from .models import YourangConnection
from .schemas import AuthorizeOut, ExchangeIn, OkOut, StatusOut

logger = logging.getLogger("youty.integrations")
router = Router(tags=["integrations"])

WEBHOOK_TOLERANCE_SECONDS = 300


def _status_out(conn: YourangConnection | None) -> dict:
    if conn is None or conn.status != YourangConnection.Status.CONNECTED:
        return {"connected": False, "status": conn.status if conn else "disconnected"}
    return {
        "connected": True,
        "status": conn.status,
        "connected_at": conn.connected_at,
        "last_sync_at": conn.last_sync_at,
        "yourang_org_id": conn.yourang_org_id,
    }


def _require_config() -> None:
    if not (settings.YOURANG_PROXY_URL and settings.YOURANG_PROXY_API_KEY):
        raise HttpError(503, "Integrazione Yourang non configurata")


def _return_to(mode: str) -> str:
    """Dove il proxy rimanda il browser dopo il consenso (vi aggiunge ?yr_link=).

    Il `mode` viaggia qui perché non esiste più una riga di stato lato nostro a
    ricordarlo: il proxy possiede PKCE e state, e il guard sull'open-redirect
    confronta solo schema+host+porta, quindi una query string passa intatta.
    """
    return f"{settings.FRONTEND_ORIGIN.rstrip('/')}/oauth-popup/done?mode={mode}"


# ---- Connect (OAuth) -------------------------------------------------------


@router.get("/yourang/oauth/start", auth=staff_auth, response=AuthorizeOut)
def oauth_start(request):
    """Avvia il flusso "connect" (dalle impostazioni, utente loggato)."""
    require_owner(request.auth)
    _require_config()
    return {"authorize_url": yc.proxy_login_url(_return_to("connect"))}


@router.get("/yourang/oauth/login/start", auth=None, response=AuthorizeOut)
def oauth_login_start(request):
    """Avvia il flusso "login con Yourang" (dalla pagina di login, nessuna sessione)."""
    _require_config()
    return {"authorize_url": yc.proxy_login_url(_return_to("login"))}


@router.post("/yourang/oauth/exchange", auth=None)
def oauth_exchange(request, data: ExchangeIn):
    """Riscatta il link code. `mode` distingue i due flussi (lo state non esiste
    più lato nostro: PKCE e state vivono nel proxy).

    connect → collega il salone della sessione staff corrente;
    login   → provisiona/collega salone+utente e conia la sessione staff.
    """
    _require_config()

    if data.mode == "login":
        try:
            session = login_with_link_code(data.code)
        except Exception as exc:
            logger.exception("Yourang login failed")
            raise HttpError(502, "Login con Yourang fallito") from exc
        return {"mode": "login", "session": session}

    # --- Connect: serve una sessione staff, e solo il titolare può collegare ---
    ctx = StaffAuth()(request)
    if not ctx:
        raise HttpError(401, "Sessione staff richiesta")
    require_owner(ctx)

    try:
        identity = yc.redeem_link_code(data.code)
    except Exception as exc:
        logger.exception("Yourang link code redemption failed")
        raise HttpError(502, "Collegamento con Yourang fallito") from exc

    org = str(identity.get("org_id") or "")
    if not org:
        raise HttpError(502, "Identità Yourang senza organizzazione")

    # Un'org serve UN salone: se è già altrove, collegarla qui spezzerebbe
    # silenziosamente l'altro (il webhook risolve il salone dall'org).
    taken = YourangConnection.objects.filter(yourang_org_id=org).exclude(salon=ctx.salon).first()
    if taken:
        raise HttpError(409, "Questa organizzazione Yourang è già collegata a un altro salone")

    conn, _ = YourangConnection.objects.get_or_create(salon=ctx.salon)
    conn.yourang_org_id = org
    conn.connected_by = ctx.user
    conn.status = YourangConnection.Status.CONNECTED
    conn.last_error = ""
    conn.save()

    try:
        if not automatic_sync_allowed(conn.salon, "initial_sync"):
            return {"mode": "connect", "status": _status_out(conn)}
        sync.sync_clients(conn)
        sync.sync_services(conn)
        conn.last_sync_at = timezone.now()
        conn.save(update_fields=["last_sync_at"])
    except Exception as exc:
        logger.exception("Yourang initial sync failed")
        conn.last_error = str(exc)
        conn.save(update_fields=["last_error"])

    return {"mode": "connect", "status": _status_out(conn)}


@router.get("/yourang/status", auth=staff_auth, response=StatusOut)
def status(request):
    conn = YourangConnection.objects.filter(salon=request.auth.salon).first()
    return _status_out(conn)


@router.delete("/yourang/connection", auth=staff_auth, response=OkOut)
def disconnect(request):
    ctx = request.auth
    require_owner(ctx)
    record_sync_gap(ctx.salon, "integration_disconnect", "disconnected")
    YourangConnection.objects.filter(salon=ctx.salon).delete()
    return OkOut()


# ---- Webhook in ingresso (nessuna auth JWT: firma HMAC) ---------------------


def _verify_webhook(body: bytes, signature_header: str, timestamp: str) -> bool:
    """HMAC-SHA256 su "{timestamp}.{body}", come firma il proxy.

    Il segreto è ora uno solo per portale (quello che il proxy usa per la sua
    ri-emissione), non più uno per salone: il proxy verifica la firma della
    piattaforma e ri-firma con il proprio. Fail-closed se non configurato —
    questa rotta è pubblica.
    """
    secret = settings.YOURANG_PROXY_WEBHOOK_SECRET
    if not secret or not signature_header or not timestamp:
        return False
    try:
        if abs(time.time() - int(timestamp)) > WEBHOOK_TOLERANCE_SECONDS:
            return False
    except ValueError:
        return False
    expected = hmac.new(
        secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature_header)


@router.post("/yourang/webhook", auth=None, response=OkOut)
def webhook(request):
    body = request.body
    org_id = ""
    try:
        payload = json.loads(body) if body else {}
        if not isinstance(payload, dict):
            raise ValueError("Payload non valido")
        org_id = str(payload.get("organization_id") or "")
    except (ValueError, UnicodeDecodeError):
        raise HttpError(400, "Payload non valido")

    # La firma si verifica PRIMA di toccare il DB: /yourang/webhook è pubblica,
    # e l'org nel payload non è attendibile finché la firma non lo rende tale.
    if not _verify_webhook(
        body,
        request.headers.get("x-yourang-signature", ""),
        request.headers.get("x-yourang-timestamp", ""),
    ):
        raise HttpError(401, "Firma webhook non valida")

    conn = YourangConnection.objects.filter(yourang_org_id=org_id).first() if org_id else None
    if conn is None:
        return OkOut()  # org sconosciuta: ignora silenziosamente

    delivery_key = hashlib.sha256(str(payload.get("id") or json.dumps(payload, sort_keys=True)).encode()).hexdigest()
    if webhook_was_skipped(conn.salon, delivery_key):
        return OkOut()
    if not background_allowed(conn.salon, "yourang_webhook"):
        record_skipped_webhook(conn.salon, delivery_key)
        return OkOut()

    # Payload Yourang: notifica sottile {type, resource, resource_id, organization_id}.
    # NB: `id` è l'id della consegna webhook (random), l'evento è in `resource_id`.
    event_type = str(payload.get("type") or payload.get("event_type") or "")
    entity_id = str(payload.get("resource_id") or "")

    try:
        if event_type in ("contact.created", "contact.updated") and entity_id:
            sync.import_contact(conn, entity_id)
        elif event_type == "event.deleted":
            sync.cancel_event(conn, entity_id)
        elif event_type.startswith("event") and entity_id:
            sync.import_event(conn, entity_id)
    except PortalAccessDenied as exc:
        record_sync_gap(conn.salon, "yourang_webhook", exc.access["status"])
        record_skipped_webhook(conn.salon, delivery_key)
    except Exception:
        logger.exception("Yourang webhook processing failed (%s)", event_type)

    return OkOut()
