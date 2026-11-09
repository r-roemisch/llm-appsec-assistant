"""The ``rampart`` command: init, serve, user management, ingest, and the one-command demo."""

from __future__ import annotations

import asyncio
import os
import secrets
import subprocess
import sys
from typing import Annotated

import typer
from sqlalchemy import select

from rampart.auth.service import AuthService
from rampart.catalog.catalog import Catalog
from rampart.catalog.providers import LiveProbe
from rampart.config import Settings, load_settings
from rampart.db import init_db, make_engine, make_session_factory, session_scope
from rampart.knowledge.embeddings import ProviderEmbedderFactory
from rampart.knowledge.ingest import IngestSummary, run_ingest
from rampart.knowledge.service import KnowledgeService
from rampart.knowledge.vectors import ChromaVectorStore
from rampart.plugins.catalog import load_catalog

app = typer.Typer(help="Rampart: an LLM application security assistant.", no_args_is_help=True)
user_app = typer.Typer(help="Manage accounts (there is no sign-up page).", no_args_is_help=True)
app.add_typer(user_app, name="user")
traces_app = typer.Typer(help="Local JSONL traces.", no_args_is_help=True)
app.add_typer(traces_app, name="traces")


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


def _knowledge(settings: Settings) -> KnowledgeService:
    return KnowledgeService(
        session_factory=_open(settings),
        catalog=Catalog.load(settings.models_file),
        probe=LiveProbe(settings),
        settings=settings,
        embedder_factory=ProviderEmbedderFactory(settings),
        vector_store_factory=lambda: ChromaVectorStore(settings.chroma_dir),
    )


def _run_ingest(settings: Settings, *, fixtures: bool, embed: bool) -> IngestSummary:
    return asyncio.run(
        run_ingest(_knowledge(settings), fixtures=fixtures, embed=embed, echo=typer.echo)
    )


@app.command()
def ingest(
    fixtures: Annotated[
        bool,
        typer.Option(
            "--fixtures",
            help="Offline: load the synthetic fixture Sources instead of fetching OWASP, "
            "MITRE ATLAS and NIST.",
        ),
    ] = False,
    embed: Annotated[
        bool,
        typer.Option(
            "--embed/--no-embed",
            help="Embed passages with the embedding Slot's Model (without: keyword search only).",
        ),
    ] = True,
) -> None:
    """Load the Knowledge Base: official Sources (or fixtures), Rampart's primers and guides.

    Fetches the OWASP Top 10 for LLM Applications 2025 and MITRE ATLAS (both pinned to a
    commit) and the NIST AI RMF publications from their official locations. Running it again
    updates changed Sources, leaves unchanged ones alone, and embeds missing passages.
    """
    settings = _settings()
    summary = _run_ingest(settings, fixtures=fixtures, embed=embed)
    typer.echo(f"Done: {len(summary.stored)} Sources stored under {settings.data_dir}")
    if summary.failures:
        typer.echo(f"{len(summary.failures)} source group(s) failed; run again to retry", err=True)
        raise typer.Exit(code=1)


@traces_app.command("prune")
def traces_prune(
    older_than: Annotated[
        int,
        typer.Option("--older-than", min=1, help="Delete trace files older than this many days."),
    ],
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="List the files without deleting them.")
    ] = False,
) -> None:
    """Delete local JSONL trace files older than a number of days (Langfuse keeps its own)."""
    from rampart.tracing.retention import prune_traces

    settings = _settings()
    files = prune_traces(settings.traces_dir, older_than, dry_run=dry_run)
    verb = "Would delete" if dry_run else "Deleted"
    for path in files:
        typer.echo(f"{verb} {path}")
    typer.echo(f"{verb} {len(files)} trace file(s) older than {older_than} days")


@app.command("eval")
def eval_command(
    suite: str = typer.Option("all", help="qa, tool, guard or all"),
    limit: int | None = typer.Option(None, min=1, help="Only the first N qa or tool cases."),
    yes: bool = typer.Option(False, "--yes", "-y", help="Start without asking (for CI)."),
    classifier: bool = typer.Option(
        False,
        "--classifier",
        help="Guard suite: let the grader Slot's model classifier judge every input too (cents).",
    ),
) -> None:
    """Run the evaluation: DeepEval on real turns, Guard metrics; shows the cost first."""
    from rampart.eval.service import SUITES, EvalService

    if suite not in (*SUITES, "all"):
        raise typer.BadParameter("suite must be qa, tool, guard or all")
    if classifier and suite != "guard":
        raise typer.BadParameter("--classifier goes with --suite guard")
    suites = SUITES if suite == "all" else (suite,)
    settings = _settings()
    service = EvalService.from_settings(settings)
    estimates = service.estimates(suites, limit, classifier=classifier)
    typer.echo("Estimate (OpenRouter list prices; the report records what each call cost):")
    for e in estimates:
        cost = "unknown" if e.cost_usd is None else f"${e.cost_usd:.4f}"
        judge = f", judge {e.judge_model}" if e.judge_model else ""
        typer.echo(
            f"  {e.suite:5} {e.cases:4} cases, {e.model_calls} Model calls, "
            f"{e.judge_calls} judge calls{judge}: {cost}"
        )
        for note in e.notes:
            typer.echo(f"        {note}")
    known = [e.cost_usd for e in estimates if e.cost_usd is not None]
    if len(known) < len(estimates):
        question = "Run (cost unknown)?"
    elif sum(known) == 0:
        question = "Run (free)?"
    else:
        question = f"Run for about ${sum(known):.4f}?"
    if not yes and not typer.confirm(question, default=False):
        raise typer.Exit(code=1)
    ids = service.create_runs(estimates, limit=limit, started_by=None, pid=os.getpid())
    failed = False
    for run_id in ids:
        try:
            row = service.execute(run_id, progress=typer.echo)
        except Exception as exc:
            failed = True
            typer.echo(f"failed: {type(exc).__name__}: {exc}", err=True)
            continue
        cost = "unknown" if row.cost_usd is None else f"${row.cost_usd:.4f}"
        typer.echo(f"{row.kind}: done, cost {cost}, report {row.report_path}")
    if failed:
        raise typer.Exit(code=1)


