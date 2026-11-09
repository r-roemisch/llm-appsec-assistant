"""ORM tables: users, sessions, Conversations, messages and their Model calls, Slot and Model
settings (M1); Sources, Passages, Project Profiles and the Knowledge Base version (M2); Tool
policy, the Tool-call audit, Approvals, Guard events, Reports, admin settings, the OSV.dev cache
and Targets (M3; Targets are registered from M4)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from rampart.db import Base, utcnow


def new_id() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    sessions: Mapped[list[AuthSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    conversations: Mapped[list[Conversation]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(Base):
    """A login session. The primary key is the SHA-256 of the cookie token, never the token."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    user: Mapped[User] = relationship(back_populates="sessions")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="New conversation")
    model_id: Mapped[str] = mapped_column(String(200), nullable=False)
    help_mode: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    user: Mapped[User] = relationship(back_populates="conversations")
    messages: Mapped[list[Message]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class Message(Base):
    """Mirror of one chat message for the UI and accounting; the model-facing history
    lives in the LangGraph checkpoint keyed by the Conversation id."""

    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    model_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="complete")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    retrieval_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    tool_calls: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    guard_events: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class ModelCall(Base):
    """One Model call made during a turn (route, grade, rewrite, embed, generate): the ledger
    behind the per-Model usage totals. The message holds the sum for the whole turn."""

    __tablename__ = "model_calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    model_id: Mapped[str] = mapped_column(String(200), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class SlotSetting(Base):
    """An admin override of one Slot. Absent row means the models.yaml default applies."""

    __tablename__ = "slot_settings"

    slot: Mapped[str] = mapped_column(String(16), primary_key=True)
    model_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class ModelSetting(Base):
    """An admin switch for one catalog Model. Absent row means enabled."""

    __tablename__ = "model_settings"

    model_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class Source(Base):
    """One document in the Knowledge Base. ``owner_user_id`` null means shared (curated Sources
    and Rampart's own guides); uploads belong to exactly one user and are visible only to them."""

    __tablename__ = "sources"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    owner_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    origin: Mapped[str] = mapped_column(String(1000), nullable=False)
    license_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    synthetic: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("0")
    )
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    digest: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ready")
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)

    passages: Mapped[list[Passage]] = relationship(
        back_populates="source", cascade="all, delete-orphan", passive_deletes=True
    )


class Passage(Base):
    """A retrievable piece of a Source. ``embedding_ref`` names the embedding Model whose vector
    collection holds this passage, or is null when it has no vector (keyword search only)."""

    __tablename__ = "passages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_id: Mapped[str] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    heading: Mapped[str | None] = mapped_column(String(500), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    provenance: Mapped[str] = mapped_column(String(16), nullable=False)

    source: Mapped[Source] = relationship(back_populates="passages")


class ProjectProfile(Base):
    """The stack, packages and Targets a user enters explicitly; read at the start of every turn."""

    __tablename__ = "project_profiles"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    stack: Mapped[str] = mapped_column(Text, nullable=False, default="")
    packages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False, default=list)
    target_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class KnowledgeState(Base):
    """A single row whose version changes with every change to Sources or Passages, so that
    cached keyword indexes notice ingests made by another process (the CLI)."""

    __tablename__ = "knowledge_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ToolPolicy(Base):
    """An admin override of one Tool's policy. Absent row or null field means the manifest
    default applies."""

    __tablename__ = "tool_policies"

    name: Mapped[str] = mapped_column(String(100), primary_key=True)
    enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    approver: Mapped[str | None] = mapped_column(String(16), nullable=True)
    rate_limit_per_hour: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ToolCallRecord(Base):
    """One Gateway decision, kept as the audit trail. It outlives the Conversation and the
    account it belonged to, so the references are nulled, not cascaded."""

    __tablename__ = "tool_calls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    tool: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    tool_call_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    arguments: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    args_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error_class: Mapped[str | None] = mapped_column(String(100), nullable=True)


class Approval(Base):
    """A one-time consent to run one Tool call, bound to the digest of its exact arguments."""

    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    tool_call_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    requested_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tool: Mapped[str] = mapped_column(String(100), nullable=False)
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    args_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    approver: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    decided_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class GuardEvent(Base):
    """Something a Guard did: blocked or flagged an input, flagged instruction-like text in
    untrusted content, or redacted a secret. Shown to admins."""

    __tablename__ = "guard_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    message_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    guard: Mapped[str] = mapped_column(String(16), nullable=False)
    action: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str] = mapped_column(String(48), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class Report(Base):
    """A stored Markdown Report assembled from one Conversation's Findings and Citations."""

    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    conversation_id: Mapped[str | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    markdown: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class AppSetting(Base):
    """Admin settings that live in the database (the persona, budgets, Guard flags)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class OsvCacheEntry(Base):
    """A cached OSV.dev answer for one package version."""

    __tablename__ = "osv_cache"

    key: Mapped[str] = mapped_column(String(400), primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class Target(Base):
    """A loopback application its owner may run the injection test suite against.
    The table exists from M3 so that the Gateway can check Target arguments; registration
    arrives in M4."""

    __tablename__ = "targets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    base_url: Mapped[str] = mapped_column(String(300), nullable=False)
    input_surface: Mapped[str] = mapped_column(String(32), nullable=False, default="user_message")
    profile: Mapped[str | None] = mapped_column(String(32), nullable=True)
    registered_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class Plugin(Base):
    """An MCP server from ``plugins/catalog.yaml`` as the admin has handled it.

    ``id`` is the entry's key in the catalog (the specification's Plugin name). The command and
    its arguments stay in the catalog file and are never stored or accepted from a request. This
    row holds only state: whether the admin enabled it, the Tool definitions last listed from the
    server and the ones an admin accepted, with their digests. Use is blocked whenever the two
    digests differ (drift) until an admin accepts the new definitions.
    """

    __tablename__ = "plugins"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new")
    accepted_tools_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    current_tools_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    accepted_tools: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    current_tools: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    accepted_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Feedback(Base):
    """A user's thumbs up or down on one of their assistant answers, with an optional comment.

    Capture only: it is shown to admins, forwarded as a score to the trace, and can be turned into
    an Evaluation Case by an admin. Nothing reads it to change policy, Guards, Slots, prompts or
    retrieval. It goes when its message goes (the user deleting the Conversation)."""

    __tablename__ = "feedback"
    __table_args__ = (UniqueConstraint("message_id", "user_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value: Mapped[int] = mapped_column(Integer, nullable=False)  # +1 or -1
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tools_used: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    forwarded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    forwarded_to: Mapped[str | None] = mapped_column(String(16), nullable=True)  # langfuse|jsonl
    evaluation_case_id: Mapped[str | None] = mapped_column(
        ForeignKey("evaluation_cases.id", ondelete="SET NULL"), nullable=True
    )


class EvaluationCase(Base):
    """A case an admin added to the evaluation, usually from an answer with Feedback. Authored
    cases live in eval/*.jsonl; these join the matching dataset on the next run. It keeps its
    own copy of the question, so it outlives the Conversation it came from."""

    __tablename__ = "evaluation_cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # qa | tool
    question: Mapped[str] = mapped_column(Text, nullable=False)
    expected_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_tools: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False)  # authored | feedback:<id>
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class EvalRun(Base):
    """One run of one evaluation suite: its judge, the estimate shown before it started, what it
    cost, its metrics with their denominators, and where its report was written."""

    __tablename__ = "eval_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # deepeval_qa|deepeval_tool|guard
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="running")
    judge_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    case_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    case_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)  # first N cases only
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    report_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
