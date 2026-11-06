from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from helpers import RecordingFactory
from rampart.app import create_app
from rampart.catalog.providers import StaticProbe
from rampart.chat.scripted import ScriptedChatModel
from rampart.config import load_settings
from rampart.tracing import JsonlTracer

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
    )


@pytest.fixture
def scripted() -> ScriptedChatModel:
    return ScriptedChatModel(replies=["The first reply.", "The second reply."])


@pytest.fixture
def factory(scripted: ScriptedChatModel) -> RecordingFactory:
    return RecordingFactory(scripted)


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
    )
    with TestClient(application):  # runs the lifespan once for every client in the test
        yield application