@app.command("demo-target")
def demo_target(
    profile: Annotated[str, typer.Option(help="secure or vulnerable")] = "vulnerable",
    host: Annotated[str, typer.Option()] = "127.0.0.1",
    port: Annotated[int, typer.Option()] = 8765,
) -> None:
    """Run the demo Target: a small loopback app the injection test suite can test.

    ``vulnerable`` follows an export instruction hidden in a document; ``secure`` refuses.
    It is deliberately a reference of what not to do; run it only on your own machine.
    """
    if profile not in ("secure", "vulnerable"):
        raise typer.BadParameter("profile must be 'secure' or 'vulnerable'")
    import uvicorn

    from rampart.demo_target import create_demo_target

    settings = _settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    sink = settings.data_dir / f"demo_target_{profile}_sink.txt"
    typer.echo(f"Rampart demo Target ({profile}) on http://{host}:{port}; sink {sink}")
    uvicorn.run(create_demo_target(profile, sink), host=host, port=port)


def _register_demo_target(settings: Settings, port: int) -> str | None:
    """Register (or refresh) the demo user's loopback Target and add it to their profile."""
    from rampart.models import User
    from rampart.profile.service import ProfileService
    from rampart.targets.service import TargetService

    base_url = f"http://127.0.0.1:{port}"
    with session_scope(_open(settings)) as db:
        demo_user = db.scalar(select(User).where(User.username == "demo"))
        if demo_user is None:
            return None
        service = TargetService(db)
        existing = next((t for t in service.list(demo_user.id) if t.base_url == base_url), None)
        target = existing or service.register(
            demo_user.id,
            name="Demo target",
            base_url=base_url,
            input_surface="document_slot",
            profile="vulnerable",
        )
        profile = ProfileService(db).get(demo_user.id)
        ProfileService(db).save(
            demo_user.id,
            profile.stack,
            profile.packages,
            list(dict.fromkeys([*profile.target_ids, target.id])),
        )
        return target.id


@app.command()
def demo(
    admin_password: Annotated[str | None, typer.Option()] = None,
    demo_password: Annotated[str | None, typer.Option()] = None,
    host: Annotated[str | None, typer.Option()] = None,
    port: Annotated[int | None, typer.Option()] = None,
    target_port: Annotated[int, typer.Option(help="Loopback port for the demo Target.")] = 8765,
    no_serve: Annotated[bool, typer.Option(help="Prepare accounts but do not start.")] = False,
) -> None:
    """Prepare an admin and a demo user, an offline Knowledge Base (Rampart's primers and guides
    plus synthetic fixtures) and the demo Target (vulnerable profile, registered to the demo
    user), then start the app and print the logins."""
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
    typer.echo("Preparing the Knowledge Base (offline fixtures, primers and guides) ...")
    summary = _run_ingest(settings, fixtures=True, embed=True)
    url = f"http://{host or settings.host}:{port or settings.port}"
    typer.echo("Rampart demo")
    typer.echo(f"  URL:    {url}")
    typer.echo(f"  admin:  admin / {admin_password}")
    typer.echo(f"  user:   demo / {demo_password}")
    typer.echo(
        f"  knowledge: {len(summary.stored)} Sources; `rampart ingest` adds OWASP, ATLAS, NIST"
    )
    target_id = _register_demo_target(settings, target_port)
    target_url = f"http://127.0.0.1:{target_port}"
    if target_id is not None:
        typer.echo(f"  target: Demo target (vulnerable) at {target_url}, registered to demo")
    plugins = load_catalog(settings.plugins_catalog_path, settings.plugins_dir).entries
    if plugins:
        typer.echo(
            f"  plugins: {', '.join(plugins)} in the catalog, disabled; "
            "enable and review them under Admin, Plugins"
        )
    if not settings.openrouter_configured:
        typer.echo("  note:   OPENROUTER_API_KEY is not set; only local Ollama models can answer")
    if no_serve:
        return
    target_process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "rampart.cli",
            "demo-target",
            "--profile",
            "vulnerable",
            "--port",
            str(target_port),
        ],
    )
    try:
        serve(host=host, port=port, reload=False)
    finally:
        target_process.terminate()
        try:
            target_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            target_process.kill()


if __name__ == "__main__":
    app()
