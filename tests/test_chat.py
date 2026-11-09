from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from helpers import Api, by_name, chat_default, joined_deltas, make_user


def test_turn_streams_and_persists(app, scripted):
    make_user(app, "alice")
    alice = Api(app, "alice")
    conversation = alice.new_conversation()
    cid = conversation["id"]

    events = alice.send(cid, "Hello Rampart, what is prompt injection?")
    names = [name for name, _ in events]
    assert names[0] == "start" and names[-1] == "done" and "usage" in names
    assert all(n == "delta" for n in names[1 : names.index("usage")])

    start = by_name(events, "start")[0]
    assert start["user_message"]["content"] == "Hello Rampart, what is prompt injection?"
    assert start["model_id"] == chat_default(app)
    assert joined_deltas(events) == "The first reply."
    assert by_name(events, "usage")[0] == {"input_tokens": 12, "output_tokens": 7, "cost_usd": 0.001}

    done = by_name(events, "done")[0]["assistant_message"]
    assert done["id"] == start["assistant_message_id"]
    assert done["content"] == "The first reply."
    assert done["status"] == "complete" and done["error"] is None
    assert done["cost_usd"] == 0.001 and done["input_tokens"] == 12 and done["output_tokens"] == 7
    assert done["provider"] == "openrouter" and done["trace_id"]
    assert done["latency_ms"] is not None

    detail = alice.get(f"/api/conversations/{cid}").json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"]
    assert detail["messages"][1]["content"] == "The first reply."
    assert detail["conversation"]["title"] == "Hello Rampart, what is prompt injection?"
    assert detail["conversation"]["message_count"] == 2
    assert detail["conversation"]["total_cost_usd"] == 0.001
    listed = alice.get("/api/conversations").json()
    assert listed[0]["id"] == cid and listed[0]["total_cost_usd"] == 0.001


def test_history_reaches_the_model(app, scripted):
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    alice.send(cid, "first question")
    alice.send(cid, "second question")
    assert len(scripted.calls) == 2
    second = scripted.calls[1]
    assert [type(m) for m in second] == [SystemMessage, HumanMessage, AIMessage, HumanMessage]
    assert second[1].content == "first question"
    assert second[2].content == "The first reply."
    assert second[3].content == "second question"
    assert "Rampart" in second[0].content


def test_switch_model_mid_conversation(app, factory):
    """P6-A02: the next turn uses the newly selected Model and records it with its cost."""
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    alice.send(cid, "with the default model")
    assert factory.calls[-1][0].id == chat_default(app)

    patched = alice.patch(f"/api/conversations/{cid}", json={"model_id": "ollama/qwen3:8b"})
    assert patched.status_code == 200 and patched.json()["model_id"] == "ollama/qwen3:8b"

    events = alice.send(cid, "with the local model")
    assert factory.calls[-1][0].id == "ollama/qwen3:8b"
    done = by_name(events, "done")[0]["assistant_message"]
    assert done["model_id"] == "ollama/qwen3:8b" and done["provider"] == "ollama"
    assert done["cost_usd"] == 0.0  # Ollama turns cost nothing
    assert by_name(events, "usage")[0]["cost_usd"] == 0.0

    assert alice.patch(f"/api/conversations/{cid}", json={"model_id": "openai/text-embedding-3-small"}).status_code == 422
    assert alice.patch(f"/api/conversations/{cid}", json={"model_id": "nope/none"}).status_code == 422


def test_model_failure_is_reported_not_crashed(app, scripted):
    """Part of P6-A22: a Provider error ends the stream with an error event and a stored error."""
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    scripted.fail_with = "OpenRouter returned 429: rate limited"
    events = alice.send(cid, "hello")
    assert [name for name, _ in events] == ["start", "error"]
    error = by_name(events, "error")[0]
    assert "429" in error["message"]
    assert error["assistant_message"]["status"] == "error"
    assert "429" in error["assistant_message"]["error"]

    detail = alice.get(f"/api/conversations/{cid}").json()
    assistant = detail["messages"][1]
    assert assistant["status"] == "error" and assistant["cost_usd"] is None
    assert detail["conversation"]["total_cost_usd"] == 0.0

    scripted.fail_with = None  # the Conversation keeps working afterwards
    assert alice.send(cid, "again")[-1][0] == "done"


def test_message_validation(app):
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    assert alice.send_raw(cid, "").status_code == 422
    assert alice.send_raw(cid, "   \n ").status_code == 422
    assert alice.send_raw(cid, "x" * 32_001).status_code == 422
    assert alice.send_raw("does-not-exist", "hello").status_code == 404
    assert alice.post(f"/api/conversations/{cid}/messages", json={"content": "hi"}, csrf=False).status_code == 403


def test_rename_and_delete(app):
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    alice.send(cid, "hello")
    assert alice.patch(f"/api/conversations/{cid}", json={"title": "   "}).status_code == 422
    renamed = alice.patch(f"/api/conversations/{cid}", json={"title": "  Renamed  "})
    assert renamed.status_code == 200 and renamed.json()["title"] == "Renamed"
    assert alice.delete(f"/api/conversations/{cid}").status_code == 204
    assert alice.get(f"/api/conversations/{cid}").status_code == 404
    assert alice.get("/api/conversations").json() == []


def test_long_first_message_makes_a_short_title(app):
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    alice.send(cid, "word " * 40)
    title = alice.get(f"/api/conversations/{cid}").json()["conversation"]["title"]
    assert len(title) <= 60 and title.endswith("…")


def test_ollama_offline_gives_a_clear_error(app, scripted):
    """P6-A22: a local model whose Ollama is not running fails with a message a user can act on."""
    import httpx

    def refuse(_messages):
        raise httpx.ConnectError("All connection attempts failed")

    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation(model_id="ollama/qwen3:8b")["id"]
    scripted.responder = refuse
    error = by_name(alice.send(cid, "hello"), "error")[0]["message"]
    assert "could not be reached" in error and "Ollama is not answering at" in error
    assert "ollama serve" in error
