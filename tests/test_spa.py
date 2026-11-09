"""The production interface is served by FastAPI with a client-route fallback and no path escape."""

from pathlib import Path

from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from conftest import REPO
from helpers import StaticProbe
from rampart.app import create_app
from rampart.config import load_settings
from rampart.tracing import JsonlTracer


def _app_with_dist(tmp_path: Path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id='root'></div>")
    (dist / "assets" / "app.js").write_text("console.log('ok')")
    (tmp_path / "secret.txt").write_text("not for the browser")
    settings = load_settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        models_file=REPO / "models.yaml",
        openrouter_api_key=None,
        langfuse_public_key=None,
        langfuse_secret_key=None,
        frontend_dist=dist,
    )
    return create_app(
        settings,
        probe=StaticProbe(),
        checkpointer=InMemorySaver(),
        tracer=JsonlTracer(settings.traces_dir),
    )


def test_spa_routes_assets_and_fallback(tmp_path):
    with TestClient(_app_with_dist(tmp_path)) as client:
        assert "id='root'" in client.get("/").text
        assert "id='root'" in client.get("/c/some-conversation").text
        assert "id='root'" in client.get("/admin").text
        asset = client.get("/assets/app.js")
        assert asset.status_code == 200 and "console.log" in asset.text
        assert client.get("/api/does-not-exist").status_code == 404
        assert client.get("/api").status_code == 404


def test_spa_route_never_leaves_the_dist_directory(tmp_path):
    with TestClient(_app_with_dist(tmp_path)) as client:
        for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt",
                     "/assets/%2e%2e/%2e%2e/secret.txt"):
            response = client.get(path)
            assert "not for the browser" not in response.text, path
            assert response.status_code in (200, 404), path


def test_missing_build_is_explained(tmp_path):
    settings = load_settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        models_file=REPO / "models.yaml",
        openrouter_api_key=None,
        langfuse_public_key=None,
        langfuse_secret_key=None,
        frontend_dist=tmp_path / "nowhere",
    )
    app = create_app(settings, probe=StaticProbe(), checkpointer=InMemorySaver(),
                     tracer=JsonlTracer(settings.traces_dir))
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 404 and "npm run build" in response.json()["detail"]
