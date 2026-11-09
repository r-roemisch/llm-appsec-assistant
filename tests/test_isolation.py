from helpers import Api, make_user
from rampart.db import session_scope


def test_conversations_are_private(app):
    """P6-A01: another user's Conversation does not exist as far as the API is concerned."""
    make_user(app, "alice")
    make_user(app, "bob")
    alice, bob = Api(app, "alice"), Api(app, "bob")
    conversation = alice.new_conversation(title="Alice only")
    cid = conversation["id"]

    assert [c["id"] for c in alice.get("/api/conversations").json()] == [cid]
    assert bob.get("/api/conversations").json() == []
    assert bob.get(f"/api/conversations/{cid}").status_code == 404
    assert bob.patch(f"/api/conversations/{cid}", json={"title": "mine now"}).status_code == 404
    assert bob.delete(f"/api/conversations/{cid}").status_code == 404
    assert bob.send_raw(cid, "hello").status_code == 404
    assert alice.get(f"/api/conversations/{cid}").json()["conversation"]["title"] == "Alice only"


def test_every_user_object_is_private_to_its_owner(app, scripted):
    """P6-R01 across every per-user object (from the critique, point 6): another user gets 404
    (never 403, which would reveal the object exists) on every route that names one, and never
    sees it in a list."""
    from helpers import by_name, insert_target, tool_call, upload
    from rampart.models import Report

    alice_id = make_user(app, "alice")
    make_user(app, "bob")
    alice, bob = Api(app, "alice"), Api(app, "bob")
    cid = alice.new_conversation()["id"]
    answer = by_name(alice.send(cid, "hello"), "done")[0]["assistant_message"]
    alice.put(f"/api/messages/{answer['id']}/feedback", json={"value": 1})
    source_id = upload(alice, "notes.md", b"# Notes\n\nPrivate notes.\n").json()["id"]
    target_id = alice.post("/api/targets", json={"name": "Mine", "base_url": "http://127.0.0.1:8123"}).json()["id"]
    with session_scope(app.state.session_factory) as db:
        report = Report(user_id=alice_id, conversation_id=cid, title="Mine", markdown="# Private")
        db.add(report)
        db.flush()
        report_id = report.id
    scripted.replies = [tool_call("run_injection_test", {"target_id": insert_target(app, alice_id, url="http://127.0.0.1:8124"), "suite_id": "seed-v1"}, "i1"), "ok"]
    scripted.reply_index = 0
    icid = alice.new_conversation()["id"]
    approval_id = by_name(alice.send(icid, "test my target"), "approval_required")[0]["approval"]["id"]

    attempts = {
        "read conversation": bob.get(f"/api/conversations/{cid}"),
        "rename conversation": bob.patch(f"/api/conversations/{cid}", json={"title": "x"}),
        "post into conversation": bob.post(f"/api/conversations/{cid}/messages", json={"content": "hi"}),
        "delete conversation": bob.delete(f"/api/conversations/{cid}"),
        "decide approval": bob.post(f"/api/conversations/{icid}/approvals/{approval_id}", json={"decision": "approve"}),
        "rate answer": bob.put(f"/api/messages/{answer['id']}/feedback", json={"value": -1}),
        "remove rating": bob.delete(f"/api/messages/{answer['id']}/feedback"),
        "read report": bob.get(f"/api/reports/{report_id}"),
        "download report": bob.get(f"/api/reports/{report_id}/download"),
        "delete report": bob.delete(f"/api/reports/{report_id}"),
        "read target": bob.get(f"/api/targets/{target_id}"),
        "change target": bob.patch(f"/api/targets/{target_id}", json={"name": "x"}),
        "delete target": bob.delete(f"/api/targets/{target_id}"),
        "delete upload": bob.delete(f"/api/knowledge/sources/{source_id}"),
    }
    assert {name: r.status_code for name, r in attempts.items() if r.status_code != 404} == {}
    assert bob.get("/api/conversations").json() == []
    assert bob.get("/api/reports").json() == [] and bob.get("/api/targets").json() == []
    assert source_id not in [s["id"] for s in bob.get("/api/knowledge/sources").json()]
    # Alice's objects are all still there.
    assert alice.get(f"/api/conversations/{cid}").status_code == 200
    assert alice.get(f"/api/reports/{report_id}").status_code == 200
