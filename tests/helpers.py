"""Shared helpers for the offline test suite."""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import itertools
import json
import math
import os
import re
import time
from collections.abc import Callable, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rampart.auth.service import AuthService
from rampart.catalog.catalog import ModelSpec
from rampart.chat.llm import GenerationSettings
from rampart.db import session_scope
from rampart.knowledge.embeddings import EmbeddingBatch
from rampart.knowledge.ingest import IngestSummary, run_ingest
from rampart.knowledge.text import keyword_tokens, word_count

PASSWORD = "password123"
CSRF = "X-CSRF-Token"


class RecordingFactory:
    """Hands out scripted models and remembers which Model and settings were requested.

    ``calls`` records the chat Model builds; ``grader_calls`` the grader Slot builds, which
    get ``grader`` when one is given (routing, grading and rewriting) and ``model`` otherwise.
    """

    def __init__(self, model: Any, grader: Any = None) -> None:
        self.model = model
        self.grader = grader
        self.calls: list[tuple[ModelSpec, GenerationSettings]] = []
        self.grader_calls: list[tuple[ModelSpec, GenerationSettings]] = []

    def build(self, spec: ModelSpec, generation: GenerationSettings, purpose: str = "chat") -> Any:
        if purpose == "grader":
            self.grader_calls.append((spec, generation))
            return self.grader if self.grader is not None else self.model
        self.calls.append((spec, generation))
        return self.model


def chat_default(app: FastAPI) -> str:
    """The chat Slot default from the catalog the app loaded (models.yaml)."""
    return app.state.catalog.slot_defaults["chat"].model_id


def make_user(app: FastAPI, username: str, password: str = PASSWORD, role: str = "user") -> int:
    with session_scope(app.state.session_factory) as db:
        return AuthService(db).create_user(username, password, role).id


class Api:
    """A signed-in HTTP client that attaches the CSRF token to state-changing requests."""

    def __init__(self, app: FastAPI, username: str, password: str = PASSWORD) -> None:
        self.client = TestClient(app)
        response = self.client.post(
            "/api/auth/login", json={"username": username, "password": password}
        )
        assert response.status_code == 200, response.text
        self.user = response.json()["user"]
        self.csrf = response.json()["csrf_token"]

    def _headers(self, with_csrf: bool) -> dict[str, str]:
        return {CSRF: self.csrf} if with_csrf else {}

    def get(self, path: str, **kw: Any):
        return self.client.get(path, **kw)

    def post(self, path: str, json: Any = None, csrf: bool = True, **kw: Any):
        return self.client.post(path, json=json, headers=self._headers(csrf), **kw)

    def put(self, path: str, json: Any = None, csrf: bool = True, **kw: Any):
        return self.client.put(path, json=json, headers=self._headers(csrf), **kw)

    def patch(self, path: str, json: Any = None, csrf: bool = True, **kw: Any):
        return self.client.patch(path, json=json, headers=self._headers(csrf), **kw)

    def delete(self, path: str, csrf: bool = True, **kw: Any):
        return self.client.delete(path, headers=self._headers(csrf), **kw)

    def new_conversation(self, **body: Any) -> dict[str, Any]:
        response = self.post("/api/conversations", json=body)
        assert response.status_code == 201, response.text
        return response.json()

    def send(self, conversation_id: str, content: str) -> list[tuple[str, dict[str, Any]]]:
        """Send one turn and return the parsed server-sent events."""
        with self.client.stream(
            "POST",
            f"/api/conversations/{conversation_id}/messages",
            json={"content": content},
            headers=self._headers(True),
        ) as response:
            assert response.status_code == 200, response.read()
            assert response.headers["content-type"].startswith("text/event-stream")
            return parse_sse(response.iter_lines())

    def send_raw(self, conversation_id: str, content: str):
        return self.post(f"/api/conversations/{conversation_id}/messages", json={"content": content})


def parse_sse(lines) -> list[tuple[str, dict[str, Any]]]:
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


