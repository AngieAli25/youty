"""Endpoint /api/auth — login staff, team & ruoli, inviti, login OTP clienti."""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from ninja import Router
from ninja.errors import HttpError

from apps.core.models import Salon
from apps.core.services import emit_event, log_activity
from common.auth import (
    client_auth,
    create_client_tokens,
    create_staff_tokens,
    decode_token,
    staff_auth,
)
from common.permissions import SCOPES, require_scope
from common.utils import salon_get

from .models import Invitation, Membership, Role, User
from .schemas import (
    PasswordChangeIn,
    ClientAuthOut,
    ClientMeIn,
    ClientMeOut,
    ClientRegisterIn,
    InvitationAcceptIn,
    InvitationIn,
    InvitationOut,
    MemberOut,
    MemberRoleIn,
    MeOut,
    OkOut,
    OTPRequestIn,
    OTPVerifyIn,
    RefreshIn,
    RoleIn,
    RoleOut,
    StaffAuthOut,
    StaffLoginIn,
)
from .services import issue_otp, verify_otp

router = Router(tags=["accounts"])


# ---- Helpers -----------------------------------------------------------------


def _user_out(user) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.get_full_name() or user.email,
    }


def _role_out(role) -> dict | None:
    if role is None:
        return None
    return {
        "id": role.id,
        "name": role.name,
        "scopes": role.scopes or [],
        "is_system": role.is_system,
    }


def _auth_payload(membership, tokens: dict | None = None) -> dict:
    salon = membership.salon
    out = {
        "user": _user_out(membership.user),
        "salon": {"id": salon.id, "name": salon.name, "slug": salon.slug},
        "scopes": sorted(membership.role.scopes or []) if membership.role else [],
        "is_owner": membership.is_owner,
    }
    if tokens:
        out.update(tokens)
    return out


def _first_membership(user) -> Membership | None:
    """v1 mono-salone: se l'utente ha più membership prende la prima."""
    return (
        Membership.objects.select_related("user", "salon", "role")
        .filter(user=user)
        .order_by("id")
        .first()
    )


def _salon_by_slug(slug: str) -> Salon:
    try:
        return Salon.objects.get(slug=slug)
    except Salon.DoesNotExist:
        raise HttpError(404, "Salone non trovato")


def _client_by_phone(salon, phone: str):
    from apps.clients.models import Client  # lazy: evita cicli in fase di load

    client = Client.objects.filter(salon=salon, phone=phone.strip(), is_active=True).first()
    if client is None:
        raise HttpError(404, "Numero non registrato")
    return client


def _client_profile(client) -> dict:
    return {
        "id": client.id,
        "first_name": client.first_name,
        "last_name": client.last_name,
        "phone": client.phone,
        "email": client.email or "",
        "lang": client.lang,
        "whatsapp_reminders": client.whatsapp_reminders,
    }


def _validate_scopes(scopes: list[str]) -> None:
    for scope in scopes:
        if scope not in SCOPES:
            raise HttpError(400, f"Scope non valido: {scope}")


# ---- Staff: login e sessione -------------------------------------------------


@router.post("/staff/login", response=StaffAuthOut)
def staff_login(request, data: StaffLoginIn):
    user = User.objects.filter(email__iexact=data.email.strip()).first()
    if user is None or not user.is_active or not user.check_password(data.password):
        raise HttpError(401, "Credenziali non valide")
    membership = _first_membership(user)
    if membership is None:
        raise HttpError(403, "Nessun salone associato a questo utente")
    tokens = create_staff_tokens(user, membership.salon)
    return _auth_payload(membership, tokens)


@router.post("/staff/refresh", response=StaffAuthOut)
def staff_refresh(request, data: RefreshIn):
    payload = decode_token(data.refresh)
    if not payload or payload.get("typ") != "staff_refresh":
        raise HttpError(401, "Token non valido")
    membership = (
        Membership.objects.select_related("user", "salon", "role")
        .filter(
            user_id=payload.get("sub"),
            salon_id=payload.get("salon"),
            user__is_active=True,
        )
        .first()
    )
    if membership is None:
        raise HttpError(401, "Token non valido")
    if payload.get("tv", 0) != (membership.user.token_version or 0):
        raise HttpError(401, "Sessione non più valida: la password è stata modificata")
    tokens = create_staff_tokens(membership.user, membership.salon)
    return _auth_payload(membership, tokens)


@router.get("/me", auth=staff_auth, response=MeOut)
def me(request):
    return _auth_payload(request.auth.membership)


