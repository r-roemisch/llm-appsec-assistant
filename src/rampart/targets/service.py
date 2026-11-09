"""Registering, listing and deleting a user's Targets.

A Target is a loopback application its owner may run the fixed injection test suite against.
Registration refuses any address that is not a loopback literal (127.0.0.0/8, ::1 or
``localhost``); the host is never resolved, so DNS cannot point a Target at another machine.
The same check runs again in the Gateway when a test is requested, so the database is the
authority and registration an admission step.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rampart.db import utcnow
from rampart.errors import Conflict, Invalid, NotFound
from rampart.gateway.constraints import is_loopback_url
from rampart.models import Target

INPUT_SURFACES = ("user_message", "document_slot")
PROFILES = ("secure", "vulnerable")
MAX_TARGETS_PER_USER = 20
MAX_NAME_CHARS = 100
MAX_URL_CHARS = 300


@dataclass(frozen=True)
class TargetView:
    id: str
    name: str
    base_url: str
    input_surface: str
    profile: str | None
    registered_at: datetime


def _view(target: Target) -> TargetView:
    return TargetView(
        id=target.id,
        name=target.name,
        base_url=target.base_url,
        input_surface=target.input_surface,
        profile=target.profile,
        registered_at=target.registered_at,
    )


class TargetService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list(self, user_id: int) -> list[TargetView]:
        rows = self.db.scalars(
            select(Target)
            .where(Target.owner_user_id == user_id)
            .order_by(Target.registered_at.desc())
        )
        return [_view(t) for t in rows]

    def get(self, user_id: int, target_id: str) -> TargetView:
        return _view(self._owned(user_id, target_id))

    def _owned(self, user_id: int, target_id: str) -> Target:
        target = self.db.get(Target, target_id)
        if target is None or target.owner_user_id != user_id:
            raise NotFound("target not found")
        return target

    def register(
        self,
        user_id: int,
        *,
        name: str,
        base_url: str,
        input_surface: str = "user_message",
        profile: str | None = None,
    ) -> TargetView:
        clean_name = " ".join(name.split())[:MAX_NAME_CHARS]
        if not clean_name:
            raise Invalid("a target needs a name")
        clean_url = base_url.strip()
        if len(clean_url) > MAX_URL_CHARS:
            raise Invalid(f"the URL must be at most {MAX_URL_CHARS} characters")
        if not is_loopback_url(clean_url):
            raise Invalid(
                "a Target URL must be a loopback address with only a port after it (for example "
                "http://127.0.0.1:8001 or http://[::1]:8001; no path, query or credentials); "
                "Rampart only tests applications on your own machine"
            )
        if input_surface not in INPUT_SURFACES:
            raise Invalid(f"input_surface must be one of {', '.join(INPUT_SURFACES)}")
        if profile is not None and profile not in PROFILES:
            raise Invalid(f"profile must be one of {', '.join(PROFILES)} or omitted")
        count = self.db.scalar(select(func.count(Target.id)).where(Target.owner_user_id == user_id))
        if (count or 0) >= MAX_TARGETS_PER_USER:
            raise Invalid(f"you already have {MAX_TARGETS_PER_USER} targets; delete one first")
        existing = self.db.scalar(
            select(Target).where(Target.owner_user_id == user_id, Target.base_url == clean_url)
        )
        if existing is not None:
            raise Conflict(f"you already registered {clean_url} as '{existing.name}'")
        target = Target(
            owner_user_id=user_id,
            name=clean_name,
            base_url=clean_url,
            input_surface=input_surface,
            profile=profile,
            registered_at=utcnow(),
        )
        self.db.add(target)
        self.db.flush()
        return _view(target)

    def update(
        self,
        user_id: int,
        target_id: str,
        *,
        name: str | None = None,
        profile: str | None = None,
        clear_profile: bool = False,
    ) -> TargetView:
        target = self._owned(user_id, target_id)
        if name is not None:
            clean = " ".join(name.split())[:MAX_NAME_CHARS]
            if not clean:
                raise Invalid("a target needs a name")
            target.name = clean
        if clear_profile:
            target.profile = None
        elif profile is not None:
            if profile not in PROFILES:
                raise Invalid(f"profile must be one of {', '.join(PROFILES)}")
            target.profile = profile
        self.db.flush()
        return _view(target)

    def delete(self, user_id: int, target_id: str) -> None:
        self.db.delete(self._owned(user_id, target_id))
        self.db.flush()
