from helpers import Api, make_user


def test_catalog_listing_flags(app):
    make_user(app, "alice")
    api = Api(app, "alice")
    body = api.get("/api/models").json()
    models = {m["id"]: m for m in body["models"]}
    assert len(models) == 7
    assert models["anthropic/claude-haiku-5.5"]["available"] is True
    assert models["ollama/qwen3:8b"]["available"] is True  # pulled according to the probe
    assert models["ollama/nomic-embed-text"]["available"] is False
    assert all(m["enabled"] for m in models.values())
    assert body["slots"]["chat"] == {
        "model_id": "anthropic/claude-haiku-5.5",
        "source": "default",
        "temperature": None,
        "max_tokens": 4096,
    }
    assert body["slots"]["embedding"]["model_id"] == "openai/text-embedding-3-small"


def test_admin_overrides_chat_slot_and_turns_use_it(app, factory):
    """P6-A04: Slot settings changed by an admin apply to the next turn; users cannot change them."""
    make_user(app, "boss", role="admin")
    make_user(app, "alice")
    admin, alice = Api(app, "boss"), Api(app, "alice")

    conversation = alice.new_conversation()  # created before the override
    assert conversation["model_id"] == "anthropic/claude-haiku-5.5"

    response = admin.put(
        "/api/admin/models/slots/chat",
        json={"model_id": "openai/gpt-6-luna", "temperature": 0.2, "max_tokens": 1000},
    )
    assert response.status_code == 200, response.text
    assert response.json()["chat"] == {
        "model_id": "openai/gpt-6-luna",
        "source": "override",
        "temperature": 0.2,
        "max_tokens": 1000,
    }

    events = alice.send(conversation["id"], "hello")
    assert events[-1][0] == "done"
    spec, generation = factory.calls[-1]
    assert spec.id == "anthropic/claude-haiku-5.5"  # the Conversation keeps its own Model
    assert (generation.temperature, generation.max_tokens) == (0.2, 1000)

    assert alice.new_conversation()["model_id"] == "openai/gpt-6-luna"  # new default

    partial = admin.put("/api/admin/models/slots/chat", json={"temperature": None})
    assert partial.json()["chat"]["temperature"] is None
    assert partial.json()["chat"]["max_tokens"] == 1000

    reset = admin.delete("/api/admin/models/slots/chat")
    assert reset.json()["chat"]["source"] == "default"
    assert reset.json()["chat"]["model_id"] == "anthropic/claude-haiku-5.5"
    assert alice.put("/api/admin/models/slots/chat", json={"max_tokens": 5}).status_code == 403


def test_slot_validation(app):
    make_user(app, "boss", role="admin")
    admin = Api(app, "boss")
    bad_kind = admin.put("/api/admin/models/slots/embedding", json={"model_id": "openai/gpt-6-luna"})
    assert bad_kind.status_code == 422
    assert admin.put("/api/admin/models/slots/chat", json={"temperature": 3}).status_code == 422
    assert admin.put("/api/admin/models/slots/chat", json={"max_tokens": 0}).status_code == 422
    assert admin.put("/api/admin/models/slots/chat", json={"model_id": "nope/none"}).status_code == 404
    assert admin.put("/api/admin/models/slots/nope", json={"max_tokens": 10}).status_code == 404
    assert admin.put("/api/admin/models/slots/chat", json={"bogus": 1}).status_code == 422


def test_disable_model(app):
    make_user(app, "boss", role="admin")
    make_user(app, "alice")
    admin, alice = Api(app, "boss"), Api(app, "alice")
    in_use = admin.put("/api/admin/models/anthropic%2Fclaude-haiku-5.5", json={"enabled": False})
    assert in_use.status_code == 422

    off = admin.put("/api/admin/models/openai%2Fgpt-6.1-sol", json={"enabled": False})
    assert off.status_code == 200 and off.json()["enabled"] is False
    refused = alice.post("/api/conversations", json={"model_id": "openai/gpt-6.1-sol"})
    assert refused.status_code == 422
    assert admin.put("/api/admin/models/slots/judge", json={"model_id": "openai/gpt-6.1-sol"}).status_code == 422

    on = admin.put("/api/admin/models/openai%2Fgpt-6.1-sol", json={"enabled": True})
    assert on.json()["enabled"] is True
    assert alice.post("/api/conversations", json={"model_id": "openai/gpt-6.1-sol"}).status_code == 201
    assert admin.put("/api/admin/models/nope%2Fnone", json={"enabled": False}).status_code == 404
