from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Salon(TimeStampedModel):
    class Lang(models.TextChoices):
        IT = "it"
        EN = "en"

    name = models.CharField(max_length=120)
    slug = models.SlugField(unique=True)
    default_lang = models.CharField(max_length=2, choices=Lang.choices, default=Lang.IT)
    currency = models.CharField(max_length=3, default="EUR")

    def __str__(self):
        return self.name


class Location(TimeStampedModel):
    salon = models.ForeignKey(Salon, on_delete=models.CASCADE, related_name="locations")
    name = models.CharField(max_length=120)
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    is_default = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.salon.name} · {self.name}"


class SalonSettings(TimeStampedModel):
    """Branding white-label + ottimizzazione agenda (Impostazioni)."""

    class AgendaFill(models.TextChoices):
        FREE = "free", "Libero"
        MAX_REVENUE = "max_revenue", "Massimo incasso"

    class SlotRecovery(models.TextChoices):
        NOTIFY = "notify", "Avvisa"
        EXECUTE = "execute", "Esegui"

    class SlotInterval(models.IntegerChoices):
        MIN_15 = 15, "15 minuti"
        MIN_20 = 20, "20 minuti"
        MIN_30 = 30, "30 minuti"

    salon = models.OneToOneField(Salon, on_delete=models.CASCADE, related_name="settings")
    logo = models.ImageField(upload_to="branding/", blank=True, null=True)
    brand_color = models.CharField(max_length=7, default="#6366F1")
    opening_hours = models.TextField(blank=True, default="")
    agenda_fill = models.CharField(
        max_length=20, choices=AgendaFill.choices, default=AgendaFill.FREE
    )
    slot_recovery = models.CharField(
        max_length=20, choices=SlotRecovery.choices, default=SlotRecovery.NOTIFY
    )
    # Granularità delle fasce orarie: griglia agenda interna + base disponibilità booking.
    slot_interval_min = models.PositiveSmallIntegerField(
        choices=SlotInterval.choices, default=SlotInterval.MIN_15
    )
    # Informativa privacy del SALONE: il titolare del trattamento dei dati delle
    # clienti è il salone, non la piattaforma. Mostrata nel form pubblico /<slug>/hook.
    privacy_policy_url = models.URLField(blank=True, default="")
    lastminute_discount_cap = models.PositiveSmallIntegerField(default=0)  # 0/10/20/30 %
    lastminute_monthly_budget = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    flexible_enabled = models.BooleanField(default=True)
    flexible_window_min = models.PositiveSmallIntegerField(default=30)
    flexible_reward_pct = models.PositiveSmallIntegerField(default=10)

    def __str__(self):
        return f"Impostazioni · {self.salon.name}"


class DepositRule(TimeStampedModel):
    """SE etichetta/affidabilità → richiedi acconto (% o €). Prima regola che matcha vince."""

    class AmountType(models.TextChoices):
        PERCENT = "pct", "%"
        FIXED = "fixed", "€"

    salon = models.ForeignKey(Salon, on_delete=models.CASCADE, related_name="deposit_rules")
    name = models.CharField(max_length=120)
    conditions = models.JSONField(default=dict, blank=True)  # formato common.conditions
    amount_type = models.CharField(max_length=5, choices=AmountType.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    priority = models.PositiveSmallIntegerField(default=0)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["priority", "id"]

    def __str__(self):
        return self.name


class ActivityLog(models.Model):
    """Registro attività: ogni azione rilevante scrive una riga (vedi core.services.log_activity)."""

    salon = models.ForeignKey(Salon, on_delete=models.CASCADE, related_name="activity_logs")
    location = models.ForeignKey(
        Location, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    actor_name = models.CharField(max_length=120, blank=True)
    type = models.CharField(max_length=60)  # es. appointment.created, stock.adjusted
    summary = models.CharField(max_length=255)
    payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["salon", "-created_at"])]

    def __str__(self):
        return f"[{self.type}] {self.summary}"


class OutboxEvent(models.Model):
    """Eventi di dominio destinati alla piattaforma Yourang (WhatsApp/automazioni).

    Finché le API Yourang non sono disponibili gli eventi restano accodati qui;
    il comando `flush_outbox` li consegnerà quando l'integrazione sarà attiva.
    """

    class Status(models.TextChoices):
        PENDING = "pending"
        SENT = "sent"
        FAILED = "failed"

    salon = models.ForeignKey(Salon, on_delete=models.CASCADE, related_name="outbox_events")
    event_type = models.CharField(max_length=60)  # es. appointment.created, client.otp
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    last_error = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [models.Index(fields=["status", "created_at"])]

    def __str__(self):
        return f"{self.event_type} ({self.status})"
