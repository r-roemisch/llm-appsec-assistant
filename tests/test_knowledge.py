import asyncio
import shutil

from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy import select

from helpers import Api, ingest_offline, make_pdf, make_user, upload
from rampart.app import create_app
from rampart.db import session_scope
from rampart.knowledge.ingest import run_ingest
from rampart.knowledge.retrieval import knowledge_version
from rampart.models import Passage, Source
from rampart.tracing import JsonlTracer


def _sources(app, **where):
    with session_scope(app.state.session_factory) as db:
        query = select(Source)
        for key, value in where.items():
            query = query.where(getattr(Source, key) == value)
        return [(s.id, s.title, s.source_type, s.owner_user_id) for s in db.scalars(query)]


def _passages_of(app, source_id):
    with session_scope(app.state.session_factory) as db:
        return [
            (p.id, p.provenance, p.text)
            for p in db.scalars(select(Passage).where(Passage.source_id == source_id))
        ]


def test_offline_ingest_is_idempotent_and_updates_changed_sources(app, settings, tmp_path):
    fixtures = tmp_path / "fixtures"
    shutil.copytree(settings.fixtures_dir, fixtures)
    app.state.knowledge.settings = settings.model_copy(update={"fixtures_dir": fixtures})
    first = ingest_offline(app)
    statuses = {doc.title: result.status for doc, result in first.stored}
    assert set(statuses.values()) == {"new"}
    assert "Rampart user guide" in statuses and "Prompt injection: a primer" in statuses
    assert any(title.startswith("Fixture:") for title in statuses)
    assert first.embedding is None and not first.failures

    with session_scope(app.state.session_factory) as db:
        version = knowledge_version(db)
    second = ingest_offline(app)
    assert {result.status for _doc, result in second.stored} == {"unchanged"}
    with session_scope(app.state.session_factory) as db:
        assert knowledge_version(db) == version  # nothing changed, indexes stay valid

    handbook = fixtures / "sources" / "injection_handbook.md"
    handbook.write_text(handbook.read_text() + "\n## Added section\n\nNew text about canaries.\n")
    third = ingest_offline(app)
    changed = {doc.title: result for doc, result in third.stored if result.status != "unchanged"}
    assert list(changed) == ["Fixture: Canary Labs handbook on indirect prompt injection"]
    result = next(iter(changed.values()))
    assert result.status == "updated"
    texts = [text for _id, _prov, text in _passages_of(app, result.source_id)]
    assert any("canaries" in text for text in texts)
    assert len(_sources(app, title=result_title(third, result))) == 1  # updated in place


def result_title(summary, result):
    return next(doc.title for doc, r in summary.stored if r is result)


def test_sources_listing_and_bm25_status(kb_app):
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    sources = alice.get("/api/knowledge/sources").json()
    by_title = {s["title"]: s for s in sources}
    guide = by_title["Rampart user guide"]
    assert guide["source_type"] == "app_docs" and guide["mine"] is False
    assert guide["origin"] == "docs/user_guide.md" and "MIT" in guide["license_note"]
    fixture = next(s for s in sources if s["title"].startswith("Fixture:"))
    assert fixture["synthetic"] is True and fixture["source_type"] == "curated"
    assert all(s["passage_count"] > 0 and s["embedded_count"] == 0 for s in sources)
    types = [s["source_type"] for s in sources]
    assert types == sorted(types, key=["upload", "curated", "app_docs"].index)

    status = alice.get("/api/knowledge/status").json()
    assert status["retrieval_mode"] == "bm25"  # no OpenRouter key: no embeddings
    assert "OpenRouter is not configured" in status["reason"]
    assert status["embedding_model_id"] == "openai/text-embedding-3-small"
    assert status["embedding_available"] is False
    assert status["sources"] == len(sources) and status["passages"] > 0
    assert status["upload_types"] == [".pdf", ".md", ".markdown", ".txt"]


def test_help_docs_endpoint(app):
    make_user(app, "alice")
    docs = Api(app, "alice").get("/api/help/docs").json()
    assert [d["slug"] for d in docs] == ["user_guide", "admin_guide"]
    assert docs[0]["title"] == "Rampart user guide" and docs[1]["audience"] == "admin"
    assert "## Targets" in docs[0]["markdown"]


