"""Request and response shapes of the HTTP API (docs/API.md).

A response shape extends ``Out`` and is filled straight from the object that holds the data,
an ORM row, a dataclass or a service view, with ``XOut.model_validate(obj)``: the attribute
names match the field names, a stored datetime becomes an ISO string on the way in, and a field
typed ``Username`` turns a stored user id into the name found in the validation context. The few
converter functions left at the end of each section combine several objects into one shape.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    ValidationInfo,
    field_validator,
)
from sqlalchemy.orm import Session

from rampart.catalog.service import ModelView, SlotConfig
from rampart.db import to_iso
from rampart.models import Approval, Conversation, Feedback, Message, User
from rampart.plugins.definitions import changes, exposed_name, warnings_for
from rampart.plugins.service import PluginView
from rampart.profile.service import ECOSYSTEMS

Role = Literal["user", "admin"]


class Out(BaseModel):
    """A response shape; ``model_validate(obj)`` reads any object with the right attributes."""

    model_config = ConfigDict(from_attributes=True, validate_by_name=True)


def _iso(value: object) -> object:
    return to_iso(value) if isinstance(value, datetime) else value


def _username(value: object, info: ValidationInfo) -> object:
    """A stored user id becomes the name in ``context={"usernames": {id: name}}``, or None."""
    if isinstance(value, int) and not isinstance(value, bool):
        return (info.context or {}).get("usernames", {}).get(value)
    return value


def _username_or_id(value: object, info: ValidationInfo) -> object:
    """Like ``_username``; an id without a name (the account is gone) is shown as the id."""
    if isinstance(value, int) and not isinstance(value, bool):
        return (info.context or {}).get("usernames", {}).get(value, str(value))
    return value


def _or_empty(value: object) -> object:
    return {} if value is None else value


Timestamp = Annotated[str, BeforeValidator(_iso)]
OptionalTimestamp = Annotated[str | None, BeforeValidator(_iso)]
Username = Annotated[str | None, BeforeValidator(_username)]
Requester = Annotated[str, BeforeValidator(_username_or_id)]
JsonObject = Annotated[dict[str, Any], BeforeValidator(_or_empty)]


def _attributes(obj: object, model: type[BaseModel]) -> dict[str, Any]:
    """The attributes of ``obj`` that ``model`` has fields for, to merge with values from
    elsewhere before validating."""
    return {name: getattr(obj, name) for name in model.model_fields if hasattr(obj, name)}


def _stored_entries(model: type[BaseModel]) -> Callable[[Any], list[Any]]:
    """Reads a JSON list stored on a row; a malformed entry is skipped, never fatal."""

    def convert(stored: Any) -> list[Any]:
        entries: list[Any] = []
        for item in stored or []:
            try:
                entries.append(model.model_validate(item))
            except ValueError:
                continue
        return entries

    return convert


class UserOut(Out):
    id: int
    username: str
    role: str
    created_at: Timestamp


class SessionOut(Out):
    user: UserOut
    csrf_token: str


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class UserCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    role: Role = "user"


class PasswordResetIn(BaseModel):
    new_password: str = Field(min_length=1, max_length=256)


class ModelOut(Out):
    id: str
    provider: str
    display_name: str
    kind: str
    tier: str
    enabled: bool
    available: bool
    context_length: int | None
    notes: str | None


class SlotOut(Out):
    model_id: str
    source: Literal["default", "override"]
    temperature: float | None
    max_tokens: int | None


class ModelsOut(Out):
    models: list[ModelOut]
    slots: dict[str, SlotOut]


class SlotUpdateIn(BaseModel):
    """Any subset; a field that is absent keeps its value, ``temperature: null`` clears it."""

    model_config = ConfigDict(extra="forbid")
    model_id: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None


class ModelEnabledIn(BaseModel):
    enabled: bool


class ConversationOut(Out):
    id: str
    title: str
    model_id: str
    created_at: Timestamp
    updated_at: Timestamp
    message_count: int  # the two totals are counted separately, see conversation_out
    total_cost_usd: float
    help_mode: bool = False


class ConversationCreateIn(BaseModel):
    model_id: str | None = None
    title: str | None = Field(default=None, max_length=200)
    help_mode: bool = False


class ConversationUpdateIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    model_id: str | None = None
    help_mode: bool | None = None


class CitationOut(Out):
    n: int
    passage_id: str
    source_id: str
    source_title: str
    source_type: str
    origin: str
    heading: str | None
    snippet: str
    provenance: str


class ToolCallOut(Out):
    id: str
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    decision: str | None = None  # "allow", "deny" or "approval_required"
    reason_code: str | None = None
    message: str | None = None
    status: str | None = None  # "pending", "ok", "error", "denied" or "rejected"
    summary: str | None = None
    provenance: str | None = None
    report_id: str | None = None
    approval_id: str | None = None


class GuardEventOut(Out):
    guard: str  # "input", "provenance" or "output"
    action: str  # "blocked", "flagged" or "redacted"
    category: str
    detail: str = ""


class ApprovalOut(Out):
    id: str
    conversation_id: str
    message_id: str | None
    tool: str
    arguments: JsonObject
    approver: Literal["requester", "admin"]
    status: Literal["pending", "approved", "rejected", "expired", "consumed"]
    requested_by: Requester
    created_at: Timestamp
    expires_at: Timestamp
    decided_by: Username
    decided_at: OptionalTimestamp


class ApprovalDecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"]


_Citations = Annotated[list[CitationOut], BeforeValidator(_stored_entries(CitationOut))]
_ToolCalls = Annotated[list[ToolCallOut], BeforeValidator(_stored_entries(ToolCallOut))]
_GuardEvents = Annotated[list[GuardEventOut], BeforeValidator(_stored_entries(GuardEventOut))]


class MessageOut(Out):
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: Timestamp
    model_id: str | None
    provider: str | None
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None
    latency_ms: int | None
    trace_id: str | None
    status: str
    error: str | None
    citations: _Citations = Field(default_factory=list)
    retrieval_mode: Literal["hybrid", "bm25"] | None = None
    tool_calls: _ToolCalls = Field(default_factory=list)
    guard_events: _GuardEvents = Field(default_factory=list)
    pending_approval: ApprovalOut | None = None
    feedback: FeedbackOut | None = None  # (M6) the requesting user's own Feedback


class ConversationDetailOut(Out):
    conversation: ConversationOut
    messages: list[MessageOut]


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=32_000)


class UsageByModel(Out):
    model_id: str = Field(validation_alias="key")
    messages: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class UsageByUser(Out):
    user_id: int
    username: str = Field(validation_alias="key")
    messages: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class UsageOut(Out):
    messages: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    by_model: list[UsageByModel]


class AdminUsageOut(UsageOut):
    by_user: list[UsageByUser]


class HealthOut(Out):
    status: Literal["ok"] = "ok"
    version: str
    providers: dict[str, bool]
    tracing: str


class SourceOut(Out):
    id: str
    source_type: str
    title: str
    origin: str
    license_note: str | None
    mine: bool
    synthetic: bool
    fetched_at: Timestamp
    passage_count: int
    embedded_count: int
    size_bytes: int | None


class KnowledgeStatusOut(Out):
    retrieval_mode: Literal["hybrid", "bm25"]
    reason: str | None
    embedding_model_id: str
    embedding_available: bool
    sources: int
    passages: int
    embedded_passages: int
    uploads: int
    max_uploads: int
    max_upload_bytes: int
    upload_types: list[str]


class PassageOut(Out):
    id: str
    source_id: str
    source_title: str
    source_type: str
    origin: str
    license_note: str | None
    ordinal: int
    heading: str | None
    text: str
    provenance: str


class PackageRefModel(Out):
    model_config = ConfigDict(extra="forbid")
    ecosystem: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=214)
    version: str | None = Field(default=None, max_length=64)


class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stack: str = Field(default="", max_length=2000)
    packages: list[PackageRefModel] = Field(default_factory=list, max_length=1000)
    target_ids: list[str] = Field(default_factory=list, max_length=20)


class DependencyFileIn(BaseModel):
    """(M7) A Dependency File to read; it is parsed in memory and never stored."""

    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=5_000_000)
    filename: str | None = Field(default=None, max_length=255)
    format: (
        Literal[
            "requirements.txt",
            "uv.lock",
            "poetry.lock",
            "package-lock.json",
            "pyproject.toml",
            "package.json",
        ]
        | None
    ) = None  # None: detected from the filename or the content


class DependencyImportIn(DependencyFileIn):
    replace: bool = False  # True: the imported packages replace all packages in the profile


class ParsedPackageOut(Out):
    ecosystem: str
    name: str
    version: str | None
    pinned: bool


class DependencyFileOut(Out):
    format: str
    packages: list[ParsedPackageOut]
    pinned: int
    unpinned: int
    skipped: list[str]


class ProfileOut(Out):
    exists: bool
    stack: str
    packages: list[PackageRefModel]
    target_ids: list[str]
    updated_at: OptionalTimestamp
    ecosystems: list[str] = Field(default_factory=lambda: list(ECOSYSTEMS))


class TargetOut(Out):
    id: str
    name: str
    base_url: str
    input_surface: Literal["user_message", "document_slot"]
    profile: Literal["secure", "vulnerable"] | None
    registered_at: Timestamp


class TargetCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=100)
    base_url: str = Field(min_length=1, max_length=300)
    input_surface: Literal["user_message", "document_slot"] = "user_message"
    profile: Literal["secure", "vulnerable"] | None = None


class TargetUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, max_length=100)
    profile: Literal["secure", "vulnerable"] | None = None


class HelpDocOut(Out):
    slug: str
    title: str
    audience: Literal["everyone", "admin"]
    markdown: str


# --- converters: shapes that combine several objects --------------------------------


def model_out(view: ModelView) -> ModelOut:
    return ModelOut.model_validate(
        {**asdict(view.spec), "enabled": view.enabled, "available": view.available}
    )


def slots_out(configs: dict[str, SlotConfig]) -> dict[str, SlotOut]:
    return {slot: SlotOut.model_validate(config) for slot, config in configs.items()}


def conversation_out(
    conversation: Conversation, message_count: int, total_cost_usd: float
) -> ConversationOut:
    totals = {"message_count": message_count, "total_cost_usd": total_cost_usd}
    return ConversationOut.model_validate({**_attributes(conversation, ConversationOut), **totals})


def approval_out(approval: Approval, db: Session | None = None) -> ApprovalOut:
    """With a session, the requester and the decider are shown by username."""
    ids = [approval.requested_by, approval.decided_by]
    names = User.names(db, ids) if db is not None else {}
    return ApprovalOut.model_validate(approval, context={"usernames": names})


def message_out(
    message: Message,
    *,
    approval: Approval | None = None,
    db: Session | None = None,
    feedback: Feedback | None = None,
) -> MessageOut:
    out = MessageOut.model_validate(message)
    out.pending_approval = approval_out(approval, db) if approval is not None else None
    out.feedback = FeedbackOut.model_validate(feedback) if feedback is not None else None
    return out


# --- M3: Tools, admin controls, audit, Reports -------------------------------------


class ToolOut(Out):
    name: str
    description: str
    contributed_by: str
    enabled: bool
    requires_approval: bool
    approver: Literal["requester", "admin"]
    rate_limit_per_hour: int | None
    cost_class: str
    allowed_roles: list[str]
    json_schema: dict[str, Any]
    # (M5) Why a Plugin Tool cannot be used now: plugin_disabled, plugin_drift or plugin_missing.
    blocked: str | None = None


class ToolPolicyIn(BaseModel):
    """Any subset; ``rate_limit_per_hour: null`` restores the manifest default."""

    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool | None = None
    approver: Literal["requester", "admin"] | None = None
    rate_limit_per_hour: int | None = Field(default=None, ge=1, le=10_000)


class AdminSettingsOut(Out):
    persona: str
    persona_is_default: bool
    conversation_token_budget: int
    input_guard: bool
    input_classifier: bool


class AdminSettingsIn(BaseModel):
    """Any subset; ``persona: null`` restores the default persona."""

    model_config = ConfigDict(extra="forbid")
    persona: str | None = Field(default=None, max_length=8000)
    conversation_token_budget: int | None = Field(default=None, strict=True)
    input_guard: StrictBool | None = None
    input_classifier: StrictBool | None = None


class ToolCallRecordOut(Out):
    id: str
    created_at: Timestamp = Field(validation_alias="started_at")
    username: Username = Field(validation_alias="user_id")
    conversation_id: str | None
    tool: str
    tool_call_id: str
    decision: str
    reason_code: str
    message: str
    args_digest: str
    arguments: JsonObject
    duration_ms: int | None
    error_class: str | None


class GuardEventRecordOut(Out):
    id: int
    created_at: Timestamp
    username: Username = Field(validation_alias="user_id")
    conversation_id: str | None
    guard: str
    action: str
    category: str
    detail: str


class ReportOut(Out):
    id: str
    conversation_id: str | None
    title: str
    created_at: Timestamp
    size: int


class ReportDetailOut(ReportOut):
    markdown: str


# ---- (M5) Plugins -------------------------------------------------------------------------------

PluginStatus = Literal["new", "pending_review", "ok", "drifted", "error", "missing", "invalid"]


class PluginToolOut(Out):
    name: str  # the server's name for the Tool
    exposed_name: str | None  # what the Model and the Gateway call it; null when unusable
    title: str | None
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None
    annotations: dict[str, Any] | None
    warnings: list[str]


class PluginChangeOut(Out):
    name: str
    fields: list[str]


class PluginChangesOut(Out):
    added: list[str]
    removed: list[str]
    changed: list[PluginChangeOut]


class PluginOut(Out):
    id: str
    title: str
    description: str
    in_catalog: bool
    catalog_error: str | None  # the entry is invalid
    command: str | None  # read-only, from the catalog file, secrets redacted
    enabled: bool
    status: PluginStatus
    accepted_tools_digest: str | None
    current_tools_digest: str | None
    tool_count: int  # Tools in the last listing
    last_seen: OptionalTimestamp
    last_error: str | None
    accepted_at: OptionalTimestamp
    accepted_by: str | None


class PluginDetailOut(PluginOut):
    current_tools: list[PluginToolOut]
    accepted_tools: list[PluginToolOut]
    changes: PluginChangesOut  # accepted versus current


class PluginCatalogOut(Out):
    catalog_error: str | None  # the catalog file itself could not be read
    plugins: list[PluginOut]


class PluginUpdateIn(BaseModel):
    """Only the enabled flag. There is deliberately no way to send a command."""

    model_config = ConfigDict(extra="forbid")

    enabled: StrictBool


class PluginAcceptIn(BaseModel):
    """The digest of the definitions the admin reviewed; it must still be the current one."""

    model_config = ConfigDict(extra="forbid")

    digest: str = Field(pattern=r"^[0-9a-f]{64}$")


def plugin_out(view: PluginView, usernames: dict[int, str]) -> PluginOut:
    """A catalog entry, a stored row, or both, as one shape."""
    entry, row = view.entry, view.row
    return PluginOut(
        id=view.id,
        title=entry.title if entry is not None else view.id,
        description=entry.description if entry is not None else "",
        in_catalog=entry is not None,
        catalog_error=entry.error if entry is not None else None,
        command=entry.display_command() if entry is not None and entry.usable else None,
        enabled=bool(row.enabled) if row is not None else False,
        status=view.status,  # type: ignore[arg-type]
        accepted_tools_digest=row.accepted_tools_digest if row is not None else None,
        current_tools_digest=row.current_tools_digest if row is not None else None,
        tool_count=len(row.current_tools or []) if row is not None else 0,
        last_seen=to_iso(row.last_seen) if row is not None and row.last_seen else None,
        last_error=row.last_error if row is not None else None,
        accepted_at=to_iso(row.accepted_at) if row is not None and row.accepted_at else None,
        accepted_by=(
            usernames.get(row.accepted_by) if row is not None and row.accepted_by else None
        ),
    )


def _plugin_tool(
    plugin_id: str, definition: dict[str, Any], builtin_names: frozenset[str]
) -> PluginToolOut:
    name = str(definition.get("name"))
    schema = definition.get("input_schema")
    return PluginToolOut(
        name=name,
        exposed_name=exposed_name(plugin_id, name),
        title=definition.get("title"),
        description=str(definition.get("description") or ""),
        input_schema=schema if isinstance(schema, dict) else {},
        output_schema=definition.get("output_schema"),
        annotations=definition.get("annotations"),
        warnings=warnings_for(plugin_id, definition, builtin_names),
    )


def _plugin_tools(
    plugin_id: str, definitions: list[dict[str, Any]] | None, builtin_names: frozenset[str]
) -> list[PluginToolOut]:
    return [_plugin_tool(plugin_id, d, builtin_names) for d in definitions or []]


def plugin_detail_out(
    view: PluginView, usernames: dict[int, str], builtin_names: frozenset[str]
) -> PluginDetailOut:
    row = view.row
    current = row.current_tools if row is not None else None
    accepted = row.accepted_tools if row is not None else None
    return PluginDetailOut(
        **plugin_out(view, usernames).model_dump(),
        current_tools=_plugin_tools(view.id, current, builtin_names),
        accepted_tools=_plugin_tools(view.id, accepted, builtin_names),
        changes=PluginChangesOut.model_validate(changes(accepted, current)),
    )


# ---- (M6) Feedback and Evaluation Cases ---------------------------------------------------------


class FeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: StrictInt  # 1 (thumbs up) or -1 (thumbs down)
    comment: str | None = Field(default=None, max_length=1000)

    @field_validator("value")
    @classmethod
    def _plus_or_minus_one(cls, value: int) -> int:
        if value not in (1, -1):
            raise ValueError("value must be 1 or -1")
        return value


class FeedbackOut(Out):
    value: int
    comment: str | None
    created_at: Timestamp
    updated_at: Timestamp


class FeedbackRecordOut(Out):
    id: str
    created_at: Timestamp
    updated_at: Timestamp
    username: str | None
    value: int
    comment: str | None
    conversation_id: str
    message_id: str
    question: str | None  # the user message the answer replied to
    answer: str
    model_id: str | None
    tools_used: list[str]
    trace_id: str | None
    forwarded_to: str | None  # "langfuse", "jsonl" or null (not forwarded)
    forwarded_at: OptionalTimestamp
    evaluation_case_id: str | None


class FeedbackDashboardOut(Out):
    up: int
    down: int
    converted: int
    items: list[FeedbackRecordOut]


class EvaluationCaseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["qa", "tool"]
    question: str = Field(min_length=1, max_length=4000)
    expected_answer: str | None = Field(default=None, max_length=8000)
    expected_tools: list[str] | None = Field(default=None, max_length=10)


class EvaluationCaseOut(Out):
    id: str
    kind: str
    question: str
    expected_answer: str | None
    expected_tools: list[str] | None
    source: str  # "feedback:<feedback id>"
    created_by: Username
    created_at: Timestamp


def feedback_record_out(record: Any) -> FeedbackRecordOut:
    """A Feedback row with the answer it rates, the question before it and the rater's name."""
    row, answer = record.feedback, record.answer
    return FeedbackRecordOut(
        id=row.id,
        created_at=to_iso(row.created_at),
        updated_at=to_iso(row.updated_at),
        username=record.username,
        value=row.value,
        comment=row.comment,
        conversation_id=answer.conversation_id,
        message_id=answer.id,
        question=record.question,
        answer=answer.content,
        model_id=answer.model_id,
        tools_used=list(row.tools_used or []),
        trace_id=row.trace_id,
        forwarded_to=row.forwarded_to,
        forwarded_at=to_iso(row.forwarded_at) if row.forwarded_at else None,
        evaluation_case_id=row.evaluation_case_id,
    )


