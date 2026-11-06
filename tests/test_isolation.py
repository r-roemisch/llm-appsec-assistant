from helpers import Api, make_user


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
