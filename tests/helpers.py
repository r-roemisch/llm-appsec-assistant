"""Shared helpers for the offline test suite."""

from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from rampart.auth.service import AuthService
from rampart.catalog.catalog import ModelSpec
from rampart.chat.llm import GenerationSettings
from rampart.db import session_scope

PASSWORD = "password123"
CSRF = "X-CSRF-Token"


class RecordingFactory:
    """Hands out one scripted model and remembers which Model and settings were requested."""

    def __init__(self, model: Any) -> None:
        self.model = model
        self.calls: list[tuple[ModelSpec, GenerationSettings]] = []

    def build(self, spec: ModelSpec, generation: GenerationSettings) -> Any:
        self.calls.append((spec, generation))
        return self.model


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
