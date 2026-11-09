"""The usage ledger of one turn: every Model call is written to ``model_calls`` as it happens
and summed into the assistant message.

A turn makes several calls (routing, grading, query rewriting, query embedding, the answer),
possibly on different Models. Writing each call at once keeps the per-Model totals right and
survives a turn that fails half-way: what was spent is recorded. A turn's cost is unknown
(null) when any of its calls reported no cost.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from langchain_core.messages import AIMessage
from pydantic import SecretStr
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from rampart.catalog.catalog import ModelSpec
from rampart.chat.llm import TurnUsage, extract_usage, fetch_openrouter_cost
from rampart.db import session_scope
from rampart.models import ModelCall


@dataclass(frozen=True)
class CallRecord:
    purpose: str
    model_id: str
    provider: str
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None


class UsageLedger:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        message_id: str,
        openrouter_key: SecretStr | None,
    ) -> None:
        self.session_factory = session_factory
        self.message_id = message_id
        self.openrouter_key = openrouter_key
        self.records: list[CallRecord] = []

    async def record_chat(self, purpose: str, spec: ModelSpec, message: AIMessage) -> CallRecord:
        usage = extract_usage(message, spec.provider)
        cost = usage.cost_usd
        if (
            cost is None
            and spec.provider == "openrouter"
            and usage.generation_id
            and self.openrouter_key is not None
        ):
            cost = await fetch_openrouter_cost(
                usage.generation_id, self.openrouter_key.get_secret_value()
            )
        return self._add(
            CallRecord(
                purpose, spec.id, spec.provider, usage.input_tokens, usage.output_tokens, cost
            )
        )

    def record_embedding(
        self, spec: ModelSpec, input_tokens: int | None, cost_usd: float | None
    ) -> None:
        cost = 0.0 if spec.provider == "ollama" else cost_usd
        self._add(CallRecord("embed", spec.id, spec.provider, input_tokens, 0, cost))

    def _add(self, record: CallRecord) -> CallRecord:
        self.records.append(record)
        try:
            with session_scope(self.session_factory) as db:
                db.add(ModelCall(message_id=self.message_id, **asdict(record)))
        except IntegrityError:
            pass  # the Conversation was deleted while the turn ran
        return record

    def totals(self) -> TurnUsage | None:
        if not self.records:
            return None
        inputs = [r.input_tokens for r in self.records if r.input_tokens is not None]
        outputs = [r.output_tokens for r in self.records if r.output_tokens is not None]
        costs = [r.cost_usd for r in self.records]
        return TurnUsage(
            input_tokens=sum(inputs) if inputs else None,
            output_tokens=sum(outputs) if outputs else None,
            cost_usd=None if any(c is None for c in costs) else sum(c or 0.0 for c in costs),
        )

    def summary(self) -> list[dict[str, object]]:
        return [asdict(record) for record in self.records]
