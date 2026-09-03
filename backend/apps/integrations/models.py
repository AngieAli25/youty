"""Stato della connessione del salone a Yourang (una per salone).

I token NON stanno più qui: dal passaggio al proxy (connect.<brand>) il portale
non possiede alcuna credenziale Yourang. Resta l'org, che è ciò che serve per
instradare i webhook in ingresso e per dire al proxy per quale organizzazione
stiamo chiamando.
"""

from django.conf import settings
from django.db import models


class YourangConnection(models.Model):
    """Connessione OAuth del salone a Yourang. Una sola per salone."""

    class Status(models.TextChoices):
        CONNECTED = "connected", "Connesso"
        ERROR = "error", "Errore"
        DISCONNECTED = "disconnected", "Disconnesso"

    salon = models.OneToOneField(
        "core.Salon", on_delete=models.CASCADE, related_name="yourang_connection"
    )
    # Org Yourang (claim `org` stampato dalla piattaforma): chiave per instradare
    # i webhook e selettore passato al proxy in X-Yourang-Org.
    yourang_org_id = models.CharField(max_length=64, blank=True, db_index=True)
    # Catalogo Yourang in cui spingiamo servizi/pacchetti (uno per salone).
    catalogue_id = models.CharField(max_length=64, blank=True)
    connected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.CONNECTED
    )
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_error = models.TextField(blank=True)
    connected_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Yourang · {self.salon_id} ({self.status})"
