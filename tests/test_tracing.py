import json

from helpers import Api, by_name, make_user


def test_jsonl_trace_is_written_with_the_message_trace_id(app, settings):
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    events = alice.send(cid, "trace me")
    trace_id = by_name(events, "done")[0]["assistant_message"]["trace_id"]

    files = list(settings.traces_dir.glob("*.jsonl"))
    assert len(files) == 1
    records = [json.loads(line) for line in files[0].read_text().splitlines()]
    turns = [r for r in records if r["type"] == "turn"]
    assert len(turns) == 1
    turn = turns[0]
    assert turn["trace_id"] == trace_id
    assert turn["conversation_id"] == cid and turn["user_id"] == alice.user["id"]
    assert turn["input"] == "trace me" and turn["output"] == "The first reply."
    assert turn["usage"]["cost_usd"] == 0.001 and turn["error"] is None
    assert {e["kind"] for e in turn["events"]} >= {"model_start", "model_end"}


def test_health_reports_tracing_backend_and_providers(app):
    from fastapi.testclient import TestClient

    body = TestClient(app).get("/api/health").json()
    assert body["status"] == "ok" and body["tracing"] == "jsonl"
    assert body["providers"] == {"openrouter": True, "ollama": True}


def test_langfuse_unreachable_still_writes_the_jsonl_trace(settings, factory, probe):
    """P6-A22: with Langfuse configured but not reachable, the turn completes and its trace is
    in the local JSONL log under the same trace id the message stores."""
    import json
    import time

    from fastapi.testclient import TestClient
    from langgraph.checkpoint.memory import InMemorySaver
    from pydantic import SecretStr

    from helpers import Api, by_name, make_user
    from rampart.app import create_app
    from rampart.tracing.tracer import MirroredTracer

    unreachable = settings.model_copy(
        update={
            "langfuse_public_key": "pk-lf-test",
            "langfuse_secret_key": SecretStr("sk-lf-test-not-a-real-key"),
            "langfuse_host": "http://127.0.0.1:9",  # the discard port: nothing answers
        }
    )
    app = create_app(unreachable, probe=probe, model_factory=factory, checkpointer=InMemorySaver())
    assert isinstance(app.state.tracer, MirroredTracer) and app.state.tracer.backend == "langfuse"
    with TestClient(app):
        make_user(app, "alice")
        alice = Api(app, "alice")
        done = by_name(alice.send(alice.new_conversation()["id"], "hello"), "done")[0]["assistant_message"]
    started = time.monotonic()
    app.state.tracer.flush()  # must not hang on an unreachable host
    assert time.monotonic() - started < 30
    lines = [json.loads(line) for path in unreachable.traces_dir.glob("*.jsonl") for line in path.read_text().splitlines()]
    turns = [line for line in lines if line["type"] == "turn"]
    assert [t["trace_id"] for t in turns] == [done["trace_id"]] and turns[0]["output"] == done["content"]
