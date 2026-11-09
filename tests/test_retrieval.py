import json

from sqlalchemy import select

from helpers import Api, by_name, chat_default, make_user, parse_passages, relevant_if, upload
from rampart.db import session_scope
from rampart.models import ModelCall, Passage

HANDBOOK = "Fixture: Canary Labs handbook on indirect prompt injection"


def _calls(app, message_id):
    with session_scope(app.state.session_factory) as db:
        rows = db.scalars(select(ModelCall).where(ModelCall.message_id == message_id))
        return [(r.purpose, r.model_id, r.cost_usd) for r in rows]


def test_answer_cites_the_knowledge_base(kb_app, scripted, grader_script):
    """P6-A05: a question the Knowledge Base answers gets at least one Citation."""
    grader_script.relevant = relevant_if("quokka")
    scripted.replies = ["Wrap retrieved text in random delimiters [1]. Unknown marker [9]."]
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    cid = alice.new_conversation()["id"]
    events = alice.send(cid, "What is the quokka-delimiter technique?")
    names = [name for name, _ in events]
    assert names[0] == "start" and names[-1] == "done"
    assert names.index("retrieval") < names.index("delta") < names.index("citations")
    retrieval = by_name(events, "retrieval")
    assert [r["phase"] for r in retrieval] == ["search", "graded"]
    assert retrieval[0]["query"] == "What is the quokka-delimiter technique?"
    assert retrieval[1]["mode"] == "bm25" and retrieval[1]["relevant"] >= 1
    assert grader_script.prompts == ["route", "grade"]

    citations = by_name(events, "citations")[0]["citations"]
    assert len(citations) == 1  # [9] matches no passage and is ignored
    citation = citations[0]
    assert citation["n"] == 1 and citation["source_title"] == HANDBOOK
    assert citation["provenance"] == "source" and citation["source_type"] == "curated"
    assert "quokka" in citation["snippet"].lower() or citation["heading"]

    done = by_name(events, "done")[0]["assistant_message"]
    assert done["citations"] == citations and done["retrieval_mode"] == "bm25"
    assert [p for p, _m, _c in _calls(kb_app, done["id"])] == ["route", "grade", "generate"]
    assert done["cost_usd"] == 0.003  # three scripted calls at 0.001 each
    assert by_name(events, "usage")[0]["cost_usd"] == 0.003

    stored = alice.get(f"/api/conversations/{cid}").json()["messages"][1]
    assert stored["citations"] == citations and stored["retrieval_mode"] == "bm25"
    passage = alice.get(f"/api/knowledge/passages/{citation['passage_id']}").json()
    assert passage["source_title"] == HANDBOOK and passage["license_note"]


def test_passages_reach_the_model_as_delimited_untrusted_data(kb_app, scripted, grader_script):
    grader_script.relevant = relevant_if("quokka")
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    alice.send(alice.new_conversation()["id"], "Explain the quokka-delimiter technique")
    system, question = scripted.calls[-1][0], scripted.calls[-1][-1]
    assert "untrusted reference data" in system.content and "[1]" in system.content
    assert "quokka" not in system.content.lower()  # passages never sit in the system prompt
    passages = parse_passages(question.content)
    assert passages and passages[0]["source"] == HANDBOOK
    assert question.content.rstrip().endswith("Question: Explain the quokka-delimiter technique")
    nonce_tags = {line.split()[0] for line in question.content.splitlines() if line.startswith("<passage-")}
    assert len(nonce_tags) == 1  # one random delimiter per turn


def test_weak_retrieval_rewrites_at_most_twice(kb_app, scripted, grader_script):
    """P6-A05: when nothing relevant is found the query is rewritten, at most twice."""
    grader_script.relevant = lambda _q, _p: []
    grader_script.rewrites = ["tenant isolation filter", "access control re-check"]
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    events = alice.send(alice.new_conversation()["id"], "How do I stop zebras escaping?")
    searches = [e for e in by_name(events, "retrieval") if e["phase"] == "search"]
    assert [s["round"] for s in searches] == [1, 2, 3]
    assert [s["query"] for s in searches[1:]] == ["tenant isolation filter", "access control re-check"]
    assert grader_script.prompts == ["route", "grade", "rewrite", "grade", "rewrite", "grade"]
    assert "Previous queries:\n- How do I stop zebras escaping?" in grader_script.rewrite_inputs[0]
    final_prompt = scripted.calls[-1][-1].content
    assert "found no relevant passages" in final_prompt
    done = by_name(events, "done")[0]["assistant_message"]
    assert done["citations"] == [] and not by_name(events, "citations")


