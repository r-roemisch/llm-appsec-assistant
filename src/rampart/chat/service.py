"""Conversations and their messages: listing, creation, deletion, and streaming one turn."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from rampart.catalog.catalog import Catalog
from rampart.catalog.providers import ProviderProbe
from rampart.catalog.service import CatalogService
from rampart.chat.engine import ChatEngine
from rampart.chat.llm import (
    ChatModelFactory,
    GenerationSettings,
    TurnUsage,
    extract_usage,
    fetch_openrouter_cost,
    text_of,
)
from rampart.config import Settings
from rampart.db import session_scope, utcnow
from rampart.errors import Conflict, Invalid, NotFound, RampartError
from rampart.models import Conversation, Message
from rampart.schemas import message_out
from rampart.tracing import Tracer

DEFAULT_TITLE = "New conversation"
TITLE_LENGTH = 60
DISCONNECTED = "client disconnected"


@dataclass(frozen=True)
class ConversationStats:
    message_count: int
    total_cost_usd: float


@dataclass(frozen=True)
class TurnEvent:
    event: str
    data: dict[str, Any]


class ChatService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        catalog: Catalog,
        probe: ProviderProbe,
        engine: ChatEngine,
        tracer: Tracer,
        model_factory: ChatModelFactory,
        settings: Settings,
    ) -> None:
        self.session_factory = session_factory
        self.catalog = catalog
        self.probe = probe
        self.engine = engine
        self.tracer = tracer
        self.model_factory = model_factory
        self.settings = settings
        self._streaming: set[str] = set()

    def _catalog(self, db: Session) -> CatalogService:
        return CatalogService(db, self.catalog, self.probe)

    # --- reading ------------------------------------------------------------------

    def stats_for(self, db: Session, conversation_ids: list[str]) -> dict[str, ConversationStats]:
        if not conversation_ids:
            return {}
        rows = db.execute(
            select(
                Message.conversation_id,
                func.count(Message.id),
                func.coalesce(func.sum(Message.cost_usd), 0.0),
            )
            .where(Message.conversation_id.in_(conversation_ids))
            .group_by(Message.conversation_id)
        )
        found = {
            cid: ConversationStats(int(count or 0), float(cost or 0.0))  # type: ignore[arg-type]
            for cid, count, cost in rows
        }
        return {cid: found.get(cid, ConversationStats(0, 0.0)) for cid in conversation_ids}

    def list_conversations(
        self, db: Session, user_id: int
    ) -> list[tuple[Conversation, ConversationStats]]:
        conversations = list(
            db.scalars(
                select(Conversation)
                .where(Conversation.user_id == user_id)
                .order_by(Conversation.updated_at.desc(), Conversation.created_at.desc())
            )
        )
        stats = self.stats_for(db, [c.id for c in conversations])
        return [(c, stats[c.id]) for c in conversations]

    def get_conversation(self, db: Session, user_id: int, conversation_id: str) -> Conversation:
        conversation = db.get(Conversation, conversation_id)
        if conversation is None or conversation.user_id != user_id:
            raise NotFound("conversation not found")
        return conversation

    def get_detail(
        self, db: Session, user_id: int, conversation_id: str
    ) -> tuple[Conversation, ConversationStats, list[Message]]:
        conversation = self.get_conversation(db, user_id, conversation_id)
        messages = list(
            db.scalars(
                select(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at, Message.role.desc())
            )
        )
        return conversation, self.stats_for(db, [conversation.id])[conversation.id], messages

    # --- writing ------------------------------------------------------------------

    def create_conversation(
        self, db: Session, user_id: int, model_id: str | None = None, title: str | None = None
    ) -> tuple[Conversation, ConversationStats]:
        catalog = self._catalog(db)
        chosen = model_id or catalog.slot_config("chat").model.id
        spec = catalog.resolve_chat_model(chosen)
        clean_title = (title or "").strip()[:200] or DEFAULT_TITLE
        conversation = Conversation(user_id=user_id, model_id=spec.id, title=clean_title)
        db.add(conversation)
        db.flush()
        return conversation, ConversationStats(0, 0.0)

    def update_conversation(
        self,
        db: Session,
        user_id: int,
        conversation_id: str,
        *,
        title: str | None = None,
        model_id: str | None = None,
    ) -> tuple[Conversation, ConversationStats]:
        conversation = self.get_conversation(db, user_id, conversation_id)
        if title is not None:
            clean = title.strip()
            if not clean:
                raise Invalid("title must not be empty")
            conversation.title = clean[:200]
        if model_id is not None:
            conversation.model_id = self._catalog(db).resolve_chat_model(model_id).id
        conversation.updated_at = utcnow()
        db.flush()
        return conversation, self.stats_for(db, [conversation.id])[conversation.id]

    def delete_conversation(self, db: Session, user_id: int, conversation_id: str) -> None:
        conversation = self.get_conversation(db, user_id, conversation_id)
        db.delete(conversation)
        db.flush()

    # --- one turn -----------------------------------------------------------------

    async def stream_turn(
        self, *, user_id: int, conversation_id: str, content: str
    ) -> AsyncIterator[TurnEvent]:
        content = content.strip()
        if not content:
            raise Invalid("message must not be empty")
        if len(content) > self.settings.max_message_chars:
            raise Invalid(f"message is longer than {self.settings.max_message_chars} characters")
        if conversation_id in self._streaming:
            raise Conflict("a turn is already streaming for this conversation")

        with session_scope(self.session_factory) as db:
            conversation = self.get_conversation(db, user_id, conversation_id)
            catalog = self._catalog(db)
            spec = catalog.resolve_chat_model(conversation.model_id)
            chat_slot = catalog.slot_config("chat")
            generation = GenerationSettings(
                temperature=chat_slot.temperature, max_tokens=chat_slot.max_tokens
            )
            now = utcnow()
            existing = db.scalar(
                select(func.count(Message.id)).where(Message.conversation_id == conversation.id)
            )
            if conversation.title == DEFAULT_TITLE and not existing:
                conversation.title = _title_from(content)
            user_message = Message(
                conversation_id=conversation.id, role="user", content=content, created_at=now
            )
            assistant = Message(
                conversation_id=conversation.id,
                role="assistant",
                content="",
                status="streaming",
                model_id=spec.id,
                provider=spec.provider,
                created_at=now + timedelta(microseconds=1),
            )
            db.add_all([user_message, assistant])
            conversation.updated_at = now
            db.flush()
            user_out = message_out(user_message).model_dump()
            assistant_id = assistant.id

        self._streaming.add(conversation_id)
        yield TurnEvent(
            "start",
            {"user_message": user_out, "assistant_message_id": assistant_id, "model_id": spec.id},
        )

        pieces: list[str] = []
        usage: TurnUsage | None = None
        final_text: str | None = None
        error: str | None = None
        trace_id: str | None = None
        started = time.monotonic()
        try:
            llm = self.model_factory.build(spec, generation)
            with self.tracer.turn(
                user_id=user_id,
                conversation_id=conversation_id,
                model_id=spec.id,
                input_text=content,
            ) as trace:
                trace_id = trace.trace_id
                try:
                    final_message = None
                    async for chunk in self.engine.run_turn(
                        conversation_id=conversation_id,
                        llm=llm,
                        content=content,
                        callbacks=trace.callbacks,
                    ):
                        if chunk.kind == "delta":
                            pieces.append(chunk.text)
                            yield TurnEvent("delta", {"text": chunk.text})
                        elif chunk.message is not None:
                            final_message = chunk.message
                    if final_message is None:
                        raise RuntimeError("the model produced no message")
                    usage = extract_usage(final_message, spec.provider)
                    usage = await self._complete_cost(usage, spec.provider)
                    final_text = text_of(final_message.content) or "".join(pieces)
                    trace.output = final_text
                    trace.usage = usage.as_dict()
                except GeneratorExit:
                    trace.error = DISCONNECTED
                    raise
                except Exception as exc:
                    error = describe_error(exc)
                    trace.error = error
        except RampartError as exc:
            error = exc.detail
        except Exception as exc:  # the tracer or the model factory failed
            error = describe_error(exc)
        finally:
            self._streaming.discard(conversation_id)
            completed = error is None and final_text is not None
            persisted = self._finish(
                assistant_id=assistant_id,
                conversation_id=conversation_id,
                content=final_text if completed and final_text is not None else "".join(pieces),
                error=None if completed else (error or DISCONNECTED),
                usage=usage,
                trace_id=trace_id,
                latency_ms=int((time.monotonic() - started) * 1000),
            )

        if error is None:
            if usage is not None:
                yield TurnEvent(
                    "usage",
                    {
                        "input_tokens": usage.input_tokens,
                        "output_tokens": usage.output_tokens,
                        "cost_usd": usage.cost_usd,
                    },
                )
            yield TurnEvent("done", {"assistant_message": persisted})
        else:
            yield TurnEvent("error", {"message": error, "assistant_message": persisted})

    async def _complete_cost(self, usage: TurnUsage, provider: str) -> TurnUsage:
        key = self.settings.openrouter_api_key
        if usage.cost_usd is not None or provider != "openrouter" or not usage.generation_id:
            return usage
        if key is None:
            return usage
        cost = await fetch_openrouter_cost(usage.generation_id, key.get_secret_value())
        return TurnUsage(usage.input_tokens, usage.output_tokens, cost, usage.generation_id)

    def _finish(
        self,
        *,
        assistant_id: str,
        conversation_id: str,
        content: str,
        error: str | None,
        usage: TurnUsage | None,
        trace_id: str | None,
        latency_ms: int,
    ) -> dict[str, Any]:
        with session_scope(self.session_factory) as db:
            row = db.get(Message, assistant_id)
            if row is None:  # the Conversation was deleted while streaming
                return {}
            row.content = content
            row.status = "complete" if error is None else "error"
            row.error = error
            row.latency_ms = latency_ms
            row.trace_id = trace_id
            if usage is not None:
                row.input_tokens = usage.input_tokens
                row.output_tokens = usage.output_tokens
                row.cost_usd = usage.cost_usd
            conversation = db.get(Conversation, conversation_id)
            if conversation is not None:
                conversation.updated_at = utcnow()
            db.flush()
            return message_out(row).model_dump()


def describe_error(exc: BaseException) -> str:
    text = str(exc).strip()
    name = type(exc).__name__
    return f"{name}: {text}" if text else name


def _title_from(content: str) -> str:
    first_line = content.strip().splitlines()[0].strip()
    if len(first_line) <= TITLE_LENGTH:
        return first_line or DEFAULT_TITLE
    return first_line[: TITLE_LENGTH - 1].rstrip() + "…"
