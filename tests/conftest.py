from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from helpers import (
    FakeEmbedderFactory,
    GraderScript,
    RecordingFactory,
    StaticProbe,
    ingest_offline,
    inprocess_client_factory,
)
from rampart.app import create_app
from rampart.config import load_settings
from rampart.tracing import JsonlTracer
from scripted_model import ScriptedChatModel

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def settings(tmp_path: Path):
    return load_settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        models_file=REPO / "models.yaml",
        openrouter_api_key=None,
        langfuse_public_key=None,
        langfuse_secret_key=None,
        frontend_dist=tmp_path / "no-dist",
        plugins_catalog=tmp_path / "plugins-catalog.yaml",  # absent unless a test writes it
    )


@pytest.fixture
def scripted() -> ScriptedChatModel:
    return ScriptedChatModel(replies=["The first reply.", "The second reply."])


@pytest.fixture
def grader_script() -> GraderScript:
    return GraderScript()


@pytest.fixture
def grader(grader_script: GraderScript) -> ScriptedChatModel:
    return ScriptedChatModel(responder=grader_script, replies=["(unexpected grader prompt)"])


@pytest.fixture
def factory(scripted: ScriptedChatModel, grader: ScriptedChatModel) -> RecordingFactory:
    return RecordingFactory(scripted, grader=grader)


@pytest.fixture
def probe() -> StaticProbe:
    return StaticProbe(openrouter=True, ollama={"qwen3:8b"})


@pytest.fixture
def app(settings, factory, probe):
    application = create_app(
        settings,
        probe=probe,
        model_factory=factory,
        checkpointer=InMemorySaver(),
        tracer=JsonlTracer(settings.traces_dir),
        plugin_client_factory=inprocess_client_factory(),
    )
    application.state.osv.transport = httpx.MockTransport(lambda request: httpx.Response(503))
    with TestClient(application):  # runs the lifespan once for every client in the test
        yield application


@pytest.fixture
def kb_app(app):
    """The app with fixtures, primers and guides ingested; keyword search only (no embedder)."""
    ingest_offline(app)
    return app


@pytest.fixture
def embedder_factory() -> FakeEmbedderFactory:
    return FakeEmbedderFactory()


@pytest.fixture
def hybrid_app(settings, factory, probe, embedder_factory):
    """Like kb_app, with deterministic offline embeddings in a real Chroma store."""
    application = create_app(
        settings,
        probe=probe,
        model_factory=factory,
        checkpointer=InMemorySaver(),
        tracer=JsonlTracer(settings.traces_dir),
        embedder_factory=embedder_factory,
    )
    application.state.osv.transport = httpx.MockTransport(lambda request: httpx.Response(503))
    with TestClient(application):
        ingest_offline(application, embed=True)
        yield application
