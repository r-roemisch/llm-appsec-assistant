"""Accounts, passwords and login sessions. Role checks for admin-only operations live here too."""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from rampart.db import utcnow
from rampart.errors import BadRequest, Conflict, Forbidden, Invalid, NotFound
from rampart.models import AuthSession, User

ROLES = ("user", "admin")
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,64}$")
PASSWORD_MIN, PASSWORD_MAX = 8, 256

_hasher = PasswordHasher()
# A fixed hash verified for unknown usernames so that login timing does not reveal
# whether an account exists.
_DUMMY_HASH = _hasher.hash("rampart-dummy-password")


def validate_username(username: str) -> str:
    if not USERNAME_RE.match(username):
        raise Invalid("username must be 3 to 64 characters: letters, digits, '.', '_' or '-'")
    return username


def validate_password(password: str) -> str:
    if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
        raise Invalid(f"password must be {PASSWORD_MIN} to {PASSWORD_MAX} characters")
    return password


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class AuthService:
    def __init__(self, db: Session, session_ttl_hours: int = 24 * 7) -> None:
        self.db = db
        self.session_ttl = timedelta(hours=session_ttl_hours)

    # --- accounts -----------------------------------------------------------------

    def create_user(self, username: str, password: str, role: str = "user") -> User:
        validate_username(username)
        validate_password(password)
        if role not in ROLES:
            raise Invalid(f"role must be one of {', '.join(ROLES)}")
        user = User(username=username, password_hash=_hasher.hash(password), role=role)
        self.db.add(user)
        try:
            self.db.flush()
        except IntegrityError as exc:
            self.db.rollback()
            raise Conflict(f"username '{username}' already exists") from exc
        return user

    def get_user(self, user_id: int) -> User:
        user = self.db.get(User, user_id)
        if user is None:
            raise NotFound("user not found")
        return user

    def get_user_by_name(self, username: str) -> User | None:
        return self.db.scalar(select(User).where(User.username == username))

    def list_users(self) -> list[User]:
        return list(self.db.scalars(select(User).order_by(User.id)))

    def delete_user(self, user_id: int, acting_user: User) -> None:
        if acting_user.role != "admin":
            raise Forbidden("admin role required")
        if acting_user.id == user_id:
            raise BadRequest("you cannot delete your own account")
        user = self.get_user(user_id)
        self.db.delete(user)
        self.db.flush()

    def admin_count(self) -> int:
        return len([u for u in self.list_users() if u.role == "admin"])

    # --- passwords ----------------------------------------------------------------

    def authenticate(self, username: str, password: str) -> User | None:
        user = self.get_user_by_name(username)
        stored = user.password_hash if user is not None else _DUMMY_HASH
        try:
            _hasher.verify(stored, password)
        except VerifyMismatchError:
            return None
        except Exception:
            return None
        if user is None:
            return None
        if _hasher.check_needs_rehash(user.password_hash):
            user.password_hash = _hasher.hash(password)
            self.db.flush()
        return user

    def change_password(self, user: User, current_password: str, new_password: str) -> None:
        try:
            _hasher.verify(user.password_hash, current_password)
        except VerifyMismatchError as exc:
            raise BadRequest("current password is wrong") from exc
        self.set_password(user, new_password)

    def set_password(self, user: User, new_password: str) -> None:
        validate_password(new_password)
        user.password_hash = _hasher.hash(new_password)
        self.revoke_all_sessions(user)
        self.db.flush()

    # --- sessions -----------------------------------------------------------------

    def create_session(self, user: User) -> tuple[str, AuthSession]:
        raw = secrets.token_urlsafe(32)
        now = utcnow()
        row = AuthSession(
            id=hash_token(raw),
            user_id=user.id,
            csrf_token=secrets.token_urlsafe(32),
            created_at=now,
            expires_at=now + self.session_ttl,
            last_seen_at=now,
        )
        self.db.add(row)
        self.db.flush()
        return raw, row

    def resolve_session(self, raw: str | None) -> tuple[User, AuthSession] | None:
        if not raw:
            return None
        row = self.db.get(AuthSession, hash_token(raw))
        if row is None:
            return None
        now = utcnow()
        if row.expires_at <= now:
            self.db.delete(row)
            self.db.flush()
            return None
        if (now - row.last_seen_at) > timedelta(minutes=5):
            row.last_seen_at = now
            self.db.flush()
        user = self.db.get(User, row.user_id)
        if user is None:
            return None
        return user, row

    def revoke_session(self, raw: str | None) -> None:
        if not raw:
            return
        row = self.db.get(AuthSession, hash_token(raw))
        if row is not None:
            self.db.delete(row)
            self.db.flush()

    def revoke_all_sessions(self, user: User) -> None:
        for row in self.db.scalars(select(AuthSession).where(AuthSession.user_id == user.id)):
            self.db.delete(row)
        self.db.flush()

    @staticmethod
    def csrf_matches(row: AuthSession, presented: str | None) -> bool:
        if not presented:
            return False
        return secrets.compare_digest(row.csrf_token, presented)
