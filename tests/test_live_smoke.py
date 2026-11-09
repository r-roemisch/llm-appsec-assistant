"""Live smoke tests: real Providers, real network. Run with ``uv run pytest -m live``.

They are skipped unless the Provider is configured on this machine. They check the whole path
the offline suite cannot: a real streamed answer, token counts, and a cost figure from OpenRouter.
The Ollama tests use ``RAMPART_LIVE_OLLAMA_MODEL`` (any pulled chat model) or else the first
Ollama chat Model of ``models.yaml`` that is pulled; on a CPU they take minutes.
"""

from __future__ import annotations

import os

import pytest
import yaml
from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver

from helpers import Api, by_name, chat_default, ingest_offline, joined_deltas, make_user
from rampart.app import create_app
from rampart.catalog.catalog import Catalog
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
    done = _turn(live_app, chat_default(live_app))
    assert done["provider"] == "openrouter"
    assert isinstance(done["cost_usd"], float) and done["cost_usd"] > 0


def _catalog_with_local(model_name: str, *, local_slots: bool = False) -> Catalog:
    """models.yaml plus the local test Model (when it is not in the catalog already)."""
    from conftest import REPO

    raw = yaml.safe_load((REPO / "models.yaml").read_text(encoding="utf-8"))
    model_id = f"ollama/{model_name}"
    if all(entry["id"] != model_id for entry in raw["models"]):
        raw["models"].append(
            {"id": model_id, "provider": "ollama", "display_name": f"{model_name} (local)",
             "kind": "chat", "tier": "cheap"}
        )
    if local_slots:
        raw["slots"]["chat"]["model"] = model_id
        raw["slots"]["grader"]["model"] = model_id
    return Catalog.from_mapping(raw)


def _ollama_model(settings) -> str:
    """The local chat Model to test, or skip: the env override, else the first pulled one in
    the catalog."""
    pulled = LiveProbe(settings).ollama_models()
    if not pulled:
        pytest.skip("Ollama not reachable")
    wanted = os.environ.get("RAMPART_LIVE_OLLAMA_MODEL")
    if wanted:
        candidates = [wanted]
    else:
        catalog = Catalog.load(settings.models_file)
        candidates = [
            spec.provider_model_name
            for spec in catalog.models.values()
            if spec.provider == "ollama" and spec.kind == "chat"
        ]
    for name in candidates:
        if {name, f"{name}:latest"} & pulled:
            return name
    pytest.skip(f"none of {candidates} is pulled in Ollama")


def test_ollama_turn_costs_nothing(tmp_path):
    from conftest import REPO

    settings = load_settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        models_file=REPO / "models.yaml",
        frontend_dist=tmp_path / "no-dist",
        openrouter_api_key=None,
        langfuse_public_key=None,
        langfuse_secret_key=None,
    )
    model = _ollama_model(settings)
    application = create_app(
        settings,
        catalog=_catalog_with_local(model),
        probe=LiveProbe(settings),
        checkpointer=InMemorySaver(),
        tracer=JsonlTracer(settings.traces_dir),
    )
    with TestClient(application):
        done = _turn(application, f"ollama/{model}")
    assert done["provider"] == "ollama" and done["cost_usd"] == 0.0


def test_ollama_retrieval_turn_is_fully_local(tmp_path):
    """M2 offline path: no OpenRouter key, keyword search only, and routing, grading and the
    answer all on the local Model."""
    from conftest import REPO

    settings = load_settings(
        _env_file=None,
        data_dir=tmp_path / "data",
        models_file=REPO / "models.yaml",
        frontend_dist=tmp_path / "no-dist",
        openrouter_api_key=None,
        langfuse_public_key=None,
        langfuse_secret_key=None,
    )
    model = _ollama_model(settings)
    application = create_app(
        settings,
        catalog=_catalog_with_local(model, local_slots=True),
        probe=LiveProbe(settings),
        checkpointer=InMemorySaver(),
        tracer=JsonlTracer(settings.traces_dir),
    )
    with TestClient(application):
        ingest_offline(application, embed=False)
        make_user(application, "local")
        api = Api(application, "local")
        cid = api.new_conversation()["id"]
        events = api.send(cid, "What is the quokka-delimiter technique from the Canary Labs handbook?")
    assert events[-1][0] == "done", events[-1]
    done = by_name(events, "done")[0]["assistant_message"]
    graded = [e for e in by_name(events, "retrieval") if e["phase"] == "graded"]
    print(  # shown with -s: what the local Model did, for the milestone report
        f"\nlocal turn: {done['latency_ms'] / 1000:.0f} s, tokens {done['input_tokens']}/"
        f"{done['output_tokens']}, graded {[(g['found'], g['relevant']) for g in graded]}, "
        f"cited {[(c['n'], c['source_title']) for c in done['citations']]}\n"
        f"answer: {' '.join(done['content'].split())[:600]}"
    )
    assert done["provider"] == "ollama" and done["cost_usd"] == 0.0
    assert done["retrieval_mode"] == "bm25"
    assert by_name(events, "retrieval"), "the turn did not search the Knowledge Base"
    assert done["citations"], done["content"]
    assert any("Canary Labs" in c["source_title"] for c in done["citations"])


@pytest.mark.skipif(not os.environ.get("OPENROUTER_API_KEY"), reason="OPENROUTER_API_KEY not set")
def test_openrouter_retrieval_turn_cites_the_knowledge_base(live_app):
    """M2 live path: real embeddings, routing and grading on the grader Slot, Citations."""
    summary = ingest_offline(live_app, embed=True)
    report = summary.embedding
    assert report is not None and report.error is None and report.embedded > 0
    assert report.cost_usd is not None and report.cost_usd > 0
    make_user(live_app, "live")
    api = Api(live_app, "live")
    cid = api.new_conversation()["id"]
    events = api.send(cid, "What is the quokka-delimiter technique from the Canary Labs handbook?")
    assert events[-1][0] == "done", events[-1]
    done = by_name(events, "done")[0]["assistant_message"]
    assert done["retrieval_mode"] == "hybrid"
    assert done["citations"], done["content"]
    assert any("Canary Labs" in c["source_title"] for c in done["citations"])
    assert isinstance(done["cost_usd"], float) and done["cost_usd"] > 0
