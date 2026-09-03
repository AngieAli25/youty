"""JWT auth per le due popolazioni: staff (dashboard) e clienti (web app).

Uso negli endpoint ninja:

    from common.auth import staff_auth, client_auth

    @router.get("/qualcosa", auth=staff_auth)
    def view(request):
        ctx = request.auth  # StaffContext
"""

import datetime as dt
from dataclasses import dataclass, field

import jwt
from django.conf import settings
from ninja.security import HttpBearer

ALGO = "HS256"


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _encode(claims: dict, ttl: dt.timedelta) -> str:
    payload = {
        **claims,
        "iat": int(_now().timestamp()),
        "exp": int((_now() + ttl).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGO)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGO])
    except jwt.PyJWTError:
        return None


def create_staff_tokens(user, salon) -> dict:
    # sub come stringa: PyJWT >= 2.10 rifiuta in decodifica i sub non-stringa
    base = {"sub": str(user.id), "salon": salon.id, "tv": user.token_version or 0}
    return {
        "access": _encode(
            {**base, "typ": "staff"},
            dt.timedelta(minutes=settings.JWT_ACCESS_TTL_MIN),
        ),
        "refresh": _encode(
            {**base, "typ": "staff_refresh"},
            dt.timedelta(days=settings.JWT_REFRESH_TTL_DAYS),
        ),
    }


def create_client_tokens(client) -> dict:
    return {
        "access": _encode(
            {"sub": str(client.id), "salon": client.salon_id, "typ": "client"},
            dt.timedelta(days=settings.JWT_REFRESH_TTL_DAYS),
        )
    }


@dataclass
class StaffContext:
    user: object
    salon: object
    membership: object
    scopes: set = field(default_factory=set)
    is_owner: bool = False


@dataclass
class ClientContext:
    client: object
    salon: object


class StaffAuth(HttpBearer):
    def authenticate(self, request, token):
        payload = decode_token(token)
        if not payload or payload.get("typ") != "staff":
            return None
        from apps.accounts.models import Membership  # lazy: evita cicli in fase di load

        membership = (
            Membership.objects.select_related("user", "salon", "role")
            .filter(
                user_id=payload["sub"],
                salon_id=payload["salon"],
                user__is_active=True,
            )
            .first()
        )
        if membership is None:
            return None
        # Password cambiata dopo l'emissione del token → sessione non più valida.
        # I token emessi prima di questa modifica non hanno "tv": valgono 0, come
        # il default sull'utente, quindi restano validi e nessuno viene sloggato
        # al deploy.
        if payload.get("tv", 0) != (membership.user.token_version or 0):
            return None
        scopes = set(membership.role.scopes or []) if membership.role else set()
        return StaffContext(
            user=membership.user,
            salon=membership.salon,
            membership=membership,
            scopes=scopes,
            is_owner=membership.is_owner,
        )


class ClientAuth(HttpBearer):
    def authenticate(self, request, token):
        payload = decode_token(token)
        if not payload or payload.get("typ") != "client":
            return None
        from apps.clients.models import Client  # lazy

        client = (
            Client.objects.select_related("salon")
            .filter(id=payload["sub"], is_active=True)
            .first()
        )
        if client is None:
            return None
        return ClientContext(client=client, salon=client.salon)


staff_auth = StaffAuth()
client_auth = ClientAuth()
