"""Login, logout, the current session, password changes, and admin account management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.auth.service import AuthService
from rampart.auth.throttle import LoginThrottle, ThrottlePolicy
from rampart.deps import (
    COOKIE_NAME,
    csrf_protect,
    current_session,
    get_auth,
    get_db,
    require_admin,
)
from rampart.models import AuthSession, Conversation, User
from rampart.schemas import (
    LoginIn,
    PasswordChangeIn,
    PasswordResetIn,
    SessionOut,
    UserCreateIn,
    UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(
    prefix="/api/admin/users",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(csrf_protect)],
)


WRONG_CREDENTIALS = "wrong username or password"


def client_address(request: Request) -> str:
    """The address the per-client limit counts. X-Forwarded-For is read only when the settings
    say a proxy sets it."""
    if request.app.state.settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:64]
    return (request.client.host if request.client else "unknown")[:64]


def _throttle(request: Request, auth: AuthService) -> LoginThrottle:
    settings = request.app.state.settings
    return LoginThrottle(
        auth.db,
        ThrottlePolicy(
            window_minutes=settings.login_window_minutes,
            max_per_user=settings.login_max_failures_per_user,
            max_per_client=settings.login_max_failures_per_client,
        ),
    )


def _set_cookie(request: Request, response: Response, token: str) -> None:
    settings = request.app.state.settings
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/login", response_model=SessionOut)
def login(
    body: LoginIn, request: Request, response: Response, auth: AuthService = Depends(get_auth)
) -> SessionOut:
    throttle = _throttle(request, auth)
    client = client_address(request)
    wait = throttle.retry_after(body.username, client)
    if wait is not None:
        # Refused before the password is checked, and not counted as another failure.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=WRONG_CREDENTIALS,
            headers={"Retry-After": str(wait)},
        )
    user = auth.authenticate(body.username, body.password)
    if user is None:
        throttle.record_failure(body.username, client)
        auth.db.commit()
        raise HTTPException(status_code=401, detail=WRONG_CREDENTIALS)
    throttle.clear_user(user.username)
    token, row = auth.create_session(user)
    auth.db.commit()
    _set_cookie(request, response, token)
    return SessionOut(user=UserOut.model_validate(user), csrf_token=row.csrf_token)


@router.post(
    "/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)]
)
def logout(request: Request, response: Response, auth: AuthService = Depends(get_auth)) -> Response:
    auth.revoke_session(request.cookies.get(COOKIE_NAME))
    auth.db.commit()
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


@router.get("/me", response_model=SessionOut)
def me(pair: tuple[User, AuthSession] = Depends(current_session)) -> SessionOut:
    user, row = pair
    return SessionOut(user=UserOut.model_validate(user), csrf_token=row.csrf_token)


@router.post(
    "/password", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(csrf_protect)]
)
def change_password(
    body: PasswordChangeIn,
    request: Request,
    response: Response,
    pair: tuple[User, AuthSession] = Depends(current_session),
    auth: AuthService = Depends(get_auth),
) -> Response:
    user, _ = pair
    auth.change_password(user, body.current_password, body.new_password)
    token, _row = auth.create_session(user)  # other sessions were revoked; keep this one signed in
    auth.db.commit()
    out = Response(status_code=status.HTTP_204_NO_CONTENT)
    _set_cookie(request, out, token)
    return out


# --- admin --------------------------------------------------------------------------


@admin_router.get("", response_model=list[UserOut])
def list_users(auth: AuthService = Depends(get_auth)) -> list[UserOut]:
    return [UserOut.model_validate(u) for u in auth.list_users()]


@admin_router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreateIn, auth: AuthService = Depends(get_auth)) -> UserOut:
    user = auth.create_user(body.username, body.password, body.role)
    auth.db.commit()
    return UserOut.model_validate(user)


@admin_router.post("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: int, body: PasswordResetIn, auth: AuthService = Depends(get_auth)
) -> Response:
    auth.set_password(auth.get_user(user_id), body.new_password)  # also ends throttling
    auth.db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_admin),
    auth: AuthService = Depends(get_auth),
    db: Session = Depends(get_db),
) -> Response:
    threads: list[str] = []
    if admin.id != user_id and db.get(User, user_id) is not None:
        request.app.state.knowledge.delete_user_vectors(user_id)  # uploads go with the account
        threads = list(db.scalars(select(Conversation.id).where(Conversation.user_id == user_id)))
    auth.delete_user(user_id, admin)
    db.commit()
    for conversation_id in threads:  # the LangGraph checkpoints live in their own database
        await request.app.state.chat.engine.delete_thread(conversation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
