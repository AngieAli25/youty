from datetime import datetime
from decimal import Decimal
from typing import Optional

from ninja import Schema


class LocationOut(Schema):
    id: int
    name: str
    address: str
    phone: str
    is_default: bool


class LocationIn(Schema):
    name: str
    address: str = ""
    phone: str = ""
    is_default: bool = False


class SettingsOut(Schema):
    logo_url: Optional[str] = None
    brand_color: str
    opening_hours: str = ""
    agenda_fill: str
    slot_recovery: str
    slot_interval_min: int
    lastminute_discount_cap: int
    lastminute_monthly_budget: Decimal
    flexible_enabled: bool
    flexible_window_min: int
    flexible_reward_pct: int
    # Informativa privacy del salone, mostrata nel form pubblico /<slug>/hook.
    privacy_policy_url: str = ""
    # Soglia (ore) sotto la quale una cancellazione è "tardiva" → caparra trattenuta.
    # Derivata da settings.CLIENT_MOVE_CANCEL_MIN_HOURS, sola lettura.
    cancel_min_hours: int


class SettingsIn(Schema):
    default_lang: Optional[str] = None
    brand_color: Optional[str] = None
    opening_hours: Optional[str] = None
    agenda_fill: Optional[str] = None
    slot_recovery: Optional[str] = None
    slot_interval_min: Optional[int] = None
    lastminute_discount_cap: Optional[int] = None
    lastminute_monthly_budget: Optional[Decimal] = None
    flexible_enabled: Optional[bool] = None
    flexible_window_min: Optional[int] = None
    flexible_reward_pct: Optional[int] = None
    privacy_policy_url: Optional[str] = None


class SalonOut(Schema):
    id: int
    name: str
    slug: str
    default_lang: str
    currency: str
    locations: list[LocationOut]
    settings: SettingsOut


class DepositRuleOut(Schema):
    id: int
    name: str
    conditions: dict
    amount_type: str
    amount: Decimal
    priority: int
    active: bool


class DepositRuleIn(Schema):
    name: str
    conditions: dict = {}
    amount_type: str
    amount: Decimal
    priority: int = 0
    active: bool = True


class ActivityLogOut(Schema):
    id: int
    type: str
    summary: str
    actor_name: str
    payload: dict
    created_at: datetime


class PublicBrandingOut(Schema):
    name: str
    slug: str
    default_lang: str
    logo_url: Optional[str] = None
    brand_color: str
    address: str = ""
    phone: str = ""
    opening_hours: str = ""
    privacy_policy_url: str = ""


class OkOut(Schema):
    ok: bool = True
