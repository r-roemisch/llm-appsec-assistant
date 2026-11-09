"""Secrets across the whole data lifecycle, not only displayed text (from the critique, point 5):
uploads, the Project Profile and exported traces are redacted before they are stored or sent."""

from sqlalchemy import select

from helpers import Api, make_user, upload
from rampart.db import session_scope
from rampart.models import Passage, Source
from rampart.tracing.tracer import redact_trace_data

FAKE_KEY = "sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4"


def test_an_uploaded_document_is_redacted_before_it_is_indexed(app):
    make_user(app, "alice")
    alice = Api(app, "alice")
    text = f"# Deploy notes\n\nThe staging API key is {FAKE_KEY}; rotate it monthly.\n".encode()
    assert upload(alice, "deploy.md", text).status_code == 201
    with session_scope(app.state.session_factory) as db:
        passages = [
            p.text
            for p in db.scalars(select(Passage).join(Source).where(Source.source_type == "upload"))
        ]
    assert passages and not any(FAKE_KEY in p for p in passages)
    assert any("[REDACTED:openai_key]" in p for p in passages)


def test_the_project_profile_never_carries_a_credential_into_a_prompt(app, scripted):
    make_user(app, "alice")
    alice = Api(app, "alice")
    saved = alice.put("/api/profile", json={"stack": f"FastAPI app; OPENAI key {FAKE_KEY}", "packages": []})
    assert saved.status_code == 200 and FAKE_KEY not in saved.json()["stack"]
    alice.send(alice.new_conversation()["id"], "hello")
    assert FAKE_KEY not in scripted.calls[-1][0].content


def test_everything_exported_to_langfuse_is_redacted():
    data = {
        "input": [{"role": "user", "content": f"use {FAKE_KEY}"}],
        "output": f"DB_PASSWORD=hunter2hunter2 and {FAKE_KEY}",
        "metadata": {"note": "nothing secret"},
    }
    masked = redact_trace_data(data=data)
    assert FAKE_KEY not in str(masked) and "hunter2hunter2" not in str(masked)
    assert masked["metadata"] == {"note": "nothing secret"}
