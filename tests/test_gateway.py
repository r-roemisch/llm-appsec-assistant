import pytest

from helpers import Api, by_name, insert_target, make_user, records, tool_call
from rampart.gateway.constraints import is_loopback_url
from rampart.gateway.gateway import Gateway
from rampart.tools.registry import ToolManifest, ToolOutput, ToolRegistry

ANALYZE = {"system_prompt": "You are a helpful assistant."}


def check(app, user_id, tool, arguments, **kw):
    gateway: Gateway = app.state.gateway
    params = {"user_id": user_id, "role": "user", "conversation_id": "conv-1", "message_id": None,
              "tool_call_id": kw.pop("call_id", "call-x"), "tool": tool, "arguments": arguments}
    params.update(kw)
    return gateway.check(**params)


@pytest.mark.parametrize(
    "url,expected",
    [
        ("http://127.0.0.1:8001", True),
        ("http://127.5.4.3", True),
        ("http://127.5.4.3/x", False),  # a base URL only: no path the harness would build on
        ("http://[::1]:9000/", True),
        ("http://localhost:3000", True),
        ("https://localhost", True),
        ("http://10.0.0.5", False),
        ("http://attacker.example.com", False),
        ("http://127.0.0.1.nip.io", False),
        ("ftp://127.0.0.1", False),
        ("http://user@evil.example@127.0.0.1", False),  # credentials in a URL: refused outright
        ("http://127.0.0.1:8001?next=http://evil.example", False),
        ("http://127.0.0.1:8001#x", False),
        ("http://127.0.0.1:99999", False),  # not a port
        ("not a url", False),
    ],
)
def test_loopback_urls(url, expected):
    assert is_loopback_url(url) is expected


def test_unknown_tool_and_undeclared_arguments_are_rejected_before_execution(app):
    """P6-A11: schema rejection before execution, audited."""
    uid = make_user(app, "alice")
    unknown = check(app, uid, "delete_everything", {})
    assert (unknown.decision, unknown.reason_code) == ("deny", "unknown_tool")
    extra = check(app, uid, "analyze_prompt", {**ANALYZE, "shell": "rm -rf /"}, call_id="c2")
    assert (extra.decision, extra.reason_code) == ("deny", "invalid_arguments")
    assert "shell" in extra.message
    wrong_type = check(app, uid, "lookup_vulnerabilities", {"ecosystem": "Cobol", "package": "x"}, call_id="c3")
    assert wrong_type.reason_code == "invalid_arguments"
    too_long = check(app, uid, "search_knowledge", {"query": "x" * 301}, call_id="c4")
    assert too_long.reason_code == "invalid_arguments"
    missing = check(app, uid, "analyze_prompt", {}, call_id="c5")
    assert missing.reason_code == "missing_input"
    audited = [(r["tool"], r["decision"], r["reason_code"]) for r in records(app)]
    assert audited == [
        ("delete_everything", "deny", "unknown_tool"),
        ("analyze_prompt", "deny", "invalid_arguments"),
        ("lookup_vulnerabilities", "deny", "invalid_arguments"),
        ("search_knowledge", "deny", "invalid_arguments"),
        ("analyze_prompt", "deny", "missing_input"),
    ]


def test_disabled_tool_is_not_offered_and_a_direct_call_is_denied(app, scripted):
    """P6-A10."""
    make_user(app, "boss", role="admin")
    alice_id = make_user(app, "alice")
    admin, alice = Api(app, "boss"), Api(app, "alice")
    alice.send(alice.new_conversation()["id"], "hello")
    assert "lookup_vulnerabilities" in scripted.tool_offers[-1]["tools"]

    off = admin.put("/api/admin/tools/lookup_vulnerabilities", json={"enabled": False})
    assert off.status_code == 200 and off.json()["enabled"] is False
    assert "lookup_vulnerabilities" not in [t["name"] for t in alice.get("/api/tools").json()]
    alice.send(alice.new_conversation()["id"], "hello again")
    assert "lookup_vulnerabilities" not in scripted.tool_offers[-1]["tools"]

    denied = check(app, alice_id, "lookup_vulnerabilities", {"ecosystem": "PyPI", "package": "requests"})
    assert (denied.decision, denied.reason_code) == ("deny", "tool_disabled")

    scripted.replies = [tool_call("lookup_vulnerabilities", {"ecosystem": "PyPI", "package": "requests"}), "ok"]
    scripted.reply_index = 0
    events = alice.send(alice.new_conversation()["id"], "check requests")
    result = by_name(events, "tool_result")[0]
    assert result["status"] == "denied" and "disabled" in result["summary"]
    assert events[-1][0] == "done"


