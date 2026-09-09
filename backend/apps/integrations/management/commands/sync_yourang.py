"""Full sync runs automatically only until a business operation is skipped.

After a gap, newly received signed resource events still synchronize individually.
Explicit manual reconciliation: sync_yourang --salon <id> --allow-backfill.
Never put --allow-backfill in cron: it authorizes reconciliation of skipped data.
"""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.integrations.models import YourangConnection
from common.portal_access import PortalAccessDenied, background_allowed
from apps.integrations.access_policy import (
    AutomaticSyncPaused, automatic_sync_allowed, latest_sync_audit,
    record_sync_gap, resume_after_manual_sync,
)
from apps.integrations.sync import sync_clients, sync_services


class Command(BaseCommand):
    help = "Sincronizza Clienti e Servizi; dopo attività saltate richiede recupero manuale"

    def add_arguments(self, parser):
        parser.add_argument("--salon", type=int, default=None, help="ID salone singolo")
        parser.add_argument("--allow-backfill", action="store_true", help="Richiesta manuale esplicita di recupero dati saltati (richiede --salon; mai in cron)")

    def handle(self, *args, **options):
        manual = options["allow_backfill"]
        if manual and not options["salon"]:
            raise CommandError("--allow-backfill richiede --salon per limitare il recupero manuale")
        qs = YourangConnection.objects.all()
        if options["salon"]:
            qs = qs.filter(salon_id=options["salon"])

        for conn in qs.select_related("salon"):
            allowed = (background_allowed(conn.salon, "manual_sync") if manual
                       else automatic_sync_allowed(conn.salon, "scheduled_sync"))
            if not allowed:
                self.stdout.write(self.style.WARNING(f"[{conn.salon}] attività saltata: accesso o recupero automatico non disponibile"))
                continue
            audit = latest_sync_audit(conn.salon)
            try:
                clients = sync_clients(conn, allow_backfill=manual)
                services = sync_services(conn, allow_backfill=manual)
                conn.last_sync_at = timezone.now()
                conn.last_error = ""
                conn.save(update_fields=["last_sync_at", "last_error"])
                if manual and not (clients.errors or services.errors):
                    resume_after_manual_sync(conn.salon, audit.pk if audit else None)
                self.stdout.write(self.style.SUCCESS(
                    f"[{conn.salon}] clienti: +{clients.created} link {clients.linked} "
                    f"push {clients.pushed} · voci catalogo {services.items}"
                ))
                for err in (clients.errors + services.errors):
                    self.stdout.write(self.style.WARNING(f"  {err}"))
            except PortalAccessDenied as exc:
                record_sync_gap(conn.salon, "manual_sync" if manual else "scheduled_sync", exc.access["status"])
                self.stdout.write(self.style.WARNING(f"[{conn.salon}] attività interrotta: accesso scaduto"))
            except AutomaticSyncPaused:
                self.stdout.write(self.style.WARNING(f"[{conn.salon}] attività saltata: recupero manuale richiesto"))
            except Exception as exc:  # noqa: BLE001
                conn.last_error = str(exc)
                conn.status = YourangConnection.Status.ERROR
                conn.save(update_fields=["last_error", "status"])
                self.stdout.write(self.style.ERROR(f"[{conn.salon}] {exc}"))
