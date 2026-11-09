"""Real Rampart turns for the evaluation, on a snapshot of the database and the vector store.

The snapshot is a consistent copy (SQLite's backup API) taken when the run starts and deleted
when it ends, so evaluation turns never add Conversations, usage or traces to the real data, and
the Knowledge Base the questions are asked against is exactly the one in use. Each case is one
new Conversation of a throwaway evaluation user, driven through the HTTP API like the browser.
"""

from __future__ import annotations

import json
import secrets
import shutil
import sqlite3
import tempfile
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from langgraph.checkpoint.memory import InMemorySaver
from sqlalchemy import select

from rampart.auth.service import AuthService
from rampart.catalog.catalog import Catalog
from rampart.catalog.providers import ProviderProbe
from rampart.chat.llm import ChatModelFactory
from rampart.config import Settings
from rampart.db import session_scope
from rampart.models import Passage
from rampart.tracing import JsonlTracer

EVAL_USERNAME = "rampart-eval"
EVAL_TARGET = {"name": "Eval demo target", "base_url": "http://127.0.0.1:8599"}
CSRF_HEADER = "X-CSRF-Token"


@dataclass
class TurnRecord:
    case_id: str
    question: str
    answer: str = ""
    status: str = "error"  # done | error | approval_required
    error: str | None = None
    context_ids: list[str] = field(default_factory=list)
    contexts: list[str] = field(default_factory=list)
    tools_called: list[str] = field(default_factory=list)
    cost_usd: float | None = None
    model_calls: int = 0


@contextmanager
def snapshot(settings: Settings) -> Iterator[Settings]:
    settings.eval_work_dir.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix="snapshot-", dir=settings.eval_work_dir))
    try:
        if settings.database_path.is_file():
            source = sqlite3.connect(settings.database_path)
            target = sqlite3.connect(folder / settings.database_path.name)
            try:
                source.backup(target)
            finally:
                target.close()
                source.close()
        if settings.chroma_dir.is_dir():
            shutil.copytree(settings.chroma_dir, folder / settings.chroma_dir.name)
        yield settings.model_copy(update={"data_dir": folder})
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def parse_sse(lines: Any) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []
    name: str | None = None
    data: list[str] = []
    for line in lines:
        if line == "":
            if name is not None or data:
                events.append((name or "message", json.loads("\n".join(data))))
            name, data = None, []
        elif line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].strip())
    if name is not None or data:
        events.append((name or "message", json.loads("\n".join(data))))
    return events


def record_from_events(
    case_id: str, question: str, events: list[tuple[str, dict[str, Any]]]
) -> TurnRecord:
    record = TurnRecord(case_id=case_id, question=question)
    for name, data in events:
        if name == "retrieval" and data.get("phase") == "graded":
            record.context_ids = list(data.get("context_ids") or [])
        elif name == "tool_call":
            tool = str(data.get("tool") or "")
            if tool and tool not in record.tools_called:
                record.tools_called.append(tool)
        elif name in ("done", "error", "approval_required"):
            message = data.get("assistant_message") or {}
            record.status = "done" if name == "done" else name
            record.answer = str(message.get("content") or "")
            record.cost_usd = message.get("cost_usd")
            if name == "error":
                record.error = str(data.get("message") or "the turn failed")
    return record


class TurnDriver:
    """Signed in as the evaluation user inside a snapshot app; asks one question per call."""

    def __init__(self, client: TestClient, session_factory: Any) -> None:
        self.client = client
        self.session_factory = session_factory
        password = secrets.token_urlsafe(24)
        with session_scope(session_factory) as db:
            AuthService(db).create_user(EVAL_USERNAME, password, "user")
        login = client.post(
            "/api/auth/login", json={"username": EVAL_USERNAME, "password": password}
        )
        login.raise_for_status()
        self.csrf = client.get("/api/auth/me").json()["csrf_token"]

    def _post(self, path: str, body: dict[str, Any]) -> Any:
        return self.client.post(path, json=body, headers={CSRF_HEADER: self.csrf})

    def register_target(self) -> None:
        self._post(
            "/api/targets", {**EVAL_TARGET, "input_surface": "document_slot"}
        ).raise_for_status()

    def ask(self, case_id: str, question: str) -> TurnRecord:
        conversation = self._post("/api/conversations", {})
        conversation.raise_for_status()
        cid = conversation.json()["id"]
        with self.client.stream(
            "POST",
            f"/api/conversations/{cid}/messages",
            json={"content": question},
            headers={CSRF_HEADER: self.csrf},
        ) as response:
            if response.status_code != 200:
                response.read()
                return TurnRecord(
                    case_id, question, error=f"HTTP {response.status_code}: {response.text[:200]}"
                )
            record = record_from_events(case_id, question, parse_sse(response.iter_lines()))
        record.contexts = self.passage_texts(record.context_ids)
        return record

    def passage_texts(self, ids: list[str]) -> list[str]:
        if not ids:
            return []
        with session_scope(self.session_factory) as db:
            texts = {p.id: p.text for p in db.scalars(select(Passage).where(Passage.id.in_(ids)))}
        return [texts[i] for i in ids if i in texts]


def collect(
    settings: Settings,
    cases: Sequence[tuple[str, str]],
    *,
    model_factory: ChatModelFactory,
    probe: ProviderProbe,
    catalog: Catalog | None = None,
    register_target: bool = False,
    progress: Callable[[int, int, TurnRecord], None] | None = None,
) -> list[TurnRecord]:
    """Ask every (case id, question) on a fresh snapshot and return what each turn did."""
    from rampart.app import create_app  # imported here: the app imports this package's router

    records: list[TurnRecord] = []
    with snapshot(settings) as snap:
        app = create_app(
            snap,
            catalog=catalog,
            probe=probe,
            model_factory=model_factory,
            checkpointer=InMemorySaver(),
            tracer=JsonlTracer(snap.traces_dir),
        )
        with TestClient(app) as client:
            driver = TurnDriver(client, app.state.session_factory)
            if register_target:
                driver.register_target()
            for index, (case_id, question) in enumerate(cases, start=1):
                try:
                    record = driver.ask(case_id, question)
                except Exception as exc:  # one broken case must not end the run
                    record = TurnRecord(
                        case_id, question, error=f"{type(exc).__name__}: {exc}"[:300]
                    )
                records.append(record)
                if progress is not None:
                    progress(index, len(cases), record)
    return records