def test_a_rewrite_can_rescue_a_weak_search(kb_app, scripted, grader_script):
    grader_script.relevant = relevant_if("heliotrope")
    grader_script.rewrites = ["heliotrope tenant re-check"]
    scripted.replies = ["Re-check every passage against the database [1]."]
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    events = alice.send(alice.new_conversation()["id"], "zzqx unrelated words")
    graded = [e for e in by_name(events, "retrieval") if e["phase"] == "graded"]
    assert [g["relevant"] for g in graded][-1] >= 1 and len(graded) == 2
    citations = by_name(events, "citations")[0]["citations"]
    assert citations[0]["source_title"] == "Fixture: Heliotrope tenant isolation notes"


def test_router_may_answer_without_searching(kb_app, scripted, grader_script):
    grader_script.mode = "answer"
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    events = alice.send(alice.new_conversation()["id"], "Thanks, that was helpful!")
    assert not by_name(events, "retrieval") and grader_script.prompts == ["route"]
    assert "<passages-" not in scripted.calls[-1][-1].content
    assert by_name(events, "done")[0]["assistant_message"]["retrieval_mode"] is None


def test_invalid_routing_reply_falls_back_to_searching(kb_app, grader_script):
    grader_script.route_reply = "I think you should search, probably."
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    events = alice.send(alice.new_conversation()["id"], "quokka-delimiter")
    assert by_name(events, "retrieval")[0]["query"] == "quokka-delimiter"
    assert events[-1][0] == "done"


def test_unparseable_grades_keep_the_best_ranked_passages(kb_app, scripted, grader):
    def responder(messages):
        system = str(messages[0].content)
        if system.startswith("You are the routing step"):
            return json.dumps({"mode": "retrieve", "arguments": {"query": "quokka delimiter"}})
        return "not json at all"

    grader.responder = responder
    scripted.replies = ["Answer [1]."]
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    events = alice.send(alice.new_conversation()["id"], "quokka delimiter")
    assert by_name(events, "citations")[0]["citations"][0]["source_title"] == HANDBOOK


def test_empty_knowledge_base_skips_routing(app, factory, grader_script):
    make_user(app, "alice")
    alice = Api(app, "alice")
    events = alice.send(alice.new_conversation()["id"], "What is prompt injection?")
    assert events[-1][0] == "done" and not by_name(events, "retrieval")
    # The grader Model is built (summarising long histories needs it) but never called.
    assert grader_script.prompts == []


def test_help_mode_answers_from_the_user_guide(kb_app, scripted, grader_script):
    """P6-A24: a help-mode question about registering a Target cites the user guide."""
    grader_script.relevant = relevant_if("Targets page", "loopback")
    scripted.replies = ["Open the Targets page and enter a loopback URL [1]."]
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    conversation = alice.new_conversation(help_mode=True)
    assert conversation["help_mode"] is True
    events = alice.send(conversation["id"], "How do I register a Target?")
    assert grader_script.prompts[0] == "grade"  # help mode skips the routing call
    graded_sources = {p["source"] for p in grader_script.graded[0]}
    assert graded_sources <= {"Rampart user guide", "Rampart admin guide"}
    citations = by_name(events, "citations")[0]["citations"]
    assert citations[0]["source_title"] == "Rampart user guide"
    assert citations[0]["source_type"] == "app_docs" and "Targets" in citations[0]["heading"]
    assert "Help mode is on" in scripted.calls[-1][0].content

    off = alice.patch(f"/api/conversations/{conversation['id']}", json={"help_mode": False})
    assert off.status_code == 200 and off.json()["help_mode"] is False


def test_hybrid_retrieval_uses_embeddings_and_records_their_cost(hybrid_app, scripted, grader_script, embedder_factory):
    grader_script.relevant = relevant_if("marmot")
    scripted.replies = ["Bind approvals to an argument digest [1]."]
    make_user(hybrid_app, "alice")
    alice = Api(hybrid_app, "alice")
    status = alice.get("/api/knowledge/status").json()
    assert status["retrieval_mode"] == "hybrid" and status["reason"] is None
    assert status["embedded_passages"] == status["passages"] > 0
    with session_scope(hybrid_app.state.session_factory) as db:  # one passage loses its vector
        db.scalars(select(Passage)).first().embedding_ref = None
    partial = alice.get("/api/knowledge/status").json()
    assert partial["retrieval_mode"] == "hybrid" and partial["reason"].startswith("1 of ")

    events = alice.send(alice.new_conversation()["id"], "marmot approval digest")
    done = by_name(events, "done")[0]["assistant_message"]
    assert done["retrieval_mode"] == "hybrid"
    assert by_name(events, "retrieval")[1]["mode"] == "hybrid"
    calls = _calls(hybrid_app, done["id"])
    assert [p for p, _m, _c in calls] == ["route", "embed", "grade", "generate"]
    assert ("embed", "openai/text-embedding-3-small", 0.00001) in calls
    assert abs(done["cost_usd"] - 0.00301) < 1e-12

    by_model = {row["model_id"]: row for row in alice.get("/api/usage/me").json()["by_model"]}
    assert by_model["openai/text-embedding-3-small"]["messages"] == 1
    assert by_model[chat_default(hybrid_app)]["cost_usd"] == 0.003


