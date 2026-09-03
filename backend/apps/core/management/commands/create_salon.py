"""Onboarding di un salone reale: crea la fondazione minima e nient'altro.

    python manage.py create_salon \
        --name "Bellezza Mia" --slug bellezza-mia \
        --owner-email titolare@bellezzamia.it --owner-name "Anna Rossi" \
        --location "Milano" --address "Via Roma 1, Milano"

Crea i sei oggetti senza i quali il salone non è utilizzabile: Salon, Location
predefinita, SalonSettings, ruoli di sistema, utente titolare e Membership.
I ruoli non sono creabili a mano da admin senza ricopiare gli scope: è la ragione
principale per cui questo comando esiste.

Tutto il resto (branding, orari, operatrici, servizi) si fa dalla dashboard, che è
il posto giusto: sono cose che il salone cambia da solo.

Idempotente sullo slug: se il salone esiste il comando si ferma senza toccare nulla.
La password del titolare NON si passa da riga di comando (finirebbe nella cronologia
della shell): l'utente nasce senza password utilizzabile e la si imposta da
/admin/ oppure con `manage.py changepassword <email>`.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts.models import Membership, User
from apps.accounts.services import ensure_default_roles
from apps.core.models import Location, Salon, SalonSettings


class Command(BaseCommand):
    help = "Crea un salone con la configurazione minima per essere operativo"

    def add_arguments(self, parser):
        parser.add_argument("--name", required=True, help="Nome del salone")
        parser.add_argument("--slug", required=True, help="Slug: è l'URL dell'app cliente")
        parser.add_argument("--owner-email", required=True, help="Email di accesso del titolare")
        parser.add_argument("--owner-name", default="", help='Nome e cognome, es. "Anna Rossi"')
        parser.add_argument("--location", default="Sede principale", help="Nome della sede")
        parser.add_argument("--address", default="", help="Indirizzo della sede")
        parser.add_argument("--phone", default="", help="Telefono della sede")

    @transaction.atomic
    def handle(self, *args, **o):
        slug = o["slug"].strip().lower()
        if Salon.objects.filter(slug=slug).exists():
            raise CommandError(f"Esiste già un salone con slug '{slug}'.")

        salon = Salon.objects.create(name=o["name"], slug=slug)
        Location.objects.create(
            salon=salon,
            name=o["location"],
            address=o["address"],
            phone=o["phone"],
            is_default=True,
        )
        SalonSettings.objects.create(salon=salon)
        ensure_default_roles(salon)

        first, _, last = o["owner_name"].partition(" ")
        owner, created = User.objects.get_or_create(
            email=o["owner_email"],
            defaults={"first_name": first, "last_name": last},
        )
        if created:
            owner.set_unusable_password()
            owner.save(update_fields=["password"])

        Membership.objects.get_or_create(
            user=owner, salon=salon, defaults={"is_owner": True}
        )

        self.stdout.write(self.style.SUCCESS(f"Salone creato: {salon.name} ({salon.slug})"))
        self.stdout.write(f"  App cliente:  /{salon.slug}")
        self.stdout.write(f"  Titolare:     {owner.email}")
        if created:
            self.stdout.write(
                self.style.WARNING(
                    f"  Password non impostata → manage.py changepassword {owner.email}"
                )
            )
        else:
            self.stdout.write("  Utente già esistente: password invariata")
