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


def _login(client, username, password, **kw):
    return client.post("/api/auth/login", json={"username": username, "password": password}, **kw)


def test_a_username_is_throttled_after_five_failures(app):
    """P6-A25: five failed sign-ins for one username within the window, and the sixth attempt
    is refused with 429 and Retry-After before the password is checked, even the right one."""
    make_user(app, "alice")
    client = TestClient(app)
    for _ in range(5):
        assert _login(client, "alice", "wrong-password").status_code == 401
    refused = _login(client, "alice", PASSWORD)
    assert refused.status_code == 429
    assert refused.json()["detail"] == "wrong username or password"  # says nothing more
    assert 1 <= int(refused.headers["Retry-After"]) <= 15 * 60
    # Another username from the same client is not affected by alice's limit.
    make_user(app, "bob")
    assert _login(client, "bob", PASSWORD).status_code == 200


def test_unknown_usernames_are_throttled_the_same_way(app):
    client = TestClient(app)
    for _ in range(5):
        assert _login(client, "nobody", "wrong-password").status_code == 401
    assert _login(client, "nobody", "wrong-password").status_code == 429


def test_refused_attempts_do_not_extend_the_block(app):
    from datetime import timedelta

    from rampart.db import session_scope, utcnow
    from rampart.models import LoginFailure

    make_user(app, "alice")
    client = TestClient(app)
    for _ in range(5):
        _login(client, "alice", "wrong-password")
    for _ in range(3):
        assert _login(client, "alice", "wrong-password").status_code == 429
    with session_scope(app.state.session_factory) as db:
        rows = db.query(LoginFailure).filter_by(username="alice").all()
        assert len(rows) == 5  # refusals are not counted
        for row in rows:  # the window passes
            row.created_at = utcnow() - timedelta(minutes=16)
    assert _login(client, "alice", PASSWORD).status_code == 200


def test_success_and_admin_reset_clear_the_count(app):
    make_user(app, "alice")
    carol_id = make_user(app, "carol")
    make_user(app, "boss", role="admin")
    client = TestClient(app)
    for _ in range(4):
        _login(client, "alice", "wrong-password")
    assert _login(client, "alice", PASSWORD).status_code == 200
    for _ in range(4):  # the count started again after the success
        assert _login(client, "alice", "wrong-password").status_code == 401
    for _ in range(5):
        _login(client, "carol", "wrong-password")
    assert _login(client, "carol", PASSWORD).status_code == 429
    admin = Api(app, "boss")
    assert admin.post(f"/api/admin/users/{carol_id}/password", json={"new_password": "reset-pass-1"}).status_code == 204
    assert _login(client, "carol", "reset-pass-1").status_code == 200


def test_a_client_address_is_throttled_across_usernames(app):
    app.state.settings.login_max_failures_per_client = 6
    make_user(app, "alice")
    client = TestClient(app)
    for index in range(6):
        assert _login(client, f"guess-{index}", "wrong-password").status_code == 401
    assert _login(client, "alice", PASSWORD).status_code == 429


def test_forwarded_header_is_ignored_unless_trusted(app):
    app.state.settings.login_max_failures_per_client = 3
    client = TestClient(app)
    for index in range(3):
        headers = {"X-Forwarded-For": f"10.0.0.{index}"}
        _login(client, f"guess-{index}", "wrong-password", headers=headers)
    # The header was ignored, so all three failures counted against the one real client.
    assert _login(client, "someone", "x-password", headers={"X-Forwarded-For": "10.9.9.9"}).status_code == 429
    app.state.settings.trust_proxy_headers = True
    assert _login(client, "someone", "x-password", headers={"X-Forwarded-For": "10.9.9.9"}).status_code == 401


def test_deleting_an_account_deletes_its_conversation_checkpoints(app):
    make_user(app, "boss", role="admin")
    carol_id = make_user(app, "carol")
    carol = Api(app, "carol")
    cid = carol.new_conversation()["id"]
    carol.send(cid, "hello")
    saver = app.state.chat.engine.checkpointer
    config = {"configurable": {"thread_id": cid}}
    assert saver.get_tuple(config) is not None
    assert Api(app, "boss").delete(f"/api/admin/users/{carol_id}").status_code == 204
    assert saver.get_tuple(config) is None
