from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from ninja import Schema


# ---- Etichette (ClientCategory) ---------------------------------------------


class CategoryOut(Schema):
    id: int
    name: str
    color: str
    order: int


class CategoryIn(Schema):
    name: str
    color: str = "#6366F1"
    order: int = 0


# ---- Cliente ------------------------------------------------------------------


class ClientOut(Schema):
    id: int
    first_name: str
    last_name: str
    full_name: str
    phone: str
    email: str
    wa: bool
    lang: str
    categories: list[CategoryOut]
    reliability: int
    origin: str
    birthday: Optional[date] = None
    since: Optional[date] = None
    consents: dict
    whatsapp_reminders: bool
    stripe_customer_id: str
    stripe_payment_method_id: str
    deposit_always: bool
    is_active: bool


class ClientDetailOut(ClientOut):
    visits: int
    total_spent: Decimal
    last_visit: Optional[datetime] = None


class ClientIn(Schema):
    first_name: str
    last_name: str = ""
    phone: str
    email: str = ""
    wa: bool = True
    lang: str = "it"
    category_ids: list[int] = []
    reliability: int = 100
    origin: str = ""
    birthday: Optional[date] = None
    since: Optional[date] = None
    consents: dict = {}
    whatsapp_reminders: bool = True
    stripe_customer_id: str = ""
    stripe_payment_method_id: str = ""
    deposit_always: bool = False
    is_active: bool = True


# ---- Import CSV (righe già parsate lato client, JSON) ------------------------


class ImportRowIn(Schema):
    first_name: str = ""
    last_name: str = ""
    email: str = ""
    phone: str = ""


class ImportIn(Schema):
    rows: list[ImportRowIn]


class ImportOut(Schema):
    created: int
    updated: int


# ---- Note ----------------------------------------------------------------------


class NoteOut(Schema):
    id: int
    client_id: int
    text: str
    visibility: str
    author_id: Optional[int] = None
    author_name: str = ""
    created_at: datetime

    @staticmethod
    def resolve_author_name(obj) -> str:
        author = getattr(obj, "author", None)
        if not author:
            return ""
        return author.get_full_name() or author.email


class NoteIn(Schema):
    text: str
    visibility: str = "private"


# ---- Schede tecniche (sola lettura dopo la creazione) -------------------------


class TechnicalSheetOut(Schema):
    id: int
    client_id: int
    appointment_id: Optional[int] = None
    category: str
    treatment: str
    zone: str
    products: str
    params: dict
    outcome: str
    duration_hold: str
    advice: str
    protocol: str
    next_step: str
    photo: Optional[str] = None
    author_id: Optional[int] = None
    author_name: str = ""
    created_at: datetime

    @staticmethod
    def resolve_author_name(obj) -> str:
        author = getattr(obj, "author", None)
        if not author:
            return ""
        return author.get_full_name() or author.email


class TechnicalSheetIn(Schema):
    appointment_id: Optional[int] = None
    category: str
    treatment: str
    zone: str = ""
    products: str = ""
    params: dict = {}
    outcome: str = ""
    duration_hold: str = ""
    advice: str = ""
    protocol: str = ""
    next_step: str = ""


class OkOut(Schema):
    ok: bool = True


class HookLeadIn(Schema):
    """Form pubblico di raccolta contatti (/<slug>/hook nell'app cliente)."""

    salon_slug: str
    first_name: str
    last_name: str = ""
    phone: str
    email: str = ""
    marketing: bool = False
    privacy: bool = False
    # Honeypot a CHECKBOX, nascosta via CSS: deve arrivare False.
    # Non un campo di testo: l'autofill di Chrome riempiva il vecchio `website`
    # (token che riconosce) e scartava utenti veri in silenzio. Le checkbox
    # l'autofill non le spunta, i bot che compilano tutto sì.
    trap: bool = False
    # Accettato per retrocompatibilità con bundle vecchi ancora in cache.
    website: str = ""


class HookLeadOut(Schema):
    ok: bool = True
