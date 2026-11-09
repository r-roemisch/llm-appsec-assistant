"""Request and response shapes of the HTTP API (docs/API.md) and converters from domain objects."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator
from sqlalchemy.orm import Session

from rampart.admin.settings import AdminSettings
from rampart.catalog.service import ModelView, SlotConfig
from rampart.db import to_iso
from rampart.knowledge.retrieval import PassageRecord
from rampart.knowledge.service import KnowledgeStatus, SourceView
from rampart.models import (
    Approval,
    Conversation,
    EvaluationCase,
    Feedback,
    GuardEvent,
    Message,
    Report,
    ToolCallRecord,
    User,
)
from rampart.plugins.definitions import changes, exposed_name, warnings_for
from rampart.plugins.service import PluginView
from rampart.profile.service import ECOSYSTEMS, ProfileView
from rampart.targets.service import TargetView
from rampart.usage.service import UsageTotals

Role = Literal["user", "admin"]


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    created_at: str


class SessionOut(BaseModel):
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


class ModelOut(BaseModel):
    id: str
    provider: str
    display_name: str
    kind: str
    tier: str
    enabled: bool
    available: bool
    context_length: int | None
    notes: str | None


class SlotOut(BaseModel):
    model_id: str
    source: Literal["default", "override"]
    temperature: float | None
    max_tokens: int | None


class ModelsOut(BaseModel):
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


class ConversationOut(BaseModel):
    id: str
    title: str
    model_id: str
    created_at: str
    updated_at: str
    message_count: int
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


class CitationOut(BaseModel):
    n: int
    passage_id: str
    source_id: str
    source_title: str
    source_type: str
    origin: str
    heading: str | None
    snippet: str
    provenance: str


class ToolCallOut(BaseModel):
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


class GuardEventOut(BaseModel):
    guard: str  # "input", "provenance" or "output"
    action: str  # "blocked", "flagged" or "redacted"
    category: str
    detail: str = ""


class ApprovalOut(BaseModel):
    id: str
    conversation_id: str
    message_id: str | None
    tool: str
    arguments: dict[str, Any]
    approver: Literal["requester", "admin"]
    status: Literal["pending", "approved", "rejected", "expired", "consumed"]
    requested_by: str
    created_at: str
    expires_at: str
    decided_by: str | None
    decided_at: str | None


class ApprovalDecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approve", "reject"]


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: str
    model_id: str | None
    provider: str | None
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None
    latency_ms: int | None
    trace_id: str | None
    status: str
    error: str | None
    citations: list[CitationOut] = Field(default_factory=list)
    retrieval_mode: Literal["hybrid", "bm25"] | None = None
    tool_calls: list[ToolCallOut] = Field(default_factory=list)
    guard_events: list[GuardEventOut] = Field(default_factory=list)
    pending_approval: ApprovalOut | None = None
    feedback: FeedbackOut | None = None  # (M6) the requesting user's own Feedback


class ConversationDetailOut(BaseModel):
    conversation: ConversationOut
    messages: list[MessageOut]


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=32_000)


class UsageByModel(BaseModel):
    model_id: str
    messages: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class UsageByUser(BaseModel):
    user_id: int
    username: str
    messages: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


class UsageOut(BaseModel):
    messages: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    by_model: list[UsageByModel]


class AdminUsageOut(UsageOut):
    by_user: list[UsageByUser]


class HealthOut(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    providers: dict[str, bool]
    tracing: str


class SourceOut(BaseModel):
    id: str
    source_type: str
    title: str
    origin: str
    license_note: str | None
    mine: bool
    synthetic: bool
    fetched_at: str
    passage_count: int
    embedded_count: int
    size_bytes: int | None


class KnowledgeStatusOut(BaseModel):
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


class PassageOut(BaseModel):
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


class PackageRefModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ecosystem: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=214)
    version: str | None = Field(default=None, max_length=64)


class ProfileIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stack: str = Field(default="", max_length=2000)
    packages: list[PackageRefModel] = Field(default_factory=list, max_length=50)
    target_ids: list[str] = Field(default_factory=list, max_length=20)


class ProfileOut(BaseModel):
    exists: bool
    stack: str
    packages: list[PackageRefModel]
    target_ids: list[str]
    updated_at: str | None
    ecosystems: list[str]


class TargetOut(BaseModel):
    id: str
    name: str
    base_url: str
    input_surface: Literal["user_message", "document_slot"]
    profile: Literal["secure", "vulnerable"] | None
    registered_at: str


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


class HelpDocOut(BaseModel):
    slug: str
    title: str
    audience: Literal["everyone", "admin"]
    markdown: str


# --- converters -------------------------------------------------------------------


def user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id, username=user.username, role=user.role, created_at=to_iso(user.created_at)
    )


def model_out(view: ModelView) -> ModelOut:
    spec = view.spec
    return ModelOut(
        id=spec.id,
        provider=spec.provider,
        display_name=spec.display_name,
        kind=spec.kind,
        tier=spec.tier,
        enabled=view.enabled,
        available=view.available,
        context_length=spec.context_length,
        notes=spec.notes,
    )


def slot_out(config: SlotConfig) -> SlotOut:
    return SlotOut(
        model_id=config.model.id,
        source=config.source,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
    )


def slots_out(configs: dict[str, SlotConfig]) -> dict[str, SlotOut]:
    return {slot: slot_out(config) for slot, config in configs.items()}


def conversation_out(
    conversation: Conversation, message_count: int, total_cost_usd: float
) -> ConversationOut:
    return ConversationOut(
        id=conversation.id,
        title=conversation.title,
        model_id=conversation.model_id,
        created_at=to_iso(conversation.created_at),
        updated_at=to_iso(conversation.updated_at),
        message_count=message_count,
        total_cost_usd=total_cost_usd,
        help_mode=bool(conversation.help_mode),
    )


def citations_out(stored: list[dict[str, Any]] | None) -> list[CitationOut]:
    out: list[CitationOut] = []
    for item in stored or []:
        try:
            out.append(CitationOut.model_validate(item))
        except ValueError:
            continue  # a malformed stored entry is skipped, never fatal
    return out


def _usernames(db: Session | None, *ids: int | None) -> dict[int, str]:
    wanted = {i for i in ids if i is not None}
    if db is None or not wanted:
        return {}
    return {u.id: u.username for u in db.query(User).filter(User.id.in_(wanted))}


def approval_out(approval: Approval, db: Session | None = None) -> ApprovalOut:
    names = _usernames(db, approval.requested_by, approval.decided_by)
    return ApprovalOut(
        id=approval.id,
        conversation_id=approval.conversation_id,
        message_id=approval.message_id,
        tool=approval.tool,
        arguments=dict(approval.arguments or {}),
        approver=approval.approver,  # type: ignore[arg-type]
        status=approval.status,  # type: ignore[arg-type]
        requested_by=names.get(approval.requested_by, str(approval.requested_by)),
        created_at=to_iso(approval.created_at),
        expires_at=to_iso(approval.expires_at),
        decided_by=names.get(approval.decided_by) if approval.decided_by is not None else None,
        decided_at=to_iso(approval.decided_at) if approval.decided_at else None,
    )


def _entries(model: type[BaseModel], stored: list[dict[str, Any]] | None) -> list[Any]:
    out: list[Any] = []
    for item in stored or []:
        try:
            out.append(model.model_validate(item))
        except ValueError:
            continue
    return out


def message_out(
    message: Message,
    *,
    approval: Approval | None = None,
    db: Session | None = None,
    feedback: Feedback | None = None,
) -> MessageOut:
    return MessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        content=message.content,
        created_at=to_iso(message.created_at),
        model_id=message.model_id,
        provider=message.provider,
        input_tokens=message.input_tokens,
        output_tokens=message.output_tokens,
        cost_usd=message.cost_usd,
        latency_ms=message.latency_ms,
        trace_id=message.trace_id,
        status=message.status,
        error=message.error,
        citations=citations_out(message.citations),
        retrieval_mode=message.retrieval_mode,  # type: ignore[arg-type]
        tool_calls=_entries(ToolCallOut, message.tool_calls),
        guard_events=_entries(GuardEventOut, message.guard_events),
        pending_approval=approval_out(approval, db) if approval is not None else None,
        feedback=feedback_out(feedback) if feedback is not None else None,
    )


def usage_out(totals: UsageTotals) -> UsageOut:
    return UsageOut(
        messages=totals.messages,
        input_tokens=totals.input_tokens,
        output_tokens=totals.output_tokens,
        cost_usd=totals.cost_usd,
        by_model=[
            UsageByModel(
                model_id=row.key,
                messages=row.messages,
                input_tokens=row.input_tokens,
                output_tokens=row.output_tokens,
                cost_usd=row.cost_usd,
            )
            for row in totals.by_model
        ],
    )


def admin_usage_out(totals: UsageTotals) -> AdminUsageOut:
    base = usage_out(totals)
    return AdminUsageOut(
        **base.model_dump(),
        by_user=[
            UsageByUser(
                user_id=user_id,
                username=username,
                messages=row.messages,
                input_tokens=row.input_tokens,
                output_tokens=row.output_tokens,
                cost_usd=row.cost_usd,
            )
            for user_id, username, row in totals.by_user
        ],
    )


def source_out(view: SourceView) -> SourceOut:
    return SourceOut(
        id=view.id,
        source_type=view.source_type,
        title=view.title,
        origin=view.origin,
        license_note=view.license_note,
        mine=view.mine,
        synthetic=view.synthetic,
        fetched_at=to_iso(view.fetched_at),
        passage_count=view.passage_count,
        embedded_count=view.embedded_count,
        size_bytes=view.size_bytes,
    )


def knowledge_status_out(status: KnowledgeStatus) -> KnowledgeStatusOut:
    return KnowledgeStatusOut(
        retrieval_mode=status.retrieval_mode,  # type: ignore[arg-type]
        reason=status.reason,
        embedding_model_id=status.embedding_model_id,
        embedding_available=status.embedding_available,
        sources=status.sources,
        passages=status.passages,
        embedded_passages=status.embedded_passages,
        uploads=status.uploads,
        max_uploads=status.max_uploads,
        max_upload_bytes=status.max_upload_bytes,
        upload_types=status.upload_types,
    )


def passage_out(record: PassageRecord) -> PassageOut:
    return PassageOut(
        id=record.id,
        source_id=record.source_id,
        source_title=record.source_title,
        source_type=record.source_type,
        origin=record.origin,
        license_note=record.license_note,
        ordinal=record.ordinal,
        heading=record.heading,
        text=record.text,
        provenance=record.provenance,
    )


def target_out(view: TargetView) -> TargetOut:
    return TargetOut(
        id=view.id,
        name=view.name,
        base_url=view.base_url,
        input_surface=view.input_surface,  # type: ignore[arg-type]
        profile=view.profile,  # type: ignore[arg-type]
        registered_at=to_iso(view.registered_at),
    )


def profile_out(view: ProfileView) -> ProfileOut:
    return ProfileOut(
        exists=view.exists,
        stack=view.stack,
        packages=[
            PackageRefModel(ecosystem=p.ecosystem, name=p.name, version=p.version)
            for p in view.packages
        ],
        target_ids=view.target_ids,
        updated_at=to_iso(view.updated_at) if view.updated_at else None,
        ecosystems=list(ECOSYSTEMS),
    )


# --- M3: Tools, admin controls, audit, Reports -------------------------------------


class ToolOut(BaseModel):
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


class AdminSettingsOut(BaseModel):
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


class ToolCallRecordOut(BaseModel):
    id: str
    created_at: str
    username: str | None
    conversation_id: str | None
    tool: str
    tool_call_id: str
    decision: str
    reason_code: str
    message: str
    args_digest: str
    arguments: dict[str, Any]
    duration_ms: int | None
    error_class: str | None


class GuardEventRecordOut(BaseModel):
    id: int
    created_at: str
    username: str | None
    conversation_id: str | None
    guard: str
    action: str
    category: str
    detail: str


class ReportOut(BaseModel):
    id: str
    conversation_id: str | None
    title: str
    created_at: str
    size: int


class ReportDetailOut(ReportOut):
    markdown: str


def tool_out(manifest: Any) -> ToolOut:
    return ToolOut(
        name=manifest.name,
        description=manifest.description,
        contributed_by=manifest.contributed_by,
        enabled=manifest.enabled,
        requires_approval=manifest.requires_approval,
        approver=manifest.approver,
        rate_limit_per_hour=manifest.rate_limit_per_hour,
        cost_class=manifest.cost_class,
        allowed_roles=list(manifest.allowed_roles),
        json_schema=manifest.json_schema,
        blocked=manifest.blocked,
    )


def admin_settings_out(settings: AdminSettings) -> AdminSettingsOut:
    return AdminSettingsOut(
        persona=settings.persona,
        persona_is_default=settings.persona_is_default,
        conversation_token_budget=settings.conversation_token_budget,
        input_guard=settings.input_guard,
        input_classifier=settings.input_classifier,
    )


def tool_call_record_out(record: ToolCallRecord, usernames: dict[int, str]) -> ToolCallRecordOut:
    return ToolCallRecordOut(
        id=record.id,
        created_at=to_iso(record.started_at),
        username=usernames.get(record.user_id) if record.user_id is not None else None,
        conversation_id=record.conversation_id,
        tool=record.tool,
        tool_call_id=record.tool_call_id,
        decision=record.decision,
        reason_code=record.reason_code,
        message=record.message,
        args_digest=record.args_digest,
        arguments=dict(record.arguments or {}),
        duration_ms=record.duration_ms,
        error_class=record.error_class,
    )


def guard_event_record_out(event: GuardEvent, usernames: dict[int, str]) -> GuardEventRecordOut:
    return GuardEventRecordOut(
        id=event.id,
        created_at=to_iso(event.created_at),
        username=usernames.get(event.user_id) if event.user_id is not None else None,
        conversation_id=event.conversation_id,
        guard=event.guard,
        action=event.action,
        category=event.category,
        detail=event.detail,
    )


def report_out(report: Report) -> ReportOut:
    return ReportOut(
        id=report.id,
        conversation_id=report.conversation_id,
        title=report.title,
        created_at=to_iso(report.created_at),
        size=len(report.markdown),
    )


def report_detail_out(report: Report) -> ReportDetailOut:
    return ReportDetailOut(**report_out(report).model_dump(), markdown=report.markdown)


# ---- (M5) Plugins -------------------------------------------------------------------------------

PluginStatus = Literal["new", "pending_review", "ok", "drifted", "error", "missing", "invalid"]


class PluginToolOut(BaseModel):
    name: str  # the server's name for the Tool
    exposed_name: str | None  # what the Model and the Gateway call it; null when unusable
    title: str | None
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None
    annotations: dict[str, Any] | None
    warnings: list[str]


class PluginChangeOut(BaseModel):
    name: str
    fields: list[str]


class PluginChangesOut(BaseModel):
    added: list[str]
    removed: list[str]
    changed: list[PluginChangeOut]


class PluginOut(BaseModel):
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
    last_seen: str | None
    last_error: str | None
    accepted_at: str | None
    accepted_by: str | None


class PluginDetailOut(PluginOut):
    current_tools: list[PluginToolOut]
    accepted_tools: list[PluginToolOut]
    changes: PluginChangesOut  # accepted versus current


class PluginCatalogOut(BaseModel):
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


class FeedbackOut(BaseModel):
    value: int
    comment: str | None
    created_at: str
    updated_at: str


class FeedbackRecordOut(BaseModel):
    id: str
    created_at: str
    updated_at: str
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
    forwarded_at: str | None
    evaluation_case_id: str | None


class FeedbackDashboardOut(BaseModel):
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


class EvaluationCaseOut(BaseModel):
    id: str
    kind: str
    question: str
    expected_answer: str | None
    expected_tools: list[str] | None
    source: str  # "feedback:<feedback id>"
    created_by: str | None
    created_at: str


def feedback_out(row: Feedback) -> FeedbackOut:
    return FeedbackOut(
        value=row.value,
        comment=row.comment,
        created_at=to_iso(row.created_at),
        updated_at=to_iso(row.updated_at),
    )


def feedback_record_out(record: Any) -> FeedbackRecordOut:
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


def evaluation_case_out(case: EvaluationCase, usernames: dict[int, str]) -> EvaluationCaseOut:
    return EvaluationCaseOut(
        id=case.id,
        kind=case.kind,
        question=case.question,
        expected_answer=case.expected_answer,
        expected_tools=case.expected_tools,
        source=case.source,
        created_by=usernames.get(case.created_by) if case.created_by else None,
        created_at=to_iso(case.created_at),
    )


# ---- (M6) Evaluation -----------------------------------------------------------------------------

EvalSuite = Literal["qa", "tool", "guard", "all"]


class EvalEstimateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    suite: EvalSuite
    limit: int | None = Field(default=None, ge=1, le=500)


class SuiteEstimateOut(BaseModel):
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


class EvalEstimateOut(BaseModel):
    estimates: list[SuiteEstimateOut]
    total_usd: float | None  # null when a price is unknown


class EvalRunIn(BaseModel):
    """Start a run. ``confirm_cost_usd`` is the total the admin was shown; if the estimate has
    changed since, the server refuses and the admin reviews it again."""

    model_config = ConfigDict(extra="forbid")

    suite: EvalSuite
    limit: int | None = Field(default=None, ge=1, le=500)
    confirm_cost_usd: float | None


class EvalRunOut(BaseModel):
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
    created_at: str
    finished_at: str | None


class EvalRunDetailOut(EvalRunOut):
    report_markdown: str | None


class EvalDatasetsOut(BaseModel):
    qa: dict[str, int]
    tool: dict[str, int]
    guard: dict[str, int]


MessageOut.model_rebuild()
ConversationDetailOut.model_rebuild()
