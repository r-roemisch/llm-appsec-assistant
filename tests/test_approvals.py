"""P6-A12: Approval cards, bound to arguments, expiring, used once, admin switch."""

from datetime import timedelta

from sqlalchemy import select

from helpers import (
    CSRF,
    Api,
    by_name,
    insert_target,
    joined_deltas,
    make_user,
    parse_sse,
    records,
    tool_call,
)
from rampart.db import session_scope, utcnow
from rampart.models import Approval


def stream(api: Api, path: str, body=None):
    """POST that answers with server-sent events: (status, events)."""
    with api.client.stream("POST", path, json=body, headers={CSRF: api.csrf}) as response:
        if response.status_code != 200:
            response.read()
            return response.status_code, response.json()
        return 200, parse_sse(response.iter_lines())


def start_injection_turn(app, scripted, alice: Api, target_id: str):
    scripted.replies = [
        tool_call("run_injection_test", {"target_id": target_id, "suite_id": "seed-v1"}, "inj-1",
                  content="I will run the suite against your Target."),
        "The harness is not available yet, so nothing ran.",
    ]
    scripted.reply_index = 0
    cid = alice.new_conversation()["id"]
    events = alice.send(cid, "Run the injection suite against my demo target")
    return cid, events


def approval_row(app, approval_id):
    with session_scope(app.state.session_factory) as db:
        row = db.get(Approval, approval_id)
        return {"status": row.status, "approver": row.approver, "digest": row.args_digest}


def test_approval_card_then_approve_resumes_the_turn_and_consumes_the_approval(app, scripted):
    alice_id = make_user(app, "alice")
    alice = Api(app, "alice")
    target = insert_target(app, alice_id)
    cid, events = start_injection_turn(app, scripted, alice, target)

    names = [n for n, _ in events]
    assert names[-1] == "approval_required" and "done" not in names
    card = by_name(events, "approval_required")[0]
    approval = card["approval"]
    assert approval["tool"] == "run_injection_test" and approval["approver"] == "requester"
    assert approval["arguments"] == {"target_id": target, "suite_id": "seed-v1"}
    assert approval["status"] == "pending" and approval["requested_by"] == "alice"
    message = card["assistant_message"]
    assert message["status"] == "awaiting_approval" and message["pending_approval"]["id"] == approval["id"]
    assert message["tool_calls"][0]["status"] == "pending"
    assert "I will run the suite" in message["content"]

    detail = alice.get(f"/api/conversations/{cid}").json()["messages"][1]
    assert detail["status"] == "awaiting_approval" and detail["pending_approval"]["status"] == "pending"
    busy = alice.send_raw(cid, "something else")
    assert busy.status_code == 409 and "waiting for an approval" in busy.json()["detail"]

    status, resumed = stream(alice, f"/api/conversations/{cid}/approvals/{approval['id']}", {"decision": "approve"})
    assert status == 200
    names = [n for n, _ in resumed]
    assert names[0] == "resume" and names[-1] == "done"
    calls = by_name(resumed, "tool_call")
    assert calls[-1]["decision"] == "allow" and calls[-1]["reason_code"] == "approved"
    result = by_name(resumed, "tool_result")[0]
    # The approved call runs the real executor; this Target is not running, so it reports
    # unreachable (an error the Model explains), which still proves the call was allowed and ran.
    assert result["status"] == "error" and "Could not reach the Target" in result["summary"]
    done = by_name(resumed, "done")[0]["assistant_message"]
    assert done["status"] == "complete" and done["pending_approval"] is None
    assert done["content"].startswith("I will run the suite")
    assert done["tool_calls"][0]["status"] == "error"
    assert approval_row(app, approval["id"])["status"] == "consumed"

    again, body = stream(alice, f"/api/conversations/{cid}/approvals/{approval['id']}", {"decision": "approve"})
    assert again == 409 and "consumed" in body["detail"]
    reuse = app.state.gateway.check(
        user_id=alice_id, role="user", conversation_id=cid, message_id=message["id"], tool_call_id="inj-1",
        tool="run_injection_test", arguments={"target_id": target, "suite_id": "seed-v1"},
    )
    assert (reuse.decision, reuse.reason_code) == ("deny", "approval_consumed")
    decisions = [(r["decision"], r["reason_code"]) for r in records(app, tool_call_id="inj-1")]
    assert decisions[:2] == [("approval_required", "approval_pending"), ("allow", "approved")]


