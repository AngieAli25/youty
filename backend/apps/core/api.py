from django.conf import settings as django_settings
from django.utils.dateparse import parse_date
from ninja import File, Router
from ninja.errors import HttpError
from ninja.files import UploadedFile
from ninja.pagination import LimitOffsetPagination, paginate

from common.auth import staff_auth
from common.permissions import require_owner, require_scope
from common.utils import salon_get

from .models import ActivityLog, DepositRule, Location, Salon, SalonSettings
from .schemas import (
    ActivityLogOut,
    DepositRuleIn,
    DepositRuleOut,
    LocationIn,
    LocationOut,
    OkOut,
    PublicBrandingOut,
    SalonOut,
    SettingsIn,
    SettingsOut,
)
from .services import log_activity

router = Router(tags=["core"])


def _settings(salon) -> SalonSettings:
    obj, _ = SalonSettings.objects.get_or_create(salon=salon)
    return obj


def _settings_out(s: SalonSettings) -> dict:
    return {
        "logo_url": s.logo.url if s.logo else None,
        "brand_color": s.brand_color,
        "opening_hours": s.opening_hours,
        "agenda_fill": s.agenda_fill,
        "slot_recovery": s.slot_recovery,
        "slot_interval_min": s.slot_interval_min,
        "lastminute_discount_cap": s.lastminute_discount_cap,
        "lastminute_monthly_budget": s.lastminute_monthly_budget,
        "flexible_enabled": s.flexible_enabled,
        "flexible_window_min": s.flexible_window_min,
        "flexible_reward_pct": s.flexible_reward_pct,
        "privacy_policy_url": s.privacy_policy_url,
        "cancel_min_hours": django_settings.CLIENT_MOVE_CANCEL_MIN_HOURS,
    }


# ---- Salone e impostazioni -------------------------------------------------


@router.get("/salon", auth=staff_auth, response=SalonOut)
def get_salon(request):
    salon = request.auth.salon
    return {
        "id": salon.id,
        "name": salon.name,
        "slug": salon.slug,
        "default_lang": salon.default_lang,
        "currency": salon.currency,
        "locations": list(salon.locations.all()),
        "settings": _settings_out(_settings(salon)),
    }


@router.put("/settings", auth=staff_auth, response=SettingsOut)
def update_settings(request, data: SettingsIn):
    ctx = request.auth
    require_owner(ctx)
    s = _settings(ctx.salon)
    payload = data.dict(exclude_unset=True)
    default_lang = payload.pop("default_lang", None)
    if default_lang is not None and default_lang not in Salon.Lang.values:
        raise HttpError(400, "Lingua non valida (it o en)")
    if "slot_interval_min" in payload and payload["slot_interval_min"] not in (15, 20, 30):
        raise HttpError(400, "Intervallo fasce orarie non valido (15, 20 o 30 minuti)")
    for name, value in payload.items():
        setattr(s, name, value)
    s.save()
    if default_lang is not None:
        ctx.salon.default_lang = default_lang
        ctx.salon.save(update_fields=["default_lang"])
    log_activity(ctx.salon, "settings.updated", "Impostazioni aggiornate", actor=ctx.user)
    return _settings_out(s)


@router.post("/settings/logo", auth=staff_auth, response=SettingsOut)
def upload_logo(request, logo: UploadedFile = File(...)):
    ctx = request.auth
    require_owner(ctx)
    s = _settings(ctx.salon)
    s.logo.save(logo.name, logo)
    log_activity(ctx.salon, "settings.updated", "Logo aggiornato", actor=ctx.user)
    return _settings_out(s)


@router.delete("/settings/logo", auth=staff_auth, response=SettingsOut)
def delete_logo(request):
    ctx = request.auth
    require_owner(ctx)
    s = _settings(ctx.salon)
    if s.logo:
        s.logo.delete(save=False)
    s.save()
    log_activity(ctx.salon, "settings.updated", "Logo rimosso", actor=ctx.user)
    return _settings_out(s)


# ---- Sedi ------------------------------------------------------------------


