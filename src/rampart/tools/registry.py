"""Tool manifests, executors and the registry, with admin policy overrides from the database.

A manifest is the policy of a Tool: its argument schema (closed: no undeclared properties),
who may call it, whether it needs an Approval and from whom, its rate limit, its cost class and
the argument constraints the Gateway enforces. Executors never see a call the Gateway did not
allow. Nothing a Model reads can change a manifest: only admins can, through the policy table.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from rampart.config import Settings
from rampart.models import ToolPolicy

APPROVERS = ("requester", "admin")
COST_CLASSES = ("free", "api", "model", "heavy")


@dataclass(frozen=True)
class ToolManifest:
    name: str
    description: str
    json_schema: dict[str, Any]
    allowed_roles: tuple[str, ...] = ("user", "admin")
    requires_approval: bool = False
    approver: str = "requester"
    rate_limit_per_hour: int | None = None
    cost_class: str = "free"
    argument_constraints: tuple[str, ...] = ()
    contributed_by: str = "builtin"
    enabled: bool = True
    provenance: str = "system"  # the Provenance of what the Tool returns
    max_output_chars: int = 12_000
    # Set when the contributing Plugin cannot be used (reason code: plugin_disabled,
    # plugin_drift, plugin_missing). A blocked Tool is never offered and the Gateway denies it.
    blocked: str | None = None

    def openai_tool(self) -> dict[str, Any]:
        """The definition handed to the chat Model (OpenAI function format)."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.json_schema,
            },
        }


@dataclass
class ToolContext:
    """What an executor may use. It never includes policy, credentials or other users' data."""

    user_id: int
    role: str
    conversation_id: str
    message_id: str
    session_factory: sessionmaker[Session]
    settings: Settings
    knowledge: Any = None  # KnowledgeTurn | None
    citable: Any = None  # CitableRegistry | None
    help_mode: bool = False
    # Given a Target base_url, returns an httpx transport (tests drive an in-process demo
    # Target) or None for a normal loopback client.
    target_transport: Any = None


@dataclass
class ToolOutput:
    data: dict[str, Any]
    summary: str
    model_text: str | None = None  # what the Model reads; JSON of ``data`` when absent
    error: str | None = None  # a handled failure the Model should explain (status "error")
    report_id: str | None = None
    citable_ids: list[str] = field(default_factory=list)


Executor = Callable[[dict[str, Any], ToolContext], Awaitable[ToolOutput]]


class ToolSource(Protocol):
    """Tools whose manifests live in the database rather than in code (Plugin Tools)."""

    def manifests(self, db: Session) -> list[ToolManifest]: ...

    def executor(self, name: str) -> Executor | None: ...


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, tuple[ToolManifest, Executor]] = {}
        self._sources: list[ToolSource] = []

    def add_source(self, source: ToolSource) -> None:
        self._sources.append(source)

    def register(self, manifest: ToolManifest, executor: Executor) -> None:
        if manifest.name in self._tools:
            raise ValueError(f"tool {manifest.name} is already registered")
        self._tools[manifest.name] = (manifest, executor)

    def names(self) -> list[str]:
        return list(self._tools)

    def default(self, name: str) -> ToolManifest | None:
        entry = self._tools.get(name)
        return entry[0] if entry else None

    def executor(self, name: str) -> Executor:
        if name in self._tools:
            return self._tools[name][1]
        for source in self._sources:
            found = source.executor(name)
            if found is not None:
                return found
        raise KeyError(name)

    def _source_manifests(self, db: Session) -> list[ToolManifest]:
        found: list[ToolManifest] = []
        for source in self._sources:
            found += [m for m in source.manifests(db) if m.name not in self._tools]
        return found

    def _apply(self, manifest: ToolManifest, policy: ToolPolicy | None) -> ToolManifest:
        if policy is None:
            return manifest
        changes: dict[str, Any] = {}
        if policy.enabled is not None:
            changes["enabled"] = policy.enabled
        if policy.approver is not None:
            changes["approver"] = policy.approver
        if policy.rate_limit_per_hour is not None:
            changes["rate_limit_per_hour"] = policy.rate_limit_per_hour or None
        return replace(manifest, **changes)

    def effective(self, db: Session, name: str) -> ToolManifest | None:
        manifest = self.default(name)
        if manifest is None:
            manifest = next((m for m in self._source_manifests(db) if m.name == name), None)
        if manifest is None:
            return None
        return self._apply(manifest, db.get(ToolPolicy, name))

    def effective_all(self, db: Session) -> list[ToolManifest]:
        policies = {p.name: p for p in db.scalars(select(ToolPolicy))}
        manifests = [m for m, _ in self._tools.values()] + self._source_manifests(db)
        return [self._apply(m, policies.get(m.name)) for m in manifests]

    def available_to(self, db: Session, role: str) -> list[ToolManifest]:
        """The Tools a Model may be offered for a caller: enabled, not blocked, allowed for the
        role."""
        return [
            m
            for m in self.effective_all(db)
            if m.enabled and m.blocked is None and role in m.allowed_roles
        ]
