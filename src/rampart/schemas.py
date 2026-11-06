"""Request and response shapes of the HTTP API (docs/API.md) and converters from domain objects."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from rampart.catalog.service import ModelView, SlotConfig
from rampart.db import to_iso
from rampart.models import Conversation, Message, User
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


class ConversationCreateIn(BaseModel):
    model_id: str | None = None
    title: str | None = Field(default=None, max_length=200)


class ConversationUpdateIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    model_id: str | None = None


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
    )


def message_out(message: Message) -> MessageOut:
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