def by_name(events: list[tuple[str, dict[str, Any]]], name: str) -> list[dict[str, Any]]:
    return [data for event, data in events if event == name]


def joined_deltas(events: list[tuple[str, dict[str, Any]]]) -> str:
    return "".join(d["text"] for d in by_name(events, "delta"))


# --- Knowledge Base helpers (M2) ----------------------------------------------------------

_PASSAGE = re.compile(
    r'<passage-[0-9a-f]+ n="(\d+)" provenance="([^"]*)" source="([^"]*)" section="([^"]*)">\n'
    r"(.*?)\n</passage-[0-9a-f]+>",
    re.S,
)


def parse_passages(text: str) -> list[dict[str, Any]]:
    return [
        {
            "n": int(m.group(1)),
            "provenance": m.group(2),
            "source": m.group(3),
            "section": m.group(4),
            "text": m.group(5),
        }
        for m in _PASSAGE.finditer(text)
    ]


class GraderScript:
    """Answers the grader Slot's prompts in tests: routing, grading and query rewriting.

    ``relevant(question, passages)`` returns the passage numbers to mark relevant;
    ``rewrites`` are returned in order for rewrite prompts. ``prompts`` records the kinds of
    prompt seen ("route", "grade", "rewrite") and ``graded`` the passages of each grading.
    """

    def __init__(
        self,
        *,
        mode: str = "retrieve",
        relevant: Callable[[str, list[dict[str, Any]]], list[int]] | None = None,
        rewrites: Sequence[str] = (),
        route_reply: str | None = None,
        summary_reply: str | None = "Notes: the user asked about prompt injection.",
    ) -> None:
        self.summary_reply = summary_reply  # None makes the summary call fail
        self.summary_inputs: list[str] = []
        self.mode = mode
        self.relevant = relevant or (lambda _q, passages: [1] if passages else [])
        self.rewrites = list(rewrites)
        self.route_reply = route_reply
        self.prompts: list[str] = []
        self.graded: list[list[dict[str, Any]]] = []
        self.rewrite_inputs: list[str] = []

    def __call__(self, messages: list[Any]) -> str | None:
        system, body = str(messages[0].content), str(messages[-1].content)
        if system.startswith("You are the routing step"):
            self.prompts.append("route")
            if self.route_reply is not None:
                return self.route_reply
            question = body.split("Latest user message:\n", 1)[-1]
            return json.dumps(
                {"mode": self.mode, "tool": None, "arguments": {"query": question}, "reason": "t"}
            )
        if system.startswith("You are the grading step"):
            self.prompts.append("grade")
            question = body.split("\n", 1)[0].removeprefix("Question: ")
            passages = parse_passages(body)
            self.graded.append(passages)
            return json.dumps({"relevant": self.relevant(question, passages)})
        if system.startswith("You keep the memory"):
            self.prompts.append("summarise")
            self.summary_inputs.append(body)
            if self.summary_reply is None:
                raise RuntimeError("the summary call failed")
            return self.summary_reply
        if system.startswith("You improve search queries"):
            self.prompts.append("rewrite")
            self.rewrite_inputs.append(body)
            return self.rewrites.pop(0) if self.rewrites else "different words entirely"
        return None


def relevant_if(*words: str) -> Callable[[str, list[dict[str, Any]]], list[int]]:
    """A grader rule: passages whose text or title mention any of ``words`` are relevant."""

    def rule(_question: str, passages: list[dict[str, Any]]) -> list[int]:
        return [
            p["n"]
            for p in passages
            if any(w.lower() in (p["text"] + " " + p["source"]).lower() for w in words)
        ]

    return rule