def test_changed_arguments_invalidate_the_approval(app, scripted):
    alice_id = make_user(app, "alice")
    alice = Api(app, "alice")
    target = insert_target(app, alice_id)
    other = insert_target(app, alice_id, url="http://127.0.0.1:9002", name="other")
    cid, events = start_injection_turn(app, scripted, alice, target)
    card = by_name(events, "approval_required")[0]
    approval_id, message_id = card["approval"]["id"], card["assistant_message"]["id"]
    with session_scope(app.state.session_factory) as db:
        db.get(Approval, approval_id).status = "approved"
    swapped = app.state.gateway.check(
        user_id=alice_id, role="user", conversation_id=cid, message_id=message_id, tool_call_id="inj-1",
        tool="run_injection_test", arguments={"target_id": other, "suite_id": "seed-v1"},
    )
    assert (swapped.decision, swapped.reason_code) == ("deny", "approval_mismatch")
    assert approval_row(app, approval_id)["status"] == "approved"  # not consumed by the mismatch


def test_expired_approval_cannot_be_approved_and_the_turn_continues_without_the_tool(app, scripted):
    alice_id = make_user(app, "alice")
    alice = Api(app, "alice")
    cid, events = start_injection_turn(app, scripted, alice, insert_target(app, alice_id))
    approval_id = by_name(events, "approval_required")[0]["approval"]["id"]
    with session_scope(app.state.session_factory) as db:
        db.get(Approval, approval_id).expires_at = utcnow() - timedelta(minutes=1)
    status, body = stream(alice, f"/api/conversations/{cid}/approvals/{approval_id}", {"decision": "approve"})
    assert status == 409 and "expired" in body["detail"]
    status, resumed = stream(alice, f"/api/conversations/{cid}/approvals/{approval_id}/continue")
    assert status == 200 and resumed[-1][0] == "done"
    result = by_name(resumed, "tool_result")[0]
    assert result["status"] == "denied" and "expired" in result["summary"]
    assert approval_row(app, approval_id)["status"] == "expired"


def test_rejection_is_reported_to_the_model(app, scripted):
    alice_id = make_user(app, "alice")
    alice = Api(app, "alice")
    cid, events = start_injection_turn(app, scripted, alice, insert_target(app, alice_id))
    approval_id = by_name(events, "approval_required")[0]["approval"]["id"]
    status, resumed = stream(alice, f"/api/conversations/{cid}/approvals/{approval_id}", {"decision": "reject"})
    assert status == 200 and resumed[-1][0] == "done"
    assert by_name(resumed, "tool_result")[0]["status"] == "rejected"
    tool_messages = [m for m in scripted.calls[-1] if type(m).__name__ == "ToolMessage"]
    assert "approval_rejected" in tool_messages[-1].content
    assert approval_row(app, approval_id)["status"] == "rejected"
    scripted.replies, scripted.reply_index = ["You're welcome."], 0
    assert alice.send(cid, "thanks")[-1][0] == "done"  # the Conversation is free again


def test_admin_switch_requires_an_admin_decision(app, scripted):
    alice_id = make_user(app, "alice")
    make_user(app, "boss", role="admin")
    alice, admin = Api(app, "alice"), Api(app, "boss")
    switched = admin.put("/api/admin/tools/run_injection_test", json={"approver": "admin"})
    assert switched.status_code == 200 and switched.json()["approver"] == "admin"
    cid, events = start_injection_turn(app, scripted, alice, insert_target(app, alice_id))
    approval = by_name(events, "approval_required")[0]["approval"]
    assert approval["approver"] == "admin"

    status, body = stream(alice, f"/api/conversations/{cid}/approvals/{approval['id']}", {"decision": "approve"})
    assert status == 403 and "administrator" in body["detail"]
    status, body = stream(alice, f"/api/conversations/{cid}/approvals/{approval['id']}/continue")
    assert status == 409  # still pending

    pending = admin.get("/api/admin/approvals?status=pending&approver=admin").json()
    assert [a["id"] for a in pending] == [approval["id"]]
    decided = admin.post(f"/api/admin/approvals/{approval['id']}", json={"decision": "approve"})
    assert decided.status_code == 200 and decided.json()["decided_by"] == "boss"
    assert alice.post(f"/api/admin/approvals/{approval['id']}", json={"decision": "approve"}).status_code == 403

    status, resumed = stream(alice, f"/api/conversations/{cid}/approvals/{approval['id']}/continue")
    assert status == 200 and resumed[-1][0] == "done"
    assert by_name(resumed, "tool_call")[-1]["reason_code"] == "approved"
    assert approval_row(app, approval["id"])["status"] == "consumed"