def test_role_restriction_is_enforced(app):
    registry = ToolRegistry()

    async def noop(args, ctx):
        return ToolOutput(data={}, summary="ok")

    registry.register(
        ToolManifest(
            name="admin_only",
            description="test",
            json_schema={"type": "object", "properties": {}, "additionalProperties": False},
            allowed_roles=("admin",),
        ),
        noop,
    )
    gateway = Gateway(app.state.session_factory, registry, app.state.settings)
    uid = make_user(app, "alice")
    common = {"user_id": uid, "conversation_id": "c", "message_id": None, "tool": "admin_only", "arguments": {}}
    assert gateway.check(role="user", tool_call_id="1", **common).reason_code == "role_forbidden"
    assert gateway.check(role="admin", tool_call_id="2", **common).decision == "allow"


def test_rate_limit_and_conversation_budget_stop_further_calls(app, scripted):
    """P6-A13: bounded stop with a visible reason, no further calls."""
    make_user(app, "boss", role="admin")
    alice_id = make_user(app, "alice")
    admin, alice = Api(app, "boss"), Api(app, "alice")
    admin.put("/api/admin/tools/analyze_prompt", json={"rate_limit_per_hour": 1})
    first = check(app, alice_id, "analyze_prompt", ANALYZE, call_id="r1")
    assert first.decision == "allow"
    second = check(app, alice_id, "analyze_prompt", ANALYZE, call_id="r2")
    assert (second.decision, second.reason_code) == ("deny", "rate_limited")
    assert "1 calls per hour" in second.message

    over = check(app, alice_id, "search_knowledge", {"query": "anything"}, call_id="b1",
                 conversation_tokens=5000, token_budget=1000)
    assert (over.decision, over.reason_code) == ("deny", "conversation_budget")

    limit = app.state.settings.max_tool_calls_per_turn
    bounded = check(app, alice_id, "search_knowledge", {"query": "x y"}, call_id="t1", turn_tool_calls=limit)
    assert bounded.reason_code == "turn_limit"

    # Through a turn: the Model keeps asking for the rate-limited tool; two equivalent denials
    # end Tool use for the turn and the answer still completes.
    scripted.replies = [
        tool_call("analyze_prompt", ANALYZE, "a1"),
        tool_call("analyze_prompt", ANALYZE, "a2"),
        tool_call("analyze_prompt", ANALYZE, "a3"),
        "I could not run the analysis: the rate limit was reached.",
    ]
    scripted.reply_index = 0
    events = alice.send(alice.new_conversation()["id"], "analyse my prompt again")
    results = by_name(events, "tool_result")
    assert [r["status"] for r in results] == ["denied", "denied"]
    assert all("calls per hour" in r["summary"] for r in results)
    assert scripted.tool_offers[-1]["tool_choice"] == "none"  # tools stopped after two denials
    assert events[-1][0] == "done"


def test_conversation_budget_stops_a_turn_before_any_model_call(app, scripted):
    """P6-A13: a Conversation over its token budget answers with the reason and calls nothing."""
    make_user(app, "boss", role="admin")
    make_user(app, "alice")
    admin, alice = Api(app, "boss"), Api(app, "alice")
    assert admin.put("/api/admin/settings", json={"conversation_token_budget": 1000}).status_code == 200
    cid = alice.new_conversation()["id"]
    scripted.input_tokens = 990
    alice.send(cid, "first question")  # uses 997 tokens
    calls_before = len(scripted.calls)
    alice.send(cid, "second question")  # 997 < 1000: still allowed, now over budget
    events = alice.send(cid, "third question")
    assert len(scripted.calls) == calls_before + 1  # the third turn made no Model call
    notice = by_name(events, "notice")[0]
    assert notice["kind"] == "budget" and "token budget" in notice["message"]
    assert events[-1][0] == "done"


def test_target_constraint_denies_unregistered_and_non_loopback_targets(app):
    alice_id = make_user(app, "alice")
    bob_id = make_user(app, "bob")
    args = {"target_id": "http://attacker.example.com", "suite_id": "seed-v1"}
    assert check(app, alice_id, "run_injection_test", args).reason_code == "target_not_registered"
    bobs = insert_target(app, bob_id)
    other = check(app, alice_id, "run_injection_test", {"target_id": bobs, "suite_id": "seed-v1"}, call_id="o")
    assert other.reason_code == "target_not_registered"  # another user's Target is not hers
    remote = insert_target(app, alice_id, url="http://10.1.2.3:8080")
    far = check(app, alice_id, "run_injection_test", {"target_id": remote, "suite_id": "seed-v1"}, call_id="f")
    assert far.reason_code == "target_not_loopback"
    own = insert_target(app, alice_id)
    conversation = Api(app, "alice").new_conversation()["id"]  # an Approval belongs to a real one
    ok = check(app, alice_id, "run_injection_test", {"target_id": own, "suite_id": "seed-v1"},
               call_id="k", conversation_id=conversation)
    assert (ok.decision, ok.reason_code) == ("approval_required", "approval_pending")
