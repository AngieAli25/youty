"""Consegna gli eventi pendenti dell'outbox alla piattaforma Yourang.

STUB: le API Yourang non sono ancora disponibili. Quando lo saranno,
implementare qui la consegna HTTP (YOURANG_API_URL/YOURANG_API_KEY in settings)
e schedulare il comando via cron. Fino ad allora elenca solo i pendenti.
"""

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.core.models import OutboxEvent
from common.portal_access import background_allowed


class Command(BaseCommand):
    help = "Consegna gli eventi outbox a Yourang (stub finché le API non sono attive)"

    def handle(self, *args, **options):
        pending = OutboxEvent.objects.filter(status=OutboxEvent.Status.PENDING)
        for event in pending.exclude(event_type="client.otp").select_related("salon").iterator():
            if not background_allowed(event.salon, event.event_type):
                event.status = OutboxEvent.Status.FAILED
                event.last_error = "portal_access_blocked: skipped; do not replay"
                event.save(update_fields=["status", "last_error"])
        if not settings.YOURANG_API_URL:
            self.stdout.write(self.style.WARNING(
                f"YOURANG_API_URL non configurato — {pending.count()} eventi restano in coda."
            ))
            for event in pending[:20]:
                self.stdout.write(f"  [{event.created_at:%d/%m %H:%M}] {event.event_type}")
            return
        # TODO integrazione reale: POST per evento, retry con attempts/last_error,
        # status SENT + sent_at alla conferma.
        raise NotImplementedError("Consegna a Yourang non ancora implementata")