@router.get("/locations", auth=staff_auth, response=list[LocationOut])
def list_locations(request):
    return request.auth.salon.locations.all()


@router.post("/locations", auth=staff_auth, response=LocationOut)
def create_location(request, data: LocationIn):
    ctx = request.auth
    require_owner(ctx)
    return Location.objects.create(salon=ctx.salon, **data.dict())


@router.put("/locations/{int:location_id}", auth=staff_auth, response=LocationOut)
def update_location(request, location_id: int, data: LocationIn):
    ctx = request.auth
    require_owner(ctx)
    loc = salon_get(Location, ctx, location_id)
    for name, value in data.dict().items():
        setattr(loc, name, value)
    loc.save()
    return loc


@router.delete("/locations/{int:location_id}", auth=staff_auth, response=OkOut)
def delete_location(request, location_id: int):
    ctx = request.auth
    require_owner(ctx)
    loc = salon_get(Location, ctx, location_id)
    if ctx.salon.locations.count() <= 1:
        raise HttpError(400, "Impossibile eliminare l'unica sede")
    loc.delete()
    return OkOut()


# ---- Regole deposito -------------------------------------------------------


@router.get("/deposit-rules", auth=staff_auth, response=list[DepositRuleOut])
def list_deposit_rules(request):
    require_owner(request.auth)
    return request.auth.salon.deposit_rules.all()


@router.post("/deposit-rules", auth=staff_auth, response=DepositRuleOut)
def create_deposit_rule(request, data: DepositRuleIn):
    ctx = request.auth
    require_owner(ctx)
    rule = DepositRule.objects.create(salon=ctx.salon, **data.dict())
    log_activity(ctx.salon, "deposit_rule.created", f"Regola deposito: {rule.name}", actor=ctx.user)
    return rule


@router.put("/deposit-rules/{int:rule_id}", auth=staff_auth, response=DepositRuleOut)
def update_deposit_rule(request, rule_id: int, data: DepositRuleIn):
    ctx = request.auth
    require_owner(ctx)
    rule = salon_get(DepositRule, ctx, rule_id)
    for name, value in data.dict().items():
        setattr(rule, name, value)
    rule.save()
    return rule


@router.delete("/deposit-rules/{int:rule_id}", auth=staff_auth, response=OkOut)
def delete_deposit_rule(request, rule_id: int):
    ctx = request.auth
    require_owner(ctx)
    salon_get(DepositRule, ctx, rule_id).delete()
    return OkOut()


# ---- Registro attività -----------------------------------------------------


@router.get("/activity", auth=staff_auth, response=list[ActivityLogOut])
@paginate(LimitOffsetPagination)
def list_activity(
    request,
    type: str = "",
    q: str = "",
    date_from: str = "",
    date_to: str = "",
):
    ctx = request.auth
    require_scope(ctx, "activity_log")
    qs = ActivityLog.objects.filter(salon=ctx.salon)
    if type:
        qs = qs.filter(type__startswith=type)
    if q:
        qs = qs.filter(summary__icontains=q)
    if date_from and (d := parse_date(date_from)):
        qs = qs.filter(created_at__date__gte=d)
    if date_to and (d := parse_date(date_to)):
        qs = qs.filter(created_at__date__lte=d)
    return qs


# ---- Endpoint pubblico per il boot della web app cliente --------------------


@router.get("/public/branding", response=PublicBrandingOut)
def public_branding(request, salon: str):
    try:
        s = Salon.objects.get(slug=salon)
    except Salon.DoesNotExist:
        raise HttpError(404, "Salone non trovato")
    st = _settings(s)
    location = s.locations.filter(is_default=True).first() or s.locations.first()
    return {
        "name": s.name,
        "slug": s.slug,
        "default_lang": s.default_lang,
        "logo_url": st.logo.url if st.logo else None,
        "brand_color": st.brand_color,
        "address": location.address if location else "",
        "phone": location.phone if location else "",
        "opening_hours": st.opening_hours,
        "privacy_policy_url": st.privacy_policy_url,
    }
