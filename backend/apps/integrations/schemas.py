from datetime import datetime
from typing import Optional

from ninja import Schema


class AuthorizeOut(Schema):
    authorize_url: str


class ExchangeIn(Schema):
    """Link code monouso restituito dal proxy in ?yr_link=, più il flusso.

    Niente `state`: PKCE e state sono del proxy, non nostri.
    """

    code: str
    mode: str = "login"


class StatusOut(Schema):
    connected: bool
    status: str = "disconnected"
    connected_at: Optional[datetime] = None
    last_sync_at: Optional[datetime] = None
    yourang_org_id: str = ""


class OkOut(Schema):
    ok: bool = True
