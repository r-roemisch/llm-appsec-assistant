"""Login, logout, the current session, password changes, and admin account management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from rampart.auth.service import AuthService
from rampart.deps import (
    COOKIE_NAME,
    csrf_protect,
    current_session,
    get_auth,
    get_db,
    require_admin,
)
from rampart.models import AuthSession, User
from rampart.schemas import (
    LoginIn,
    PasswordChangeIn,
    PasswordResetIn,
    SessionOut,
    UserCreateIn,
    UserOut,
    user_out,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
admin_router = APIRouter(
    prefix="/api/admin/users",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(csrf_protect)],
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
    user = auth.authenticate(body.username, body.password)
    if user is None:
        auth.db.commit()
        raise HTTPException(status_code=401, detail="wrong username or password")
    token, row = auth.create_session(user)
    auth.db.commit()
    _set_cookie(request, response, token)
    return SessionOut(user=user_out(user), csrf_token=row.csrf_token)


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
    return SessionOut(user=user_out(user), csrf_token=row.csrf_token)


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
    return [user_out(u) for u in auth.list_users()]


@admin_router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreateIn, auth: AuthService = Depends(get_auth)) -> UserOut:
    user = auth.create_user(body.username, body.password, body.role)
    auth.db.commit()
    return user_out(user)


@admin_router.post("/{user_id}/password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: int, body: PasswordResetIn, auth: AuthService = Depends(get_auth)
) -> Response:
    auth.set_password(auth.get_user(user_id), body.new_password)
    auth.db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_admin),
    auth: AuthService = Depends(get_auth),
    db: Session = Depends(get_db),
) -> Response:
    if admin.id != user_id and db.get(User, user_id) is not None:
        request.app.state.knowledge.delete_user_vectors(user_id)  # uploads go with the account
    auth.delete_user(user_id, admin)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