@router.post("/staff/password", auth=staff_auth, response=StaffAuthOut)
def staff_change_password(request, data: PasswordChangeIn):
    """Cambio password volontario del membro staff.

    Incrementa `token_version`, quindi invalida TUTTE le sessioni esistenti
    dell'utente. È il punto centrale: i JWT sono stateless e il refresh vive 30
    giorni, perciò senza questo passaggio cambiare la password non caccerebbe
    fuori chi ha ancora la vecchia — cioè non servirebbe a niente nel caso che
    motiva la funzione.

    Al chiamante restituiamo token nuovi: ha appena invalidato anche i propri.
    """
    ctx = request.auth
    user = ctx.user
    if not user.check_password(data.current_password):
        raise HttpError(400, "La password attuale non è corretta")
    if data.new_password == data.current_password:
        raise HttpError(400, "La nuova password deve essere diversa da quella attuale")
    try:
        validate_password(data.new_password, user)
    except ValidationError as exc:
        raise HttpError(400, " ".join(exc.messages))

    user.set_password(data.new_password)
    user.token_version = (user.token_version or 0) + 1
    user.save(update_fields=["password", "token_version"])
    log_activity(
        ctx.salon, "user.password_changed", f"Password modificata: {user.email}", actor=user
    )
    return _auth_payload(ctx.membership, create_staff_tokens(user, ctx.salon))


# ---- Staff: membri del team ----------------------------------------------------


def _member_out(membership) -> dict:
    return {
        "id": membership.id,
        "user": _user_out(membership.user),
        "role": _role_out(membership.role),
        "is_owner": membership.is_owner,
    }


@router.get("/members", auth=staff_auth, response=list[MemberOut])
def list_members(request):
    ctx = request.auth
    require_scope(ctx, "team")
    memberships = (
        Membership.objects.filter(salon=ctx.salon)
        .select_related("user", "role")
        .order_by("id")
    )
    return [_member_out(m) for m in memberships]


@router.post("/members/{int:member_id}/role", auth=staff_auth, response=MemberOut)
def set_member_role(request, member_id: int, data: MemberRoleIn):
    ctx = request.auth
    require_scope(ctx, "team")
    membership = salon_get(Membership, ctx, member_id)
    role = salon_get(Role, ctx, data.role_id) if data.role_id is not None else None
    membership.role = role
    membership.save(update_fields=["role"])
    log_activity(
        ctx.salon,
        "team.role_assigned",
        f"Ruolo di {membership.user.get_full_name() or membership.user.email}: "
        f"{role.name if role else 'nessuno'}",
        actor=ctx.user,
        payload={"membership_id": membership.id, "role_id": role.id if role else None},
    )
    return _member_out(membership)


@router.delete("/members/{int:member_id}", auth=staff_auth, response=OkOut)
def remove_member(request, member_id: int):
    ctx = request.auth
    require_scope(ctx, "team")
    membership = salon_get(Membership, ctx, member_id)
    if membership.is_owner:
        raise HttpError(400, "Impossibile rimuovere il titolare")
    email = membership.user.email
    membership.delete()
    log_activity(
        ctx.salon,
        "team.member_removed",
        f"Membro rimosso dal team: {email}",
        actor=ctx.user,
        payload={"email": email},
    )
    return OkOut()


# ---- Staff: ruoli ---------------------------------------------------------------


@router.get("/roles", auth=staff_auth, response=list[RoleOut])
def list_roles(request):
    ctx = request.auth
    require_scope(ctx, "team")
    return Role.objects.filter(salon=ctx.salon).order_by("id")


@router.post("/roles", auth=staff_auth, response=RoleOut)
def create_role(request, data: RoleIn):
    ctx = request.auth
    require_scope(ctx, "team")
    _validate_scopes(data.scopes)
    if Role.objects.filter(salon=ctx.salon, name=data.name).exists():
        raise HttpError(400, "Esiste già un ruolo con questo nome")
    role = Role.objects.create(salon=ctx.salon, name=data.name, scopes=data.scopes)
    log_activity(
        ctx.salon,
        "team.role_created",
        f"Nuovo ruolo: {role.name}",
        actor=ctx.user,
        payload={"role_id": role.id, "scopes": role.scopes},
    )
    return role


@router.put("/roles/{int:role_id}", auth=staff_auth, response=RoleOut)
def update_role(request, role_id: int, data: RoleIn):
    ctx = request.auth
    require_scope(ctx, "team")
    _validate_scopes(data.scopes)
    role = salon_get(Role, ctx, role_id)
    if Role.objects.filter(salon=ctx.salon, name=data.name).exclude(id=role.id).exists():
        raise HttpError(400, "Esiste già un ruolo con questo nome")
    role.name = data.name
    role.scopes = data.scopes
    role.save(update_fields=["name", "scopes"])
    log_activity(
        ctx.salon,
        "team.role_updated",
        f"Ruolo aggiornato: {role.name}",
        actor=ctx.user,
        payload={"role_id": role.id, "scopes": role.scopes},
    )
    return role


@router.delete("/roles/{int:role_id}", auth=staff_auth, response=OkOut)
def delete_role(request, role_id: int):
    ctx = request.auth
    require_scope(ctx, "team")
    role = salon_get(Role, ctx, role_id)
    if role.is_system:
        raise HttpError(400, "I ruoli di sistema non sono eliminabili")
    name = role.name
    role.delete()
    log_activity(ctx.salon, "team.role_deleted", f"Ruolo eliminato: {name}", actor=ctx.user)
    return OkOut()


# ---- Staff: inviti ---------------------------------------------------------------


@router.get("/invitations", auth=staff_auth, response=list[InvitationOut])
def list_invitations(request):
    ctx = request.auth
    require_scope(ctx, "team")
    return Invitation.objects.filter(salon=ctx.salon).select_related("role")


