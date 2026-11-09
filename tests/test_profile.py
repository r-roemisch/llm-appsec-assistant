from helpers import Api, make_user

PROFILE = {
    "stack": "FastAPI service with a LangGraph agent and a Chroma index",
    "packages": [
        {"ecosystem": "PyPI", "name": "langchain-core", "version": "1.7.6"},
        {"ecosystem": "npm", "name": "react", "version": None},
    ],
}


def test_profile_round_trip_and_validation(app):
    make_user(app, "alice")
    alice = Api(app, "alice")
    empty = alice.get("/api/profile").json()
    assert empty["exists"] is False and empty["packages"] == [] and empty["target_ids"] == []
    assert "PyPI" in empty["ecosystems"] and "npm" in empty["ecosystems"]

    saved = alice.put("/api/profile", json=PROFILE)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["exists"] is True and body["stack"] == PROFILE["stack"]
    assert body["packages"] == PROFILE["packages"] and body["updated_at"]
    assert alice.get("/api/profile").json()["packages"][0]["name"] == "langchain-core"

    bad = [
        {"stack": "x" * 2001, "packages": []},
        {"stack": "", "packages": [{"ecosystem": "Cobol", "name": "x", "version": None}]},
        {"stack": "", "packages": [{"ecosystem": "PyPI", "name": "", "version": None}]},
        {"stack": "", "packages": [{"ecosystem": "PyPI", "name": "x", "version": "1" * 65}]},
        {"stack": "", "packages": [{"ecosystem": "PyPI", "name": "x"}] * 51},
        {"stack": "", "packages": [], "target_ids": ["t1"]},
    ]
    for body in bad:
        assert alice.put("/api/profile", json=body).status_code == 422, body
    assert alice.put("/api/profile", json=PROFILE, csrf=False).status_code == 403

    assert alice.delete("/api/profile").status_code == 204
    assert alice.get("/api/profile").json()["exists"] is False
    assert alice.delete("/api/profile").status_code == 204  # idempotent


def test_profile_is_read_every_turn_and_dropped_after_delete(app, scripted):
    """P6-A16: the next turn's context contains the profile; after deletion it does not."""
    make_user(app, "alice")
    alice = Api(app, "alice")
    cid = alice.new_conversation()["id"]
    alice.send(cid, "before any profile")
    assert "<project-profile>" not in scripted.calls[-1][0].content

    alice.put("/api/profile", json=PROFILE)
    alice.send(cid, "with a profile")
    system = scripted.calls[-1][0].content
    assert "<project-profile>" in system and PROFILE["stack"] in system
    assert "- PyPI langchain-core 1.7.6" in system and "- npm react" in system
    assert "You are talking to alice" in system

    alice.delete("/api/profile")
    alice.send(cid, "after deleting it")
    system = scripted.calls[-1][0].content
    assert "<project-profile>" not in system and PROFILE["stack"] not in system


def test_profiles_are_private(app):
    make_user(app, "alice")
    make_user(app, "bob")
    alice, bob = Api(app, "alice"), Api(app, "bob")
    alice.put("/api/profile", json=PROFILE)
    assert bob.get("/api/profile").json()["exists"] is False
    bob.delete("/api/profile")
    assert alice.get("/api/profile").json()["exists"] is True
