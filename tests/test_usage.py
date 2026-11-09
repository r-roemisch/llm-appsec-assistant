from helpers import Api, chat_default, make_user


def test_usage_totals_match_the_recorded_costs(app):
    """P6-A17: per-user and admin totals equal the sum of what the Provider reported."""
    make_user(app, "boss", role="admin")
    make_user(app, "alice")
    make_user(app, "bob")
    admin, alice, bob = Api(app, "boss"), Api(app, "alice"), Api(app, "bob")

    a = alice.new_conversation()["id"]
    alice.send(a, "one")
    alice.send(a, "two")
    b = bob.new_conversation()["id"]
    bob.send(b, "three")

    mine = alice.get("/api/usage/me").json()
    assert mine["messages"] == 2 and mine["input_tokens"] == 24 and mine["output_tokens"] == 14
    assert round(mine["cost_usd"], 9) == 0.002
    assert mine["by_model"] == [
        {"model_id": chat_default(app), "messages": 2, "input_tokens": 24,
         "output_tokens": 14, "cost_usd": 0.002}
    ]
    assert round(bob.get("/api/usage/me").json()["cost_usd"], 9) == 0.001
    assert admin.get("/api/usage/me").json()["messages"] == 0

    everyone = admin.get("/api/admin/usage").json()
    assert everyone["messages"] == 3 and round(everyone["cost_usd"], 9) == 0.003
    by_user = {row["username"]: row for row in everyone["by_user"]}
    assert round(by_user["alice"]["cost_usd"], 9) == 0.002 and by_user["alice"]["messages"] == 2
    assert round(by_user["bob"]["cost_usd"], 9) == 0.001
    assert "boss" not in by_user
    conversation_total = alice.get(f"/api/conversations/{a}").json()["conversation"]["total_cost_usd"]
    assert round(conversation_total, 9) == 0.002