class HashEmbedder:
    """Deterministic offline embeddings: hashed keyword counts, L2-normalised."""

    def __init__(self, spec: Any, dim: int = 128) -> None:
        self.spec = spec
        self.dim = dim
        self.calls = 0

    async def embed(self, texts: Sequence[str]) -> EmbeddingBatch:
        self.calls += 1
        vectors = []
        for text in texts:
            vector = [0.0] * self.dim
            vector[0] = 1e-3  # never a zero vector
            for token in keyword_tokens(text):
                index = int.from_bytes(hashlib.md5(token.encode()).digest()[:4], "big")
                vector[index % self.dim] += 1.0
            norm = math.sqrt(sum(x * x for x in vector))
            vectors.append([x / norm for x in vector])
        tokens = sum(word_count(t) for t in texts)
        return EmbeddingBatch(vectors=vectors, input_tokens=tokens, cost_usd=0.00001)


class FakeEmbedderFactory:
    def __init__(self) -> None:
        self.built: list[HashEmbedder] = []

    def build(self, spec: Any) -> HashEmbedder:
        embedder = HashEmbedder(spec)
        self.built.append(embedder)
        return embedder


def ingest_offline(app: FastAPI, *, embed: bool = False) -> IngestSummary:
    """Load fixtures, primers and guides into the app's Knowledge Base, without network."""
    return asyncio.run(
        run_ingest(app.state.knowledge, fixtures=True, embed=embed, echo=lambda _line: None)
    )


def upload(api: Api, filename: str, data: bytes, csrf: bool = True):
    headers = {CSRF: api.csrf} if csrf else {}
    return api.client.post(
        "/api/knowledge/uploads", files={"file": (filename, data)}, headers=headers
    )


def make_pdf(pages: Sequence[str]) -> bytes:
    """A minimal valid PDF with one Helvetica text block per page (for upload tests)."""
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    kids: list[int] = []
    next_id = 4
    for text in pages:
        page_id, content_id = next_id, next_id + 1
        next_id += 2
        lines = ["BT", "/F1 12 Tf", "72 720 Td", "14 TL"]
        for line in text.split("\n"):
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            lines.append(f"({escaped}) Tj T*")
        lines.append("ET")
        stream = "\n".join(lines).encode("latin-1")
        objects[content_id] = (
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
        )
        objects[page_id] = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % content_id
        )
        kids.append(page_id)
    objects[2] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % k for k in kids),
        len(kids),
    )
    out = bytearray(b"%PDF-1.4\n")
    offsets: dict[int, int] = {}
    for oid in sorted(objects):
        offsets[oid] = len(out)
        out += b"%d 0 obj\n" % oid + objects[oid] + b"\nendobj\n"
    xref = len(out)
    size = max(objects) + 1
    out += b"xref\n0 %d\n0000000000 65535 f \n" % size
    for oid in range(1, size):
        out += b"%010d 00000 n \n" % offsets[oid]
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (size, xref)
    return bytes(out)


# --- Controls helpers (M3) ------------------------------------------------------------------


def tool_call(name: str, args: dict[str, Any], call_id: str = "call-1", content: str = "") -> dict[str, Any]:
    """A scripted chat reply that asks for one Tool call."""
    return {"content": content, "tool_calls": [{"name": name, "args": args, "id": call_id}]}


def insert_target(app: FastAPI, user_id: int, url: str = "http://127.0.0.1:8001", name: str = "demo") -> str:
    """A registered Target (registration itself arrives in M4)."""
    from rampart.models import Target

    with session_scope(app.state.session_factory) as db:
        target = Target(owner_user_id=user_id, name=name, base_url=url)
        db.add(target)
        db.flush()
        return target.id


def osv_transport(payloads: dict[str, Any] | None = None, *, status: int = 200, calls: list[Any] | None = None):
    """A mock OSV.dev: answers per package name, or with ``status`` for everything."""
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        if calls is not None:
            calls.append(body)
        if status != 200:
            return httpx.Response(status)
        name = body.get("package", {}).get("name")
        return httpx.Response(200, json=(payloads or {}).get(name, {}))

    return httpx.MockTransport(handler)


