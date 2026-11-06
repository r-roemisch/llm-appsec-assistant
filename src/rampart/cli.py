"""The ``rampart`` command: init, serve, user management, and the one-command demo."""

from __future__ import annotations

import secrets
from typing import Annotated

import typer

from rampart.auth.service import AuthService
from rampart.config import Settings, load_settings
from rampart.db import init_db, make_engine, make_session_factory, session_scope

app = typer.Typer(help="Rampart: an LLM application security assistant.", no_args_is_help=True)
user_app = typer.Typer(help="Manage accounts (there is no sign-up page).", no_args_is_help=True)
app.add_typer(user_app, name="user")


def _settings() -> Settings:
    return load_settings()


def _open(settings: Settings):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = make_engine(settings.database_path)
    init_db(engine)
    return make_session_factory(engine)


@app.command()
def init(
    admin_username: Annotated[str, typer.Option(prompt=True)] = "admin",
    admin_password: Annotated[
        str, typer.Option(prompt=True, hide_input=True, confirmation_prompt=True)
    ] = "",
) -> None:
    """Create the database and the first admin account."""
    settings = _settings()
    factory = _open(settings)
    with session_scope(factory) as db:
        auth = AuthService(db)
        if auth.admin_count():
            typer.echo(f"database ready at {settings.database_path}; an admin already exists")
            return
        auth.create_user(admin_username, admin_password, "admin")
    typer.echo(f"database ready at {settings.database_path}; admin '{admin_username}' created")


@app.command()
def serve(
    host: Annotated[str | None, typer.Option()] = None,
    port: Annotated[int | None, typer.Option()] = None,
    reload: Annotated[bool, typer.Option(help="Restart on code changes.")] = False,
) -> None:
    """Start the API and the built frontend."""
    import uvicorn

    settings = _settings()
    uvicorn.run(
        "rampart.app:create_app",
        factory=True,
        host=host or settings.host,
        port=port or settings.port,
        reload=reload,
    )


@user_app.command("create")
def user_create(
    username: str,
    password: Annotated[str, typer.Option(prompt=True, hide_input=True, confirmation_prompt=True)],
    role: Annotated[str, typer.Option()] = "user",
) -> None:
    """Create an account."""
    with session_scope(_open(_settings())) as db:
        user = AuthService(db).create_user(username, password, role)
        typer.echo(f"created {user.role} '{user.username}' (id {user.id})")


@user_app.command("reset-password")
def user_reset_password(
    username: str,
    password: Annotated[str, typer.Option(prompt=True, hide_input=True, confirmation_prompt=True)],
) -> None:
    """Set a new password and sign the account out everywhere."""
    with session_scope(_open(_settings())) as db:
        auth = AuthService(db)
        user = auth.get_user_by_name(username)
        if user is None:
            raise typer.BadParameter(f"no user named '{username}'")
        auth.set_password(user, password)
        typer.echo(f"password updated for '{username}'")


@user_app.command("list")
def user_list() -> None:
    """List accounts."""
    with session_scope(_open(_settings())) as db:
        for user in AuthService(db).list_users():
            typer.echo(f"{user.id}\t{user.role}\t{user.username}")


@app.command()
def demo(
    admin_password: Annotated[str | None, typer.Option()] = None,
    demo_password: Annotated[str | None, typer.Option()] = None,
    host: Annotated[str | None, typer.Option()] = None,
    port: Annotated[int | None, typer.Option()] = None,
    no_serve: Annotated[bool, typer.Option(help="Prepare accounts but do not start.")] = False,
) -> None:
    """Prepare an admin and a demo user, then start the app and print the logins.

    Later milestones extend this command with fixture Sources and the demo Target.
    """
    settings = _settings()
    factory = _open(settings)
    admin_password = admin_password or secrets.token_urlsafe(9)
    demo_password = demo_password or secrets.token_urlsafe(9)
    with session_scope(factory) as db:
        auth = AuthService(db)
        for username, password, role in (
            ("admin", admin_password, "admin"),
            ("demo", demo_password, "user"),
        ):
            user = auth.get_user_by_name(username)
            if user is None:
                auth.create_user(username, password, role)
            else:
                auth.set_password(user, password)
    url = f"http://{host or settings.host}:{port or settings.port}"
    typer.echo("Rampart demo")
    typer.echo(f"  URL:    {url}")
    typer.echo(f"  admin:  admin / {admin_password}")
    typer.echo(f"  user:   demo / {demo_password}")
    if not settings.openrouter_configured:
        typer.echo("  note:   OPENROUTER_API_KEY is not set; only local Ollama models can answer")
    if no_serve:
        return
    serve(host=host, port=port, reload=False)


if __name__ == "__main__":
    app()