def test_uploads_accept_pdf_markdown_text_and_reject_bad_files(app, settings):
    """P6-A07: stored with Provenance upload and owner ACL; bad type or size rejected (422)."""
    make_user(app, "alice")
    alice = Api(app, "alice")
    files = {
        "notes.md": b"# Notes\n\n## Threat model\n\nOur agent reads tickets from customers.",
        "plain.txt": b"Plain text upload about rate limits.",
        "paper.pdf": make_pdf(["Upload page one about canary tokens", "Page two"]),
    }
    created = {}
    for name, data in files.items():
        response = upload(alice, name, data)
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["source_type"] == "upload" and body["mine"] is True
        assert body["title"] == name and body["size_bytes"] == len(data)
        assert body["passage_count"] >= 1 and body["license_note"] is None
        created[name] = body["id"]
    for source_id in created.values():
        passages = _passages_of(app, source_id)
        assert passages and {prov for _id, prov, _text in passages} == {"upload"}
    owners = {owner for _id, _t, _type, owner in _sources(app, source_type="upload")}
    assert owners == {alice.user["id"]}

    listed = alice.get("/api/knowledge/sources").json()
    assert [s["title"] for s in listed[:3]] == ["paper.pdf", "plain.txt", "notes.md"]
    assert alice.get("/api/knowledge/status").json()["uploads"] == 3

    too_big = b"x" * (settings.max_upload_bytes + 1)
    for name, data in [
        ("big.txt", too_big),
        ("tool.exe", b"MZ\x90"),
        ("fake.pdf", b"not a pdf"),
        ("fake.txt", b"%PDF-1.7 binary"),
        ("empty.md", b""),
    ]:
        response = upload(alice, name, data)
        assert response.status_code == 422, (name, response.text)
    assert upload(alice, "notes-again.md", files["notes.md"]).status_code == 409
    assert upload(alice, "x.md", b"# x", csrf=False).status_code == 403
    no_file = alice.client.post(
        "/api/knowledge/uploads", data={"other": "x"}, headers={"X-CSRF-Token": alice.csrf}
    )
    assert no_file.status_code == 422

    assert alice.delete(f"/api/knowledge/sources/{created['plain.txt']}").status_code == 204
    assert alice.delete(f"/api/knowledge/sources/{created['plain.txt']}").status_code == 404
    assert _passages_of(app, created["plain.txt"]) == []


def test_upload_limit_per_user(settings, factory, probe):
    limited = settings.model_copy(update={"max_uploads_per_user": 2})
    app = create_app(
        limited,
        probe=probe,
        model_factory=factory,
        checkpointer=InMemorySaver(),
        tracer=JsonlTracer(limited.traces_dir),
    )
    with TestClient(app):
        make_user(app, "alice")
        alice = Api(app, "alice")
        assert upload(alice, "a.md", b"# A\n\nfirst").status_code == 201
        assert upload(alice, "b.md", b"# B\n\nsecond").status_code == 201
        third = upload(alice, "c.md", b"# C\n\nthird")
        assert third.status_code == 422 and "2 uploads" in third.json()["detail"]


def test_shared_sources_cannot_be_deleted_by_users(kb_app):
    make_user(kb_app, "alice")
    alice = Api(kb_app, "alice")
    shared = alice.get("/api/knowledge/sources").json()[0]
    assert alice.delete(f"/api/knowledge/sources/{shared['id']}").status_code == 403
    assert alice.delete("/api/knowledge/sources/does-not-exist").status_code == 404


def test_uploads_are_private_to_their_owner(kb_app):
    """P6-A06 (listing and direct access): user B's upload does not exist for user A."""
    make_user(kb_app, "alice")
    make_user(kb_app, "bob")
    make_user(kb_app, "boss", role="admin")
    alice, bob, admin = Api(kb_app, "alice"), Api(kb_app, "bob"), Api(kb_app, "boss")
    secret = b"# Bob's notes\n\nThe xylophone-protocol rotates keys every hour."
    source_id = upload(bob, "bob.md", secret).json()["id"]
    passage_id = _passages_of(kb_app, source_id)[0][0]

    for viewer in (alice, admin):
        titles = [s["title"] for s in viewer.get("/api/knowledge/sources").json()]
        assert "bob.md" not in titles
        assert viewer.get(f"/api/knowledge/passages/{passage_id}").status_code == 404
        assert viewer.delete(f"/api/knowledge/sources/{source_id}").status_code == 404
    own = bob.get(f"/api/knowledge/passages/{passage_id}")
    assert own.status_code == 200 and own.json()["provenance"] == "upload"

    retriever = kb_app.state.knowledge.retriever
    for user, expected in ((alice, False), (bob, True)):
        result = asyncio.run(
            retriever.search(
                user_id=user.user["id"],
                query="xylophone-protocol keys",
                source_types=("curated", "upload", "app_docs"),
                k=6,
                embedder=None,
            )
        )
        assert any(p.source_id == source_id for p in result.passages) is expected


def test_deleting_a_user_removes_their_uploads(kb_app):
    make_user(kb_app, "boss", role="admin")
    make_user(kb_app, "bob")
    admin, bob = Api(kb_app, "boss"), Api(kb_app, "bob")
    source_id = upload(bob, "bob.md", b"# Bob\n\nprivate text").json()["id"]
    assert admin.delete(f"/api/admin/users/{bob.user['id']}").status_code == 204
    assert _sources(kb_app, id=source_id) == []
    assert _passages_of(kb_app, source_id) == []


def test_run_ingest_reports_remote_failures_without_stopping(app):
    class Broken:
        async def fetch(self, url):
            raise ConnectionError("offline")

    summary = asyncio.run(
        run_ingest(app.state.knowledge, fixtures=False, embed=False, fetcher=Broken(), echo=print)
    )
    assert len(summary.failures) == 3 and "offline" in summary.failures[0]
    stored = {doc.source_type for doc, _ in summary.stored}
    assert stored == {"curated", "app_docs"}  # primers and guides still stored
