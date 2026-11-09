"""P6-A18 and P6-A19 (conversion): Feedback is stored with the trace id, forwarded as a score,
changes no policy or Guard, and an admin can turn it into an Evaluation Case."""

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from helpers import Api, by_name, make_user, tool_call
from rampart.db import session_scope
from rampart.feedback.service import FeedbackService
from rampart.models import (
    AppSetting,
    EvaluationCase,
    Feedback,
    ModelSetting,
    Plugin,
    SlotSetting,
    ToolPolicy,
)

FAKE_KEY = "sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4"


def answer(api: Api, text: str = "What is prompt injection?") -> dict:
    cid = api.new_conversation()["id"]
    events = api.send(cid, text)
    return by_name(events, "done")[0]["assistant_message"]


def _digest(material: Any) -> str:
    text = json.dumps(material, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def policy_digest(db: Session) -> str:
    """A fingerprint of everything an admin controls: Tool policies, settings (persona, budget,
    Guard flags), Slot and Model settings, Plugin enablement and accepted definitions."""
    return _digest(
        {
            "tool_policies": [
                [p.name, p.enabled, p.approver, p.rate_limit_per_hour]
                for p in db.scalars(select(ToolPolicy).order_by(ToolPolicy.name))
            ],
            "settings": [
                [s.key, s.value] for s in db.scalars(select(AppSetting).order_by(AppSetting.key))
            ],
            "slots": [
                [s.slot, s.model_id, s.temperature, s.max_tokens]
                for s in db.scalars(select(SlotSetting).order_by(SlotSetting.slot))
            ],
            "models": [
                [m.model_id, m.enabled]
                for m in db.scalars(select(ModelSetting).order_by(ModelSetting.model_id))
            ],
            "plugins": [
                [p.id, p.enabled, p.accepted_tools_digest]
                for p in db.scalars(select(Plugin).order_by(Plugin.id))
            ],
        }
    )


def guard_digest() -> str:
    """A fingerprint of the Guards' rules, which are code: the input and untrusted-text patterns,
    the secret patterns and the safe response."""
    from rampart.guards.input_guard import SAFE_RESPONSE
    from rampart.guards.patterns import AI_DIRECTED, INJECTION_RULES
    from rampart.guards.secrets import PATTERNS

    return _digest(
        {
            "input": [
                [r.category, r.weight, r.regex.pattern] for r in (*INJECTION_RULES, AI_DIRECTED)
            ],
            "secrets": [[p.kind, p.regex.pattern, p.group] for p in PATTERNS],
            "safe_response": SAFE_RESPONSE,
        }
    )


def digests(app) -> tuple[str, str]:
    with session_scope(app.state.session_factory) as db:
        return policy_digest(db), guard_digest()


def score_lines(app) -> list[dict]:
    lines: list[dict] = []
    for path in sorted(app.state.settings.traces_dir.glob("*.jsonl")):
        lines += [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    return [line for line in lines if line.get("type") == "score"]


def test_thumbs_down_is_stored_with_the_trace_and_changes_no_policy(app, scripted):
    """P6-A18."""
    make_user(app, "alice")
    alice = Api(app, "alice")
    message = answer(alice)
    assert message["trace_id"]
    before = digests(app)

    response = alice.put(
        f"/api/messages/{message['id']}/feedback",
        json={"value": -1, "comment": f"It missed excessive agency. Also my key {FAKE_KEY}"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["value"] == -1

    with session_scope(app.state.session_factory) as db:
        row = db.scalar(select(Feedback))
        assert row is not None and row.value == -1 and row.trace_id == message["trace_id"]
        assert FAKE_KEY not in (row.comment or "") and "[REDACTED:" in (row.comment or "")
        assert row.forwarded_to == "jsonl" and row.forwarded_at is not None
        feedback_id = row.id
    scores = score_lines(app)
    assert [(s["trace_id"], s["name"], s["value"], s["score_id"]) for s in scores] == [
        (message["trace_id"], "user_feedback", -1.0, feedback_id)
    ]
    assert digests(app) == before  # policy and Guards unchanged

    # The answer shows the user's own Feedback; a changed thumb updates the same score.
    detail = alice.get(f"/api/conversations/{message['conversation_id']}").json()
    assert next(m for m in detail["messages"] if m["id"] == message["id"])["feedback"]["value"] == -1
    alice.put(f"/api/messages/{message['id']}/feedback", json={"value": 1})
    with session_scope(app.state.session_factory) as db:
        assert [r.value for r in db.scalars(select(Feedback))] == [1]
    assert [s["score_id"] for s in score_lines(app)] == [feedback_id, feedback_id]
    assert digests(app) == before


def test_feedback_only_on_your_own_finished_answers(app, scripted):
    make_user(app, "alice")
    make_user(app, "bob")
    alice, bob = Api(app, "alice"), Api(app, "bob")
    message = answer(alice)
    path = f"/api/messages/{message['id']}/feedback"
    assert bob.put(path, json={"value": 1}).status_code == 404  # not even revealed to exist
    detail = alice.get(f"/api/conversations/{message['conversation_id']}").json()
    user_message = next(m for m in detail["messages"] if m["role"] == "user")
    assert alice.put(f"/api/messages/{user_message['id']}/feedback", json={"value": 1}).status_code == 404
    for body in ({"value": 0}, {"value": "1"}, {"value": True}, {"value": 1, "extra": 1}, {"value": 1, "comment": "x" * 1001}):
        assert alice.put(path, json=body).status_code == 422, body
    assert alice.put(path, json={"value": 1}).status_code == 200
    assert alice.delete(path).status_code == 204
    detail = alice.get(f"/api/conversations/{message['conversation_id']}").json()
    assert next(m for m in detail["messages"] if m["id"] == message["id"])["feedback"] is None


def test_feedback_goes_with_the_conversation(app, scripted):
    make_user(app, "alice")
    alice = Api(app, "alice")
    message = answer(alice)
    alice.put(f"/api/messages/{message['id']}/feedback", json={"value": -1})
    assert alice.delete(f"/api/conversations/{message['conversation_id']}").status_code == 204
    with session_scope(app.state.session_factory) as db:
        assert list(db.scalars(select(Feedback))) == []


def test_the_admin_dashboard_lists_feedback_with_question_answer_and_tools(app, scripted):
    make_user(app, "root", role="admin")
    make_user(app, "alice")
    admin, alice = Api(app, "root"), Api(app, "alice")
    scripted.replies = [
        tool_call("analyze_prompt", {"system_prompt": "You are a helpful bot."}, "a1", content="Reviewing."),
        "No boundaries are set [finding].",
        "A second answer.",
    ]
    first = answer(alice, "Review my system prompt")
    second = answer(alice, "Anything else?")
    alice.put(f"/api/messages/{first['id']}/feedback", json={"value": -1, "comment": "too vague"})
    alice.put(f"/api/messages/{second['id']}/feedback", json={"value": 1})

    assert alice.get("/api/admin/feedback").status_code == 403
    dashboard = admin.get("/api/admin/feedback").json()
    assert (dashboard["up"], dashboard["down"], dashboard["converted"]) == (1, 1, 0)
    down = admin.get("/api/admin/feedback?value=-1").json()["items"]
    assert len(down) == 1
    item = down[0]
    assert item["question"] == "Review my system prompt" and item["username"] == "alice"
    assert item["answer"] == first["content"] and item["comment"] == "too vague"
    assert item["tools_used"] == ["analyze_prompt"] and item["trace_id"] == first["trace_id"]
    assert item["forwarded_to"] == "jsonl"


def test_an_admin_turns_feedback_into_an_evaluation_case(app, scripted):
    """P6-A19, first half: the case is stored (the run that uses it is in test_eval.py)."""
    make_user(app, "root", role="admin")
    make_user(app, "alice")
    admin, alice = Api(app, "root"), Api(app, "alice")
    first, second = answer(alice, "What is LLM06?"), answer(alice, "Check requests 2.25.0")
    for message in (first, second):
        alice.put(f"/api/messages/{message['id']}/feedback", json={"value": -1})
    items = {i["message_id"]: i for i in admin.get("/api/admin/feedback").json()["items"]}
    fb_first, fb_second = items[first["id"]]["id"], items[second["id"]]["id"]

    qa = admin.post(
        f"/api/admin/feedback/{fb_first}/evaluation-case",
        json={"kind": "qa", "question": "What is LLM06 in the OWASP Top 10 for LLM Applications?",
              "expected_answer": "LLM06:2025 is Excessive Agency."},
    )
    assert qa.status_code == 201, qa.text
    case = qa.json()
    assert case["source"] == f"feedback:{fb_first}" and case["created_by"] == "root"
    again = admin.post(f"/api/admin/feedback/{fb_first}/evaluation-case",
                       json={"kind": "qa", "question": "x", "expected_answer": "y"})
    assert again.status_code == 409
    assert admin.post(f"/api/admin/feedback/{fb_second}/evaluation-case",
                      json={"kind": "tool", "question": "Check requests", "expected_tools": ["no_such_tool"]}).status_code == 422
    assert admin.post(f"/api/admin/feedback/{fb_second}/evaluation-case",
                      json={"kind": "qa", "question": "Check requests"}).status_code == 422  # no answer
    tool = admin.post(f"/api/admin/feedback/{fb_second}/evaluation-case",
                      json={"kind": "tool", "question": "Check PyPI requests 2.25.0", "expected_tools": ["lookup_vulnerabilities"]})
    assert tool.status_code == 201 and tool.json()["expected_tools"] == ["lookup_vulnerabilities"]
    assert alice.post(f"/api/admin/feedback/{fb_first}/evaluation-case", json={"kind": "qa", "question": "q", "expected_answer": "a"}).status_code == 403

    listed = admin.get("/api/admin/evaluation-cases").json()
    assert [c["kind"] for c in listed] == ["qa", "tool"]
    assert admin.get("/api/admin/feedback").json()["converted"] == 2
    # Deleting the case keeps the Feedback, unlinked.
    assert admin.delete(f"/api/admin/evaluation-cases/{case['id']}").status_code == 204
    items = {i["id"]: i for i in admin.get("/api/admin/feedback").json()["items"]}
    assert items[fb_first]["evaluation_case_id"] is None
    with session_scope(app.state.session_factory) as db:
        assert [c.kind for c in db.scalars(select(EvaluationCase))] == ["tool"]


class _RecordingTracer:
    backend = "langfuse"

    def __init__(self, fail: bool = False) -> None:
        self.calls: list[dict] = []
        self.fail = fail

    def score(self, **kwargs) -> None:
        if self.fail:
            raise ConnectionError("langfuse unreachable")
        self.calls.append(kwargs)


def test_forwarding_to_langfuse_uses_the_feedback_id_and_never_blocks(app, scripted):
    make_user(app, "alice")
    alice = Api(app, "alice")
    message = answer(alice)
    with session_scope(app.state.session_factory) as db:
        from rampart.models import User

        user = db.scalar(select(User).where(User.username == "alice"))
        tracer = _RecordingTracer()
        row = FeedbackService(db, tracer).set(user, message["id"], -1, "wrong")  # type: ignore[arg-type]
        assert tracer.calls == [
            {"trace_id": message["trace_id"], "name": "user_feedback", "value": -1.0, "comment": "wrong", "score_id": row.id}
        ]
        assert row.forwarded_to == "langfuse"
        broken = FeedbackService(db, _RecordingTracer(fail=True)).set(user, message["id"], 1, None)  # type: ignore[arg-type]
        assert broken.value == 1  # stored even though the score could not be sent
