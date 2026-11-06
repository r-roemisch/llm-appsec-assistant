from fastapi.testclient import TestClient

from helpers import CSRF, PASSWORD, Api, make_user


def test_login_me_logout(app):
    make_user(app, "alice")
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"username": "alice", "password": PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["username"] == "alice" and body["user"]["role"] == "user"
    assert body["csrf_token"]
    cookie = response.headers["set-cookie"]
    assert "rampart_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie

    assert client.get("/api/auth/me").json()["user"]["username"] == "alice"
    assert client.post("/api/auth/logout").status_code == 403  # no CSRF token
    assert client.post("/api/auth/logout", headers={CSRF: "wrong"}).status_code == 403
    assert client.post("/api/auth/logout", headers={CSRF: body["csrf_token"]}).status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_bad_credentials(app):
    make_user(app, "alice")
    client = TestClient(app)
    assert client.post("/api/auth/login", json={"username": "alice", "password": "nope-nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "nobody", "password": PASSWORD}).status_code == 401
    assert client.get("/api/conversations").status_code == 401


def test_change_password(app):
    make_user(app, "alice")
    api = Api(app, "alice")
    wrong = api.post("/api/auth/password", json={"current_password": "wrong-one", "new_password": "new-password-1"})
    assert wrong.status_code == 400
    short = api.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "short"})
    assert short.status_code == 422
    ok = api.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "new-password-1"})
    assert ok.status_code == 204
    assert api.get("/api/auth/me").status_code == 200  # the changing session stays signed in
    fresh = TestClient(app)
    assert fresh.post("/api/auth/login", json={"username": "alice", "password": PASSWORD}).status_code == 401
    assert fresh.post("/api/auth/login", json={"username": "alice", "password": "new-password-1"}).status_code == 200


def test_admin_manages_accounts(app):
    make_user(app, "boss", role="admin")
    admin = Api(app, "boss")
    created = admin.post("/api/admin/users", json={"username": "carol", "password": PASSWORD, "role": "user"})
    assert created.status_code == 201 and created.json()["username"] == "carol"
    assert admin.post("/api/admin/users", json={"username": "carol", "password": PASSWORD}).status_code == 409
    assert admin.post("/api/admin/users", json={"username": "x", "password": PASSWORD}).status_code == 422
    assert admin.post("/api/admin/users", json={"username": "dave", "password": "short"}).status_code == 422
    names = [u["username"] for u in admin.get("/api/admin/users").json()]
    assert names == ["boss", "carol"]

    carol_id = created.json()["id"]
    assert admin.post(f"/api/admin/users/{carol_id}/password", json={"new_password": "reset-pass-1"}).status_code == 204
    assert TestClient(app).post("/api/auth/login", json={"username": "carol", "password": "reset-pass-1"}).status_code == 200

    assert admin.delete(f"/api/admin/users/{admin.user['id']}").status_code == 400
    assert admin.delete(f"/api/admin/users/{carol_id}").status_code == 204
    assert admin.delete(f"/api/admin/users/{carol_id}").status_code == 404
    assert admin.post("/api/admin/users", json={"username": "eve", "password": PASSWORD}, csrf=False).status_code == 403


def test_user_role_is_rejected_on_admin_routes(app):
    """P6-A01 and P6-A03: the backend, not the UI, rejects admin operations for users."""
    make_user(app, "alice")
    api = Api(app, "alice")
    assert api.get("/api/admin/users").status_code == 403
    assert api.post("/api/admin/users", json={"username": "mallory", "password": PASSWORD}).status_code == 403
    assert api.put("/api/admin/models/slots/chat", json={"model_id": "openai/gpt-6-luna"}).status_code == 403
    assert api.put("/api/admin/models/openai%2Fgpt-6-luna", json={"enabled": False}).status_code == 403
    assert api.get("/api/admin/usage").status_code == 403
