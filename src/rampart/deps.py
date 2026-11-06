"""FastAPI dependencies: database session, the current login session, role and CSRF checks."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from rampart.auth.service import AuthService
from rampart.models import AuthSession, User

COOKIE_NAME = "rampart_session"
CSRF_HEADER = "X-CSRF-Token"
STATE_CHANGING = {"POST", "PUT", "PATCH", "DELETE"}


def get_db(request: Request) -> Iterator[Session]:
    """One SQLAlchemy session per request. Handlers commit explicitly; leftovers are rolled back."""
    session: Session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def get_auth(request: Request, db: Session = Depends(get_db)) -> AuthService:
    return AuthService(db, session_ttl_hours=request.app.state.settings.session_ttl_hours)


def current_session(
    request: Request, auth: AuthService = Depends(get_auth)
) -> tuple[User, AuthSession]:
    pair = auth.resolve_session(request.cookies.get(COOKIE_NAME))
    if pair is None:
        raise HTTPException(status_code=401, detail="not signed in")
    auth.db.commit()  # resolve_session may have touched last_seen_at or removed an expired row
    return pair


def current_user(pair: tuple[User, AuthSession] = Depends(current_session)) -> User:
    return pair[0]


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="admin role required")
    return user


def csrf_protect(
    request: Request, pair: tuple[User, AuthSession] = Depends(current_session)
) -> None:
    if request.method.upper() not in STATE_CHANGING:
        return
    if not AuthService.csrf_matches(pair[1], request.headers.get(CSRF_HEADER)):
        raise HTTPException(status_code=403, detail="missing or invalid CSRF token")
