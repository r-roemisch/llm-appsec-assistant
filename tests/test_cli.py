from pathlib import Path

from typer.testing import CliRunner

from rampart.cli import app

REPO = Path(__file__).resolve().parents[1]


def _env(tmp_path: Path) -> dict[str, str]:
    return {
        "RAMPART_DATA_DIR": str(tmp_path / "data"),
        "RAMPART_MODELS_FILE": str(REPO / "models.yaml"),
        "OPENROUTER_API_KEY": "",
        "LANGFUSE_PUBLIC_KEY": "",
        "LANGFUSE_SECRET_KEY": "",
    }


def test_init_creates_the_first_admin_once(tmp_path):
    runner = CliRunner()
    first = runner.invoke(app, ["init", "--admin-username", "boss", "--admin-password", "secret-123"], env=_env(tmp_path))
    assert first.exit_code == 0, first.output
    assert "admin 'boss' created" in first.output
    again = runner.invoke(app, ["init", "--admin-username", "other", "--admin-password", "secret-123"], env=_env(tmp_path))
    assert again.exit_code == 0 and "already exists" in again.output
    listed = runner.invoke(app, ["user", "list"], env=_env(tmp_path))
    assert "admin\tboss" in listed.output and "other" not in listed.output


def test_user_commands_and_demo(tmp_path):
    runner = CliRunner()
    env = _env(tmp_path)
    created = runner.invoke(app, ["user", "create", "carol", "--password", "carol-pass-1"], env=env)
    assert created.exit_code == 0 and "created user 'carol'" in created.output
    reset = runner.invoke(app, ["user", "reset-password", "carol", "--password", "carol-pass-2"], env=env)
    assert reset.exit_code == 0
    missing = runner.invoke(app, ["user", "reset-password", "nobody", "--password", "carol-pass-2"], env=env)
    assert missing.exit_code != 0

    demo = runner.invoke(app, ["demo", "--no-serve", "--admin-password", "adm-pass-1", "--demo-password", "demo-pass-1"], env=env)
    assert demo.exit_code == 0, demo.output
    assert "admin / adm-pass-1" in demo.output and "demo / demo-pass-1" in demo.output
    assert "OPENROUTER_API_KEY is not set" in demo.output
    listed = runner.invoke(app, ["user", "list"], env=env).output
    assert "admin\tadmin" in listed and "user\tdemo" in listed and "user\tcarol" in listed


def test_ingest_fixtures_offline_then_unchanged(tmp_path):
    runner = CliRunner()
    env = _env(tmp_path)
    first = runner.invoke(app, ["ingest", "--fixtures", "--no-embed"], env=env)
    assert first.exit_code == 0, first.output
    assert "new       app_docs Rampart user guide" in first.output
    assert "Fixture: Canary Labs handbook" in first.output
    assert "keyword-only" in first.output and "Done:" in first.output
    again = runner.invoke(app, ["ingest", "--fixtures"], env=env)
    assert again.exit_code == 0, again.output
    assert "new " not in again.output and "unchanged" in again.output
    assert "Embeddings skipped" in again.output  # no OpenRouter key in the test environment


def test_demo_registers_the_demo_target(tmp_path):
    runner = CliRunner()
    env = _env(tmp_path)
    demo = runner.invoke(
        app, ["demo", "--no-serve", "--admin-password", "adm-pass-1", "--demo-password", "demo-pass-1", "--target-port", "8771"],
        env=env,
    )
    assert demo.exit_code == 0, demo.output
    assert "Demo target (vulnerable) at http://127.0.0.1:8771" in demo.output

    import sqlite3

    rows = sqlite3.connect(tmp_path / "data" / "rampart.sqlite3").execute(
        "select base_url, input_surface, profile from targets"
    ).fetchall()
    assert rows == [("http://127.0.0.1:8771", "document_slot", "vulnerable")]


def test_demo_target_command_is_available():
    result = CliRunner().invoke(app, ["demo-target", "--help"])
    assert result.exit_code == 0
    assert "secure or vulnerable" in result.output


def test_traces_prune_deletes_only_old_trace_files(tmp_path):
    from datetime import UTC, datetime, timedelta

    traces = tmp_path / "data" / "traces"
    traces.mkdir(parents=True)
    today = datetime.now(UTC).date()
    old = traces / f"{(today - timedelta(days=40)).isoformat()}.jsonl"
    recent = traces / f"{(today - timedelta(days=3)).isoformat()}.jsonl"
    other = traces / "notes.txt"
    for path in (old, recent, other):
        path.write_text("{}\n")
    runner = CliRunner()
    dry = runner.invoke(app, ["traces", "prune", "--older-than", "30", "--dry-run"], env=_env(tmp_path))
    assert dry.exit_code == 0 and "Would delete 1 trace file(s)" in dry.output and old.exists()
    done = runner.invoke(app, ["traces", "prune", "--older-than", "30"], env=_env(tmp_path))
    assert done.exit_code == 0 and "Deleted 1 trace file(s)" in done.output
    assert not old.exists() and recent.exists() and other.exists()
    assert runner.invoke(app, ["traces", "prune", "--older-than", "0"], env=_env(tmp_path)).exit_code != 0


def test_the_server_prunes_traces_at_start_only_when_configured(tmp_path):
    from datetime import UTC, datetime, timedelta

    from fastapi.testclient import TestClient
    from langgraph.checkpoint.memory import InMemorySaver

    from rampart.app import create_app
    from rampart.catalog.providers import StaticProbe
    from rampart.config import load_settings

    traces = tmp_path / "data" / "traces"
    traces.mkdir(parents=True)
    old = traces / f"{(datetime.now(UTC).date() - timedelta(days=10)).isoformat()}.jsonl"
    old.write_text("{}\n")

    def start(**overrides):
        settings = load_settings(
            _env_file=None,
            data_dir=tmp_path / "data",
            models_file=REPO / "models.yaml",
            openrouter_api_key=None,
            langfuse_public_key=None,
            langfuse_secret_key=None,
            frontend_dist=tmp_path / "no-dist",
            plugins_catalog=tmp_path / "none.yaml",
            **overrides,
        )
        application = create_app(settings, probe=StaticProbe(openrouter=False, ollama=None), checkpointer=InMemorySaver())
        with TestClient(application):
            pass

    start()
    assert old.exists()  # unset: nothing is deleted
    start(trace_retention_days=7)
    assert not old.exists()
