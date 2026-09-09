"""Integrazione Stripe: carte salvate, acconti, addebito no-show.

Stripe è opzionale: senza STRIPE_SECRET_KEY ogni funzione risponde
HttpError(503, "Stripe non configurato"). Gli importi sono in centesimi.
"""

import json
from decimal import Decimal

from django.conf import settings
from ninja.errors import HttpError
from common.portal_access import require_portal_access


def _client():
    """Modulo stripe configurato, o 503 se la chiave segreta non è impostata."""
    if not settings.STRIPE_SECRET_KEY:
        raise HttpError(503, "Stripe non configurato")
    import stripe  # lazy: dipendenza opzionale a runtime

    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


def _to_cents(amount) -> int:
    return int((Decimal(str(amount)) * 100).quantize(Decimal("1")))


def _currency(salon) -> str:
    return (getattr(salon, "currency", "") or "EUR").lower()


def ensure_customer(client) -> str:
    """Ritorna lo stripe_customer_id del cliente, creandolo se assente."""
    require_portal_access(client.salon)
    stripe = _client()
    if client.stripe_customer_id:
        return client.stripe_customer_id
    customer = stripe.Customer.create(
        name=f"{client.first_name} {client.last_name}".strip(),
        phone=client.phone or None,
        email=client.email or None,
        metadata={"client_id": client.id, "salon_id": client.salon_id},
    )
    client.stripe_customer_id = customer["id"]
    client.save(update_fields=["stripe_customer_id"])
    return client.stripe_customer_id


def create_setup_intent(client):
    """SetupIntent off-session per salvare la carta del cliente dalla web app."""
    require_portal_access(client.salon)
    stripe = _client()
    customer_id = ensure_customer(client)
    return stripe.SetupIntent.create(
        customer=customer_id,
        usage="off_session",
        metadata={"client_id": client.id},
    )


def create_deposit_intent(appointment):
    """PaymentIntent per l'acconto di un appuntamento (metadata.appointment_id)."""
    require_portal_access(appointment.salon)
    stripe = _client()
    amount = Decimal(str(appointment.deposit_amount or 0))
    if amount <= 0:
        raise HttpError(400, "Nessun acconto richiesto per questo appuntamento")
    customer_id = ensure_customer(appointment.client)
    return stripe.PaymentIntent.create(
        amount=_to_cents(amount),
        currency=_currency(appointment.salon),
        customer=customer_id,
        metadata={"appointment_id": appointment.id, "kind": "deposit"},
    )


def charge_full_amount(appointment):
    """Addebito off-session dell'intero importo (no-show) sulla carta salvata."""
    require_portal_access(appointment.salon)
    stripe = _client()
    client = appointment.client
    if not (client.consents or {}).get("card_charge"):
        raise HttpError(400, "Il cliente non ha autorizzato l'addebito sulla carta")
    if not client.stripe_payment_method_id:
        raise HttpError(400, "Nessuna carta salvata per il cliente")
    amount = Decimal(str(appointment.total_price or 0))
    if amount <= 0:
        raise HttpError(400, "Nessun importo da addebitare")
    customer_id = ensure_customer(client)
    try:
        return stripe.PaymentIntent.create(
            amount=_to_cents(amount),
            currency=_currency(appointment.salon),
            customer=customer_id,
            payment_method=client.stripe_payment_method_id,
            off_session=True,
            confirm=True,
            metadata={"appointment_id": appointment.id, "kind": "no_show"},
        )
    except stripe.StripeError as exc:
        raise HttpError(400, f"Addebito non riuscito: {getattr(exc, 'user_message', None) or exc}")


def verify_webhook(payload: bytes, sig_header: str) -> dict:
    """Evento webhook verificato (firma se STRIPE_WEBHOOK_SECRET, altrimenti parse diretto)."""
    if settings.STRIPE_WEBHOOK_SECRET:
        import stripe  # lazy

        try:
            return stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
            )
        except (ValueError, stripe.SignatureVerificationError):
            raise HttpError(400, "Firma webhook non valida")
    try:
        return json.loads(payload.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HttpError(400, "Payload webhook non valido")