# ---- (M6) Evaluation -----------------------------------------------------------------------------

EvalSuite = Literal["qa", "tool", "guard", "all"]


class EvalEstimateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suite: EvalSuite
    limit: int | None = Field(default=None, ge=1, le=500)


class SuiteEstimateOut(Out):
    suite: str
    cases: int
    chat_model: str | None
    judge_model: str | None
    model_calls: int
    judge_calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float | None
    notes: list[str]


class EvalEstimateOut(Out):
    estimates: list[SuiteEstimateOut]
    total_usd: float | None  # null when a price is unknown


class EvalRunIn(BaseModel):
    """Start a run. ``confirm_cost_usd`` is the total the admin was shown; if the estimate has
    changed since, the server refuses and the admin reviews it again."""

    model_config = ConfigDict(extra="forbid")

    suite: EvalSuite
    limit: int | None = Field(default=None, ge=1, le=500)
    confirm_cost_usd: float | None


class EvalRunOut(Out):
    id: str
    kind: str  # deepeval_qa | deepeval_tool | guard
    suite: str  # qa | tool | guard
    status: str  # queued | running | done | failed
    judge_model: str | None
    estimated_cost_usd: float | None
    cost_usd: float | None
    case_count: int | None
    case_limit: int | None
    metrics: dict[str, Any] | None
    error: str | None
    report_name: str | None
    started_by: str | None
    created_at: Timestamp
    finished_at: OptionalTimestamp


class EvalRunDetailOut(EvalRunOut):
    report_markdown: str | None


class EvalDatasetsOut(Out):
    qa: dict[str, int]
    tool: dict[str, int]
    guard: dict[str, int]


MessageOut.model_rebuild()
ConversationDetailOut.model_rebuild()
