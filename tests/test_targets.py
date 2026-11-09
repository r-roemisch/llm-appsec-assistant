from helpers import Api, make_user


def test_register_only_loopback_targets(app):
    make_user(app, "alice")
    alice = Api(app, "alice")
    ok = alice.post("/api/targets", json={"name": "Local demo", "base_url": "http://127.0.0.1:8001"})
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert body["base_url"] == "http://127.0.0.1:8001" and body["input_surface"] == "user_message"
    assert body["profile"] is None and body["id"]
    assert alice.post(
        "/api/targets",
        json={"name": "v6", "base_url": "http://[::1]:9000", "input_surface": "document_slot", "profile": "vulnerable"},
    ).status_code == 201

    for url in ("http://10.0.0.5:8000", "http://evil.example.com", "https://127.0.0.1.nip.io", "ftp://127.0.0.1", "not a url"):
        refused = alice.post("/api/targets", json={"name": "bad", "base_url": url})
        assert refused.status_code == 422, url
        assert "loopback" in refused.json()["detail"]
    assert alice.post("/api/targets", json={"name": "x", "base_url": "http://127.0.0.1:1", "input_surface": "mars"}).status_code == 422
    assert alice.post("/api/targets", json={"name": "", "base_url": "http://127.0.0.1:2"}).status_code == 422


def test_targets_are_private_listed_updated_and_deleted(app):
    make_user(app, "alice")
    make_user(app, "bob")
    alice, bob = Api(app, "alice"), Api(app, "bob")
    created = alice.post("/api/targets", json={"name": "Mine", "base_url": "http://127.0.0.1:8001"}).json()
    tid = created["id"]
    assert [t["id"] for t in alice.get("/api/targets").json()] == [tid]
    assert bob.get("/api/targets").json() == []

    duplicate = alice.post("/api/targets", json={"name": "again", "base_url": "http://127.0.0.1:8001"})
    assert duplicate.status_code == 409

    renamed = alice.patch(f"/api/targets/{tid}", json={"name": "Renamed", "profile": "secure"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Renamed" and renamed.json()["profile"] == "secure"
    cleared = alice.patch(f"/api/targets/{tid}", json={"profile": None})
    assert cleared.json()["profile"] is None

    assert bob.get(f"/api/targets/{tid}").status_code == 404
    assert bob.patch(f"/api/targets/{tid}", json={"name": "hijack"}).status_code == 404
    assert bob.delete(f"/api/targets/{tid}").status_code == 404
    assert alice.delete(f"/api/targets/{tid}").status_code == 204
    assert alice.get("/api/targets").json() == []


def test_profile_accepts_only_own_targets(app):
    make_user(app, "alice")
    make_user(app, "bob")
    alice, bob = Api(app, "alice"), Api(app, "bob")
    tid = alice.post("/api/targets", json={"name": "Mine", "base_url": "http://127.0.0.1:8001"}).json()["id"]
    saved = alice.put("/api/profile", json={"stack": "demo", "packages": [], "target_ids": [tid]})
    assert saved.status_code == 200 and saved.json()["target_ids"] == [tid]
    bobs = bob.post("/api/targets", json={"name": "Bob", "base_url": "http://127.0.0.1:8002"}).json()["id"]
    assert alice.put("/api/profile", json={"stack": "x", "packages": [], "target_ids": [bobs]}).status_code == 422


def test_registered_targets_reach_the_model_even_without_a_saved_profile(app, scripted):
    make_user(app, "alice")
    alice = Api(app, "alice")
    tid = alice.post("/api/targets", json={"name": "Checkout", "base_url": "http://127.0.0.1:8080"}).json()["id"]
    alice.send(alice.new_conversation()["id"], "hello")  # no profile saved
    system = scripted.calls[-1][0].content
    assert "Registered loopback test Targets" in system
    assert f"id={tid}" in system and "http://127.0.0.1:8080" in system