def test_an_admin_cannot_approve_a_requesters_own_approval(app, scripted):
    alice_id = make_user(app, "alice")
    make_user(app, "boss", role="admin")
    alice, admin = Api(app, "alice"), Api(app, "boss")
    cid, events = start_injection_turn(app, scripted, alice, insert_target(app, alice_id))
    approval_id = by_name(events, "approval_required")[0]["approval"]["id"]
    assert admin.post(f"/api/admin/approvals/{approval_id}", json={"decision": "approve"}).status_code == 403
    bob_id = make_user(app, "bob")
    bob = Api(app, "bob")
    status, _ = stream(bob, f"/api/conversations/{cid}/approvals/{approval_id}", {"decision": "approve"})
    assert status == 404 and bob_id  # another user's Conversation and Approval do not exist for bob


def test_resumed_answer_text_is_joined_to_the_preamble(app, scripted):
    alice_id = make_user(app, "alice")
    alice = Api(app, "alice")
    cid, events = start_injection_turn(app, scripted, alice, insert_target(app, alice_id))
    assert joined_deltas(events) == "I will run the suite against your Target."
    approval_id = by_name(events, "approval_required")[0]["approval"]["id"]
    _, resumed = stream(alice, f"/api/conversations/{cid}/approvals/{approval_id}", {"decision": "approve"})
    assert joined_deltas(resumed).startswith("\n\n") or joined_deltas(resumed).startswith("The harness")
    with session_scope(app.state.session_factory) as db:
        approvals = list(db.scalars(select(Approval)))
    assert len(approvals) == 1  # resuming did not create a second Approval


def test_a_reused_call_id_in_a_later_turn_needs_its_own_approval(app, scripted):
    alice_id = make_user(app, "alice")
    alice = Api(app, "alice")
    target = insert_target(app, alice_id)
    cid, events = start_injection_turn(app, scripted, alice, target)
    first = by_name(events, "approval_required")[0]["approval"]["id"]
    stream(alice, f"/api/conversations/{cid}/approvals/{first}", {"decision": "reject"})
    scripted.replies = [tool_call("run_injection_test", {"target_id": target, "suite_id": "seed-v1"}, "inj-1"), "ok"]
    scripted.reply_index = 0
    events = alice.send(cid, "try again")  # same call id "inj-1", new turn
    second = by_name(events, "approval_required")[0]["approval"]
    assert second["id"] != first and second["status"] == "pending"


def test_an_approved_call_is_checked_again_when_the_turn_resumes(app, scripted):
    """From the critique (point 4): an Approval does not outlive a policy change. The admin
    disables the Tool between the request and the decision; approving runs nothing."""
    alice_id = make_user(app, "alice")
    make_user(app, "root", role="admin")
    alice, admin = Api(app, "alice"), Api(app, "root")
    target_id = insert_target(app, alice_id)
    cid, events = start_injection_turn(app, scripted, alice, target_id)
    approval_id = by_name(events, "approval_required")[0]["approval"]["id"]
    assert admin.put("/api/admin/tools/run_injection_test", json={"enabled": False}).status_code == 200
    status, resumed = stream(alice, f"/api/conversations/{cid}/approvals/{approval_id}", {"decision": "approve"})
    assert status == 200
    result = by_name(resumed, "tool_result")[0]
    assert result["status"] == "denied"
    assert [c["reason_code"] for c in by_name(resumed, "tool_call")] == ["tool_disabled"]
