"""Client HTTP verso il proxy Yourang (connect.<brand>).

Il portale non possiede più credenziali Yourang: il proxy è l'OAuth client di
tutti i portali, custodisce i token di ogni organizzazione e li rinnova sotto
mutex. Qui restano solo (a) l'avvio del login e il riscatto del link code, e
(b) i wrapper delle rotte external API usate dal sync.

Perché il refresh è sparito da qui: Yourang ruota il refresh token a ogni uso e
brucia l'intera famiglia anche quando due refresh concorrenti corrono sullo
stesso token. Un solo posto può farlo in sicurezza, ed è il proxy.
"""

import logging
from urllib.parse import quote, urlencode

import httpx
from django.conf import settings

from .models import YourangConnection

logger = logging.getLogger(__name__)

TIMEOUT = 20.0


def _proxy_base() -> str:
    """Base del portale sul proxy: https://connect.<brand>/v/<slug>."""
    return f"{settings.YOURANG_PROXY_URL.rstrip('/')}/v/{settings.YOURANG_PROXY_SLUG}"


def _api_key() -> str:
    return settings.YOURANG_PROXY_API_KEY


def proxy_login_url(return_to: str) -> str:
    """URL a cui mandare il browser per consenso/login."""
    return f"{_proxy_base()}/auth/login?{urlencode({'return_to': return_to})}"


def redeem_link_code(code: str) -> dict:
    """Scambia il codice monouso (?yr_link=) con l'identità dietro di esso.

    Server-to-server: serve l'API key, che non tocca mai il browser. Ritorna
    {sub, email, email_verified, name, org_id}.
    """
    resp = httpx.post(
        f"{_proxy_base()}/auth/link",
        json={"code": code},
        headers={"Authorization": f"Bearer {_api_key()}"},
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


class YourangClient:
    """Chiamate external API per UN salone, instradate dal proxy.

    L'organizzazione viaggia in X-Yourang-Org: è un selettore, non
    un'asserzione — il proxy replica solo un grant che quell'org ha già
    concesso, quindi un'org mai collegata riceve 401, mai i dati di un altro.
    """

    def __init__(self, conn: YourangConnection):
        self.conn = conn

    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        if not self.conn.yourang_org_id:
            raise RuntimeError("Connessione Yourang senza organizzazione: ricollegare")
        headers = {
            "Authorization": f"Bearer {_api_key()}",
            "X-Yourang-Org": self.conn.yourang_org_id,
        }
        resp = httpx.request(
            method, f"{_proxy_base()}/api{path}", headers=headers, timeout=TIMEOUT, **kwargs
        )
        resp.raise_for_status()
        return resp

    @staticmethod
    def _data(resp: httpx.Response):
        return resp.json().get("data")

    # -- contatti --
    def list_contacts(self, limit: int = 100, offset: int = 0) -> list[dict]:
        resp = self._request("GET", f"/contacts?limit={limit}&offset={offset}")
        return self._data(resp) or []

    def create_or_get_contact(self, phone: str, payload: dict) -> dict:
        """Crea il contatto; se il telefono esiste già lo recupera e basta.

        L'external API NON ha un upsert by-phone (solo GET/PATCH/DELETE; il PUT
        vive su /contacts/{id}), e il telefono è univoco per org → la create
        risponde 400 quando c'è già. Il '+' va percent-encodato nel path o
        verrebbe letto come spazio.
        """
        try:
            resp = self._request(
                "POST", "/contacts", json={**payload, "phone_number": phone}
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 400:
                raise
            resp = self._request("GET", f"/contacts/by-phone/{quote(phone, safe='')}")
        return self._data(resp) or {}

    # -- cataloghi --
    def create_catalogue(self, name: str) -> dict:
        resp = self._request("POST", "/catalogues", json={"name": name})
        return self._data(resp) or {}

    def upsert_catalogue_item(self, item_id: str | None, payload: dict) -> dict:
        if item_id:
            resp = self._request("PUT", f"/catalogues/items/{item_id}", json=payload)
        else:
            resp = self._request("POST", "/catalogues/items", json=payload)
        return self._data(resp) or {}

    # -- eventi --
    def get_event(self, event_id: str) -> dict:
        resp = self._request("GET", f"/events/{event_id}")
        return self._data(resp) or {}
