"""Token and cost totals per user and per Model, read from the stored assistant messages."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rampart.models import Conversation, Message, User


@dataclass(frozen=True)
class UsageRow:
    key: str
    messages: int
    input_tokens: int
    output_tokens: int
    cost_usd: float


@dataclass(frozen=True)
class UsageTotals:
    messages: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    by_model: list[UsageRow] = field(default_factory=list)
    by_user: list[tuple[int, str, UsageRow]] = field(default_factory=list)


def _row(key: str, count: object, inp: object, out: object, cost: object) -> UsageRow:
    return UsageRow(
        key=key,
        messages=int(count or 0),  # type: ignore[call-overload]
        input_tokens=int(inp or 0),  # type: ignore[call-overload]
        output_tokens=int(out or 0),  # type: ignore[call-overload]
        cost_usd=float(cost or 0.0),  # type: ignore[arg-type]
    )


class UsageService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def for_user(self, user_id: int) -> UsageTotals:
        return self._totals(user_id=user_id)

    def for_everyone(self) -> UsageTotals:
        return self._totals(user_id=None)

    def _totals(self, user_id: int | None) -> UsageTotals:
        base = (
            select(
                func.count(Message.id),
                func.coalesce(func.sum(Message.input_tokens), 0),
                func.coalesce(func.sum(Message.output_tokens), 0),
                func.coalesce(func.sum(Message.cost_usd), 0.0),
            )
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Message.role == "assistant")
        )
        if user_id is not None:
            base = base.where(Conversation.user_id == user_id)
        overall = _row("all", *self.db.execute(base).one())

        by_model_query = base.add_columns(Message.model_id).group_by(Message.model_id)
        by_model = [
            _row(model_id or "unknown", count, inp, out, cost)
            for count, inp, out, cost, model_id in self.db.execute(by_model_query)
        ]
        by_model.sort(key=lambda row: (-row.cost_usd, row.key))

        by_user: list[tuple[int, str, UsageRow]] = []
        if user_id is None:
            by_user_query = (
                base.add_columns(User.id, User.username)
                .join(User, User.id == Conversation.user_id)
                .group_by(User.id, User.username)
            )
            for count, inp, out, cost, uid, username in self.db.execute(by_user_query):
                by_user.append((uid, username, _row(username, count, inp, out, cost)))
            by_user.sort(key=lambda item: (-item[2].cost_usd, item[1]))

        return UsageTotals(
            messages=overall.messages,
            input_tokens=overall.input_tokens,
            output_tokens=overall.output_tokens,
            cost_usd=overall.cost_usd,
            by_model=by_model,
            by_user=by_user,
        )
