from datetime import datetime
from typing import Optional
from uuid import UUID

from ninja import Schema


class OkOut(Schema):
    ok: bool = True


# ---- Staff auth --------------------------------------------------------------


class StaffLoginIn(Schema):
    email: str
    password: str


class PasswordChangeIn(Schema):
    current_password: str
    new_password: str


class RefreshIn(Schema):
    refresh: str


class UserBriefOut(Schema):
    id: int
    email: str
    name: str


class SalonBriefOut(Schema):
    id: int
    name: str
    slug: str


class MeOut(Schema):
    user: UserBriefOut
    salon: SalonBriefOut
    scopes: list[str]
    is_owner: bool


class StaffAuthOut(MeOut):
    access: str
    refresh: str


# ---- Ruoli e membri ----------------------------------------------------------


class RoleIn(Schema):
    name: str
    scopes: list[str] = []


class RoleOut(Schema):
    id: int
    name: str
    scopes: list[str]
    is_system: bool


class MemberOut(Schema):
    id: int  # id della membership
    user: UserBriefOut
    role: Optional[RoleOut] = None
    is_owner: bool


class MemberRoleIn(Schema):
    role_id: Optional[int] = None  # None = rimuove il ruolo


# ---- Inviti ------------------------------------------------------------------


class InvitationIn(Schema):
    email: str
    role_id: int


class InvitationOut(Schema):
    id: int
    email: str
    role: RoleOut
    token: UUID
    status: str
    expires_at: datetime
    created_at: datetime


class InvitationAcceptIn(Schema):
    token: str
    password: str
    first_name: str
    last_name: str


# ---- Cliente (web app) -------------------------------------------------------


class ClientRegisterIn(Schema):
    salon_slug: str
    first_name: str
    last_name: str
    phone: str
    email: str = ""
    lang: str = "it"


class OTPRequestIn(Schema):
    salon_slug: str
    phone: str


class OTPVerifyIn(Schema):
    salon_slug: str
    phone: str
    code: str


class ClientBriefOut(Schema):
    id: int
    first_name: str
    lang: str


class ClientAuthOut(Schema):
    access: str
    client: ClientBriefOut


class ClientMeOut(Schema):
    id: int
    first_name: str
    last_name: str
    phone: str
    email: str
    lang: str
    whatsapp_reminders: bool


class ClientMeIn(Schema):
    lang: Optional[str] = None
    email: Optional[str] = None
    whatsapp_reminders: Optional[bool] = None
