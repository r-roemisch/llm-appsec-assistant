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