def records(app: FastAPI, **where: Any) -> list[Any]:
    """Gateway audit records, oldest first."""
    from sqlalchemy import select

    from rampart.models import ToolCallRecord

    with session_scope(app.state.session_factory) as db:
        query = select(ToolCallRecord).order_by(ToolCallRecord.started_at)
        for key, value in where.items():
            query = query.where(getattr(ToolCallRecord, key) == value)
        return [
            {"tool": r.tool, "decision": r.decision, "reason_code": r.reason_code, "result": r.result,
             "arguments": r.arguments, "tool_call_id": r.tool_call_id}
            for r in db.scalars(query)
        ]


# --- Injection test / demo Target helpers (M4) ----------------------------------------------


def make_demo_target(sink_path: Path, profile: str = "vulnerable"):
    """A demo Target app and an ASGI transport for it (no port, no real network)."""
    import httpx

    from rampart.demo_target import create_demo_target

    app = create_demo_target(profile, sink_path)  # type: ignore[arg-type]
    return app, httpx.ASGITransport(app=app)


def register_demo_target(app: FastAPI, user_id: int, profile: str, sink_path: Path, *, base_url: str = "http://127.0.0.1:8599", input_surface: str = "document_slot") -> str:
    """Register a Target row and wire the chat service's transport to an in-process demo app."""
    _demo_app, transport = make_demo_target(sink_path, profile)
    tid = insert_target(app, user_id, url=base_url, name=f"demo-{profile}")
    with session_scope(app.state.session_factory) as db:
        from rampart.models import Target

        target = db.get(Target, tid)
        target.input_surface = input_surface
        target.profile = profile

    def resolver(url: str):
        return transport if url == base_url else None

    app.state.chat.target_transport = resolver
    return tid


# ---- (M5) Plugins -------------------------------------------------------------------------------

_catalog_writes = itertools.count(1)


def inprocess_client_factory():
    """Plugin servers in-process: the catalog entry's script is imported and its MCPServer used
    directly, so tests drive the real MCP client and server code without starting processes.
    Switching an entry's script (for example to the drifted copy) behaves as it does over stdio."""
    from mcp import Client

    modules: dict[Path, Any] = {}

    @asynccontextmanager
    async def open_client(entry):
        script = Path(entry.args[0]) if entry.args else None
        if script is None or not script.is_file():
            raise FileNotFoundError(f"no such server script: {entry.args[:1]}")
        if script not in modules:
            spec = importlib.util.spec_from_file_location(f"plugin_{len(modules)}_{script.parent.name}", script)
            assert spec is not None and spec.loader is not None
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            modules[script] = module
        async with Client(modules[script].server, cache=None) as client:
            yield client

    return open_client


def server_entry(folder: str, title: str | None = None) -> dict[str, Any]:
    """A catalog entry for one of the fixture servers under plugins/."""
    return {"title": title or folder, "command": "{python}", "args": [f"{{plugins_dir}}/{folder}/server.py"]}


def write_catalog(app: FastAPI, plugins: dict[str, Any], raw: str | None = None) -> None:
    """Write the test catalog. The modification time is bumped so every write is seen."""
    path = app.state.settings.plugins_catalog_path
    path.parent.mkdir(parents=True, exist_ok=True)
    text = raw if raw is not None else yaml.safe_dump({"plugins": plugins}, sort_keys=False)  # file order
    path.write_text(text, encoding="utf-8")
    stamp = time.time_ns() + next(_catalog_writes) * 1_000_000
    os.utime(path, ns=(stamp, stamp))


def accept_plugin(admin: Api, plugin_id: str, *, enable: bool = True) -> dict[str, Any]:
    """Enable a Plugin (which lists its Tools) and accept the definitions just listed."""
    if enable:
        listed = admin.put(f"/api/admin/plugins/{plugin_id}", json={"enabled": True}).json()
    else:
        listed = admin.post(f"/api/admin/plugins/{plugin_id}/refresh").json()
    accepted = admin.post(f"/api/admin/plugins/{plugin_id}/accept", json={"digest": listed["current_tools_digest"]})
    assert accepted.status_code == 200, accepted.text
    return accepted.json()
