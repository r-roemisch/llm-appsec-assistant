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
