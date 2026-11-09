"""Login throttling: too many failed sign-ins for one username, or from one client address, within
a window, and further attempts are refused without checking the password until the oldest
failure leaves the window. Nothing needs an administrator to unlock; time does.

Failures are counted for usernames that do not exist as well, so a refusal says nothing about
whether an account exists."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from rampart.db import utcnow
from rampart.models import LoginFailure

log = logging.getLogger("rampart.auth")

MAX_KEY_CHARS = 64


@dataclass(frozen=True)
class ThrottlePolicy:
    window_minutes: int = 15
    max_per_user: int = 5
    max_per_client: int = 30

    @property
    def window(self) -> timedelta:
        return timedelta(minutes=self.window_minutes)


class LoginThrottle:
    def __init__(self, db: Session, policy: ThrottlePolicy) -> None:
        self.db = db
        self.policy = policy

    def retry_after(self, username: str, client: str, now: datetime | None = None) -> int | None:
        """Seconds until a sign-in may be tried again, or None when it may be tried now."""
        now = now or utcnow()
        since = now - self.policy.window
        waits: list[float] = []
        for column, key, limit in (
            (LoginFailure.username, username[:MAX_KEY_CHARS], self.policy.max_per_user),
            (LoginFailure.client, client[:MAX_KEY_CHARS], self.policy.max_per_client),
        ):
            times = list(
                self.db.scalars(
                    select(LoginFailure.created_at)
                    .where(column == key, LoginFailure.created_at > since)
                    .order_by(LoginFailure.created_at.desc())
                    .limit(limit)
                )
            )
            if len(times) >= limit:
                # Allowed again once the limit-th most recent failure leaves the window.
                waits.append((times[-1] + self.policy.window - now).total_seconds())
        if not waits:
            return None
        wait = max(1, math.ceil(max(waits)))
        log.warning("sign-in throttled for %ds (username %r, client %s)", wait, username, client)
        return wait

    def record_failure(self, username: str, client: str) -> None:
        now = utcnow()
        self.db.execute(
            delete(LoginFailure).where(LoginFailure.created_at <= now - self.policy.window)
        )
        self.db.add(
            LoginFailure(
                username=username[:MAX_KEY_CHARS], client=client[:MAX_KEY_CHARS], created_at=now
            )
        )
        self.db.flush()

    def clear_user(self, username: str) -> None:
        """After a successful sign-in or an administrator's password reset."""
        self.db.execute(
            delete(LoginFailure).where(LoginFailure.username == username[:MAX_KEY_CHARS])
        )
        self.db.flush()