@router.post("/invitations", auth=staff_auth, response=InvitationOut)
def create_invitation(request, data: InvitationIn):
    ctx = request.auth
    require_scope(ctx, "team")
    role = salon_get(Role, ctx, data.role_id)
    email = data.email.strip().lower()
    if Membership.objects.filter(salon=ctx.salon, user__email__iexact=email).exists():
        raise HttpError(400, "L'utente fa già parte del team")
    invitation = Invitation.objects.create(salon=ctx.salon, email=email, role=role)
    emit_event(
        ctx.salon,
        "team.invitation",
        {
            "invitation_id": invitation.id,
            "email": invitation.email,
            "role": role.name,
            "token": str(invitation.token),
            "expires_at": invitation.expires_at.isoformat(),
        },
    )
    log_activity(
        ctx.salon,
        "team.invitation_created",
        f"Invito inviato a {invitation.email} ({role.name})",
        actor=ctx.user,
        payload={"invitation_id": invitation.id, "role_id": role.id},
    )
    return invitation


@router.post("/invitations/accept", response=StaffAuthOut)
def accept_invitation(request, data: InvitationAcceptIn):
    try:
        invitation = Invitation.objects.select_related("salon", "role").get(token=data.token)
    except (Invitation.DoesNotExist, ValidationError, ValueError):
        raise HttpError(404, "Invito non trovato")
    if invitation.status != Invitation.Status.PENDING:
        raise HttpError(400, "Invito non più valido")
    if invitation.expires_at < timezone.now():
        invitation.status = Invitation.Status.EXPIRED
        invitation.save(update_fields=["status"])
        raise HttpError(400, "Invito scaduto")
    if User.objects.filter(email__iexact=invitation.email).exists():
        raise HttpError(400, "Esiste già un utente con questa email")

    with transaction.atomic():
        user = User.objects.create_user(
            email=invitation.email,
            password=data.password,
            first_name=data.first_name,
            last_name=data.last_name,
        )
        membership = Membership.objects.create(
            user=user, salon=invitation.salon, role=invitation.role
        )
        invitation.status = Invitation.Status.ACCEPTED
        invitation.save(update_fields=["status"])
        log_activity(
            invitation.salon,
            "team.invitation_accepted",
            f"{user.get_full_name() or user.email} è entrato nel team",
            actor=user,
            payload={"invitation_id": invitation.id},
        )
    tokens = create_staff_tokens(user, invitation.salon)
    return _auth_payload(membership, tokens)


# ---- Cliente (web app): registrazione e login OTP --------------------------------


@router.post("/client/register", response=OkOut)
def client_register(request, data: ClientRegisterIn):
    salon = _salon_by_slug(data.salon_slug)
    from apps.clients.models import Client  # lazy: evita cicli in fase di load

    phone = data.phone.strip()
    if not phone:
        raise HttpError(400, "Il numero di telefono è obbligatorio")
    if Client.objects.filter(salon=salon, phone=phone).exists():
        raise HttpError(400, "Numero di telefono già registrato")

    client = Client.objects.create(
        salon=salon,
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        phone=phone,
        email=(data.email or "").strip(),
        lang=data.lang if data.lang in ("it", "en") else "it",
    )
    emit_event(
        salon,
        "client.created",
        {
            "client_id": client.id,
            "name": f"{client.first_name} {client.last_name}".strip(),
            "phone": client.phone,
            "lang": client.lang,
        },
    )
    log_activity(
        salon,
        "client.created",
        f"Nuovo cliente dalla web app: {client.first_name} {client.last_name}",
        payload={"client_id": client.id},
    )
    issue_otp(client)
    return OkOut()


@router.post("/client/request-otp", response=OkOut)
def client_request_otp(request, data: OTPRequestIn):
    salon = _salon_by_slug(data.salon_slug)
    client = _client_by_phone(salon, data.phone)
    issue_otp(client)
    return OkOut()


@router.post("/client/verify-otp", response=ClientAuthOut)
def client_verify_otp(request, data: OTPVerifyIn):
    salon = _salon_by_slug(data.salon_slug)
    client = _client_by_phone(salon, data.phone)
    verify_otp(client, data.code.strip())
    tokens = create_client_tokens(client)
    return {
        "access": tokens["access"],
        "client": {"id": client.id, "first_name": client.first_name, "lang": client.lang},
    }


@router.get("/client/me", auth=client_auth, response=ClientMeOut)
def client_me(request):
    return _client_profile(request.auth.client)


@router.put("/client/me", auth=client_auth, response=ClientMeOut)
def client_update_me(request, data: ClientMeIn):
    client = request.auth.client
    updates = data.dict(exclude_unset=True)
    if "lang" in updates:
        if updates["lang"] not in ("it", "en"):
            raise HttpError(400, "Lingua non valida")
        client.lang = updates["lang"]
    if "email" in updates:
        client.email = (updates["email"] or "").strip()
    if "whatsapp_reminders" in updates:
        client.whatsapp_reminders = bool(updates["whatsapp_reminders"])
    client.save()
    return _client_profile(client)
