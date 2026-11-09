"""Short-term memory (spec section 9): past a configured size, older turns are summarised for the
model while the last turns stay word for word; the stored history the user sees is unchanged."""

import httpx
import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy import select

from helpers import Api, inprocess_client_factory, make_user
from rampart.app import create_app
from rampart.db import session_scope
from rampart.models import ModelCall
from rampart.tracing import JsonlTracer

LONG = "This is a deliberately long answer about prompt injection defences. " * 3


@pytest.fixture
def small_memory_app(settings, factory, probe):
    """The app with a tiny history size, so a few turns trigger a summary."""
    tight = settings.model_copy(update={"history_summary_tokens": 60, "history_keep_turns": 2})
    application = create_app(
        tight,
        probe=probe,
        model_factory=factory,
        checkpointer=InMemorySaver(),
        tracer=JsonlTracer(tight.traces_dir),
        plugin_client_factory=inprocess_client_factory(),
    )
    application.state.osv.transport = httpx.MockTransport(lambda request: httpx.Response(503))
    with TestClient(application):
        yield application


def humans(call) -> list[str]:
    return [m.content for m in call if isinstance(m, HumanMessage)]


def test_older_turns_are_summarised_and_the_last_turns_kept(small_memory_app, scripted, grader_script):
    make_user(small_memory_app, "alice")
    alice = Api(small_memory_app, "alice")
    scripted.replies = [LONG]
    cid = alice.new_conversation()["id"]
    seen: list[list[str]] = []  # the user messages the chat Model received, turn by turn
    for n in range(1, 5):
        alice.send(cid, f"Question number {n} about prompt injection")
        seen.append([q.split(" about")[0] for q in humans(scripted.calls[-1])])
    # Each turn keeps the last two user turns word for word, never fewer.
    assert seen == [
        ["Question number 1"],
        ["Question number 1", "Question number 2"],
        ["Question number 2", "Question number 3"],
        ["Question number 3", "Question number 4"],
    ]
    assert "summarise" in grader_script.prompts
    assert "Question number 1" in grader_script.summary_inputs[0]
    last = scripted.calls[-1]
    system = next(m for m in last if isinstance(m, SystemMessage)).content
    assert "<conversation-summary>" in system and "Notes: the user asked about prompt injection." in system
    asked = humans(last)
    assert len(asked) == 2 and "Question number 4" in asked[-1] and "Question number 3" in asked[0]
    # The user still sees every message; the summary call is accounted for like any other.
    detail = alice.get(f"/api/conversations/{cid}").json()
    assert [m["role"] for m in detail["messages"]] == ["user", "assistant"] * 4
    with session_scope(small_memory_app.state.session_factory) as db:
        assert "summarise" in {c.purpose for c in db.scalars(select(ModelCall))}


def test_a_failed_summary_keeps_the_full_history(small_memory_app, scripted, grader_script):
    grader_script.summary_reply = None  # the summary call raises
    make_user(small_memory_app, "alice")
    alice = Api(small_memory_app, "alice")
    scripted.replies = [LONG]
    cid = alice.new_conversation()["id"]
    for n in range(1, 5):
        alice.send(cid, f"Question number {n}")
    assert "summarise" in grader_script.prompts
    assert len(humans(scripted.calls[-1])) == 4  # nothing dropped
    assert "<conversation-summary>" not in next(m for m in scripted.calls[-1] if isinstance(m, SystemMessage)).content


def test_a_short_conversation_is_not_summarised(app, scripted, grader_script):
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    for n in range(1, 4):
        alice.send(cid, f"Short question {n}")
    assert "summarise" not in grader_script.prompts
    assert len(humans(scripted.calls[-1])) == 3
