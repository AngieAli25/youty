"""Login con Yourang: da un'identità Yourang a una sessione staff beauty.

L'identità arriva dal proxy (riscatto del link code), non più da uno scambio
OAuth locale: il portale non vede mai un token Yourang. La logica di
risoluzione qui sotto è invariata — risolve o provisiona Salone + Utente +
Membership a partire da `org` e dai claim identità, poi conia i token staff e
(best-effort) sincronizza.

Precedenza (il SALONE si risolve dall'org, l'UTENTE sempre dall'identità Yourang):
  A. `org` già mappata su un salone (login precedente / connect) → entra lì come
     membro (owner solo se il salone non ha ancora nessuno).
  B. utente noto per email VERIFICATA → adotta un suo salone senza connessione.
  C. altrimenti → provisiona utente (se serve) + salone nuovo.
"""

import logging

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.accounts.models import Membership, User
from apps.core.models import Location, Salon, SalonSettings
from common.auth import create_staff_tokens

from . import client as yc
from .models import YourangConnection
from .sync import _split_name, sync_clients, sync_services

logger = logging.getLogger("youty.integrations")

def _unique_salon_slug(seed: str) -> str:
    base = slugify(seed)[:40] or "salone"
    slug, i = base, 1
    while Salon.objects.filter(slug=slug).exists():
        i += 1
        slug = f"{base}-{i}"[:50]
    return slug


def _get_or_create_user(email: str, name: str, email_verified: bool) -> User:
    user = User.objects.filter(email__iexact=email).first()
    if user:
        # Anti account-takeover (come food): colleghiamo un account beauty già
        # esistente solo se Yourang certifica l'email come verificata.
        if not email_verified:
            raise ValueError("Email Yourang non verificata: account già esistente")
        return user
    first, last = _split_name(name)
    # password=None → set_unusable_password: l'accesso avviene solo via Yourang.
    return User.objects.create_user(email=email, password=None, first_name=first, last_name=last)


def _membership_for(salon: Salon, user: User) -> Membership | None:
    return (
        Membership.objects.select_related("user", "salon", "role")
        .filter(salon=salon, user=user)
        .first()
    )


@transaction.atomic
def _provision_salon(user: User, display_name: str) -> Salon:
    salon = Salon.objects.create(name=display_name, slug=_unique_salon_slug(display_name))
    SalonSettings.objects.get_or_create(salon=salon)
    Location.objects.create(salon=salon, name=display_name, is_default=True)
    Membership.objects.create(user=user, salon=salon, is_owner=True)
    return salon


def _session_payload(membership: Membership, tokens: dict) -> dict:
    salon, user = membership.salon, membership.user
    return {
        "user": {"id": user.id, "email": user.email, "name": user.get_full_name() or user.email},
        "salon": {"id": salon.id, "name": salon.name, "slug": salon.slug},
        "scopes": sorted(membership.role.scopes or []) if membership.role else [],
        "is_owner": membership.is_owner,
        **tokens,
    }


def _resolve_salon(org: str, email: str, email_verified: bool) -> tuple[Salon | None, User | None]:
    # A. org già collegata a un salone → si entra lì, ma con l'identità di CHI
    # sta accedendo (non con quella del titolare): il collega che apre la stessa
    # org su Yourang deve diventare un membro, non impersonare il proprietario.
    if org:
        conn = YourangConnection.objects.select_related("salon").filter(yourang_org_id=org).first()
        if conn:
            return conn.salon, None
    # B. utente noto (email verificata) → adotta un salone senza connessione
    if email_verified:
        user = User.objects.filter(email__iexact=email).first()
        if user:
            for m in Membership.objects.filter(user=user).select_related("salon").order_by("id"):
                if not YourangConnection.objects.filter(salon=m.salon).exists():
                    return m.salon, user
            return None, user  # ha solo saloni già collegati → provisiona un nuovo salone
    return None, None


def login_with_link_code(code: str) -> dict:
    identity = yc.redeem_link_code(code)
    org = str(identity.get("org_id") or "")
    email = (identity.get("email") or "").strip()
    if not email:
        raise ValueError("Email non disponibile dall'identità Yourang")
    email_verified = bool(identity.get("email_verified"))
    name = (identity.get("name") or "").strip() or email.split("@")[0]

    salon, user = _resolve_salon(org, email, email_verified)

    if salon is None:
        user = user or _get_or_create_user(email, name, email_verified)
        salon = _provision_salon(user, name)
    elif user is None:
        user = _get_or_create_user(email, name, email_verified)

    membership = _membership_for(salon, user)
    if membership is None:
        membership = Membership.objects.create(
            user=user, salon=salon,
            is_owner=not Membership.objects.filter(salon=salon).exists(),
        )

    # Connessione Yourang del salone. Nessun token da salvare: li custodisce il
    # proxy. Nessuna registrazione webhook: il consenso provisiona l'endpoint
    # (client+org) verso /hooks/<slug>, e il proxy rifiuta comunque quella rotta.
    conn, _ = YourangConnection.objects.get_or_create(salon=salon)
    conn.yourang_org_id = org
    conn.connected_by = user
    conn.status = YourangConnection.Status.CONNECTED
    conn.last_error = ""
    conn.save()
    try:
        sync_clients(conn)
        sync_services(conn)
        conn.last_sync_at = timezone.now()
        conn.save(update_fields=["last_sync_at"])
    except Exception as exc:  # noqa: BLE001
        logger.exception("Yourang initial sync failed (login)")
        conn.last_error = str(exc)
        conn.save(update_fields=["last_error"])

    tokens = create_staff_tokens(user, salon)
    return _session_payload(_membership_for(salon, user), tokens)