def test_uploads_stay_private_in_hybrid_search_and_chat(
    hybrid_app, scripted, grader, grader_script, embedder_factory
):
    """P6-A06: user B's upload is never retrieved or cited for user A (vector path too)."""
    grader_script.relevant = relevant_if("xylophone")
    scripted.replies = ["Answer [1]."]
    make_user(hybrid_app, "alice")
    make_user(hybrid_app, "bob")
    alice, bob = Api(hybrid_app, "alice"), Api(hybrid_app, "bob")
    secret = b"# Bob notes\n\nThe xylophone-protocol rotates the signing keys every hour."
    upload_response = upload(bob, "bob.md", secret)
    assert upload_response.status_code == 201
    assert upload_response.json()["embedded_count"] == upload_response.json()["passage_count"]

    embeds_before = sum(e.calls for e in embedder_factory.built)
    events = alice.send(alice.new_conversation()["id"], "What does the xylophone-protocol rotate?")
    assert sum(e.calls for e in embedder_factory.built) > embeds_before  # vector search ran
    assert by_name(events, "done")[0]["assistant_message"]["retrieval_mode"] == "hybrid"
    for call in scripted.calls + grader.calls:  # every prompt any Model saw for alice
        assert all("rotates the signing keys" not in str(m.content) for m in call)
    assert all("bob.md" not in p["source"] for graded in grader_script.graded for p in graded)
    cited = by_name(events, "done")[0]["assistant_message"]["citations"]
    assert all(c["source_title"] != "bob.md" for c in cited)

    events = bob.send(bob.new_conversation()["id"], "What does the xylophone-protocol rotate?")
    citations = by_name(events, "citations")[0]["citations"]
    assert citations[0]["source_title"] == "bob.md" and citations[0]["provenance"] == "upload"


def test_grader_and_chat_usage_are_counted_per_model(kb_app, grader_script):
    grader_script.relevant = relevant_if("quokka")
    make_user(kb_app, "boss", role="admin")
    make_user(kb_app, "alice")
    admin, alice = Api(kb_app, "boss"), Api(kb_app, "alice")
    grader_model = "anthropic/claude-haiku-5.5"
    assert admin.put("/api/admin/models/slots/grader", json={"model_id": grader_model}).status_code == 200
    cid = alice.new_conversation()["id"]
    done = by_name(alice.send(cid, "quokka-delimiter"), "done")[0]["assistant_message"]
    rows = {row["model_id"]: row for row in alice.get("/api/usage/me").json()["by_model"]}
    assert rows[grader_model]["cost_usd"] == 0.002  # route and grade
    assert rows[chat_default(kb_app)]["cost_usd"] == 0.001  # the answer
    assert rows[grader_model]["messages"] == rows[chat_default(kb_app)]["messages"] == 1
    total = alice.get(f"/api/conversations/{cid}").json()["conversation"]["total_cost_usd"]
    assert round(total, 9) == round(done["cost_usd"], 9) == 0.003
    assert round(alice.get("/api/usage/me").json()["cost_usd"], 9) == 0.003


def test_trace_records_route_queries_and_calls(kb_app, settings, grader_script):
    grader_script.relevant = relevant_if("quokka")
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    alice.send(alice.new_conversation()["id"], "quokka-delimiter")
    lines = next(settings.traces_dir.glob("*.jsonl")).read_text().splitlines()
    turn = json.loads(lines[-1])
    metadata = turn["metadata"]
    assert metadata["route"]["mode"] == "retrieve" and metadata["queries"] == ["quokka-delimiter"]
    assert metadata["retrieval_mode"] == "bm25" and metadata["cited_passages"] is not None
    assert [c["purpose"] for c in metadata["model_calls"]] == ["route", "grade", "generate"]
