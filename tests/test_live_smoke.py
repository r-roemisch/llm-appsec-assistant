"""Live smoke tests: real Providers, real network. Run with ``uv run pytest -m live``.

They are skipped unless the Provider is configured on this machine. They check the whole path
the offline suite cannot: a real streamed answer, token counts, and a cost figure from OpenRouter.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from helpers import Api, by_name, joined_deltas, make_user
from rampart.app import create_app
from rampart.catalog.providers import LiveProbe
from rampart.config import load_settings
from rampart.tracing import JsonlTracer

pytestmark = pytest.mark.live


@pytest.fixture
def live_app(tmp_path):
    from conftest import REPO

    settings = load_settings(
        data_dir=tmp_path / "data",
        models_file=REPO / "models.yaml",
        frontend_dist=tmp_path / "no-dist",
        langfuse_public_key=None,
        langfuse_secret_key=None,
    )
    application = create_app(
        settings,
        probe=LiveProbe(settings),
        checkpointer=InMemorySaver(),
        tracer=JsonlTracer(settings.traces_dir),
    )
    with TestClient(application):
        yield application


def _turn(app, model_id: str):
    make_user(app, "live")
    api = Api(app, "live")
    cid = api.new_conversation(model_id=model_id)["id"]
    events = api.send(cid, "In one sentence, what is indirect prompt injection?")
    assert events[0][0] == "start", events
    assert events[-1][0] == "done", events[-1]
    done = by_name(events, "done")[0]["assistant_message"]
    assert done["status"] == "complete" and len(joined_deltas(events)) > 10
    assert done["input_tokens"] and done["output_tokens"]
    return done


@pytest.mark.skipif(not os.environ.get("OPENROUTER_API_KEY"), reason="OPENROUTER_API_KEY not set")
def test_openrouter_turn_reports_cost(live_app):
    done = _turn(live_app, "anthropic/claude-haiku-5.5")
    assert done["provider"] == "openrouter"
    assert isinstance(done["cost_usd"], float) and done["cost_usd"] > 0


def test_ollama_turn_costs_nothing(live_app):
    probe: LiveProbe = live_app.state.probe
    pulled = probe.ollama_models()
    if not pulled or not ({"qwen3:8b", "qwen3:8b:latest"} & pulled):
        pytest.skip("Ollama not reachable or qwen3:8b not pulled")
    done = _turn(live_app, "ollama/qwen3:8b")
    assert done["provider"] == "ollama" and done["cost_usd"] == 0.0
