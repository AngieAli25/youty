"""Utenti staff (login email), ruoli/permessi per salone, inviti team, OTP clienti."""

import datetime as dt
import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone


class UserManager(BaseUserManager):
    """Manager per utenti con login via email (niente username)."""

    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("L'email è obbligatoria")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Il superuser deve avere is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Il superuser deve avere is_superuser=True")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """Utente staff della dashboard: l'email è la credenziale di accesso."""

    username = None
    email = models.EmailField("email", unique=True)

    # Incrementato a ogni cambio password: i JWT portano questo numero e quelli
    # con un valore diverso vengono rifiutati. Senza, cambiare la password non
    # butterebbe fuori nessuno — i token sono stateless e il refresh dura 30
    # giorni, quindi chi avesse la vecchia password resterebbe dentro un mese.
    token_version = models.PositiveIntegerField(default=0)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email


class Role(models.Model):
    """Ruolo con permessi per ambito (vedi common.permissions.SCOPES)."""

    salon = models.ForeignKey("core.Salon", on_delete=models.CASCADE, related_name="roles")
    name = models.CharField(max_length=80)
    scopes = models.JSONField(default=list, blank=True)  # lista di scope
    is_system = models.BooleanField(default=False)

    class Meta:
        unique_together = [("salon", "name")]
        ordering = ["id"]

    def __str__(self):
        return f"{self.name} · {self.salon}"


class Membership(models.Model):
    """Appartenenza di un utente staff a un salone (v1: mono-salone)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    salon = models.ForeignKey("core.Salon", on_delete=models.CASCADE, related_name="memberships")
    role = models.ForeignKey(
        Role, on_delete=models.SET_NULL, null=True, blank=True, related_name="memberships"
    )  # il titolare può non avere ruolo
    is_owner = models.BooleanField(default=False)

    class Meta:
        unique_together = [("user", "salon")]
        ordering = ["id"]

    def __str__(self):
        return f"{self.user} @ {self.salon}" + (" (titolare)" if self.is_owner else "")


def default_invitation_expiry():
    return timezone.now() + dt.timedelta(days=7)


class Invitation(models.Model):
    """Invito email a entrare nel team con un ruolo predefinito."""

    class Status(models.TextChoices):
        PENDING = "pending"
        ACCEPTED = "accepted"
        EXPIRED = "expired"

    salon = models.ForeignKey("core.Salon", on_delete=models.CASCADE, related_name="invitations")
    email = models.EmailField()
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="invitations")
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    expires_at = models.DateTimeField(default=default_invitation_expiry)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Invito {self.email} ({self.status})"


def default_otp_expiry():
    return timezone.now() + dt.timedelta(minutes=10)


class ClientOTP(models.Model):
    """Codice OTP (6 cifre) per il login della web app cliente, consegnato da Yourang."""

    client = models.ForeignKey("clients.Client", on_delete=models.CASCADE, related_name="otps")
    code = models.CharField(max_length=6)
    expires_at = models.DateTimeField(default=default_otp_expiry)
    used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["client", "used", "expires_at"])]

    def __str__(self):
        return f"OTP {self.client_id} ({'usato' if self.used else 'attivo'})"
