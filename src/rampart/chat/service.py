"""Conversations and their messages: listing, creation, deletion, streaming a turn, and resuming
a turn that waited for an Approval."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from rampart.admin.settings import AdminSettingsService
from rampart.catalog.catalog import Catalog, ModelSpec
from rampart.catalog.providers import ProviderProbe, model_available
from rampart.catalog.service import CatalogService
from rampart.chat.citable import CitableRegistry
from rampart.chat.engine import ChatEngine
from rampart.chat.graph import Grader, TurnContext, TurnLimits
from rampart.chat.ledger import UsageLedger
from rampart.chat.llm import ChatModelFactory, GenerationSettings, TurnUsage
from rampart.chat.prompts import BUDGET_NOTICE
from rampart.chat.toolset import ToolSet
from rampart.config import Settings
from rampart.db import session_scope, utcnow
from rampart.errors import Conflict, Invalid, NotFound, RampartError
from rampart.gateway.approvals import ApprovalService
from rampart.gateway.gateway import Gateway
from rampart.guards.input_guard import InputVerdict, check_input
from rampart.guards.stream import StreamingRedactor
from rampart.knowledge.retrieval import SOURCE_TYPES
from rampart.knowledge.service import KnowledgeService
from rampart.models import Approval, Conversation, GuardEvent, Message, ModelCall, User
from rampart.profile.service import ProfileService, profile_block
from rampart.schemas import approval_out, message_out
from rampart.targets.service import TargetService
from rampart.tools.registry import ToolContext, ToolRegistry
from rampart.tracing import Tracer

DEFAULT_TITLE = "New conversation"
TITLE_LENGTH = 60
DISCONNECTED = "client disconnected"
HELP_SOURCE_TYPES = ("app_docs",)
AWAITING = "awaiting_approval"


@dataclass(frozen=True)
class ConversationStats:
    message_count: int
    total_cost_usd: float


@dataclass(frozen=True)
class TurnEvent:
    event: str
    data: dict[str, Any]


def conversation_tokens(db: Session, conversation_id: str) -> int:
    total = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    func.coalesce(ModelCall.input_tokens, 0)
                    + func.coalesce(ModelCall.output_tokens, 0)
                ),
                0,
            )
        )
        .join(Message, Message.id == ModelCall.message_id)
        .where(Message.conversation_id == conversation_id)
    )
    return int(total or 0)


def message_totals(db: Session, message_id: str) -> TurnUsage | None:
    rows = db.execute(
        select(ModelCall.input_tokens, ModelCall.output_tokens, ModelCall.cost_usd).where(
            ModelCall.message_id == message_id
        )
    ).all()
    if not rows:
        return None
    inputs: list[int] = [value for value, _, _ in rows if value is not None]
    outputs: list[int] = [value for _, value, _ in rows if value is not None]
    costs = [r[2] for r in rows]
    return TurnUsage(
        input_tokens=sum(inputs) if inputs else None,
        output_tokens=sum(outputs) if outputs else None,
        cost_usd=None if any(c is None for c in costs) else sum(c or 0.0 for c in costs),
    )


def _merge(entries: list[dict[str, Any]], update: dict[str, Any]) -> list[dict[str, Any]]:
    for index, entry in enumerate(entries):
        if entry.get("id") == update.get("id"):
            entries[index] = {**entry, **{k: v for k, v in update.items() if v is not None}}
            return entries
    entries.append(dict(update))
    return entries


@dataclass
class _Turn:
    """What one streamed segment (a new turn or a resumption) needs and accumulates."""

    user_id: int
    role: str
    username: str
    conversation_id: str
    assistant_id: str
    spec: ModelSpec
    generation: GenerationSettings
    help_mode: bool
    persona: str
    budget: int
    input_classifier: bool
    profile: str | None
    content: str  # the redacted user message (empty when resuming)
    verdict: InputVerdict | None
    prior_text: str = ""
    tool_calls: list[dict[str, Any]] | None = None
    guard_events: list[dict[str, Any]] | None = None


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
        knowledge: KnowledgeService | None = None,
        registry: ToolRegistry | None = None,
        gateway: Gateway | None = None,
        target_transport: Any = None,
    ) -> None:
        self.session_factory = session_factory
        self.catalog = catalog
        self.probe = probe
        self.engine = engine
        self.tracer = tracer
        self.model_factory = model_factory
        self.settings = settings
        self.knowledge = knowledge
        self.registry = registry
        self.gateway = gateway
        self.target_transport = target_transport
        self._streaming: set[str] = set()

    def _catalog(self, db: Session) -> CatalogService:
        return CatalogService(db, self.catalog, self.probe)

    def _limits(self) -> TurnLimits:
        s = self.settings  # the other limits are fixed in TurnLimits
        return TurnLimits(
            max_rewrites=s.max_rewrites,
            history_summary_tokens=s.history_summary_tokens,
            history_keep_turns=s.history_keep_turns,
        )

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
    ) -> tuple[Conversation, ConversationStats, list[Message], dict[str, Approval]]:
        conversation = self.get_conversation(db, user_id, conversation_id)
        messages = list(
            db.scalars(
                select(Message)
                .where(Message.conversation_id == conversation.id)
                .order_by(Message.created_at, Message.role.desc())
            )
        )
        awaiting = [m.id for m in messages if m.status == AWAITING]
        approvals = ApprovalService(db).latest_for_messages(awaiting)
        stats = self.stats_for(db, [conversation.id])[conversation.id]
        return conversation, stats, messages, approvals

    # --- writing ------------------------------------------------------------------

    def create_conversation(
        self,
        db: Session,
        user_id: int,
        model_id: str | None = None,
        title: str | None = None,
        help_mode: bool = False,
    ) -> tuple[Conversation, ConversationStats]:
        catalog = self._catalog(db)
        chosen = model_id or catalog.slot_config("chat").model.id
        spec = catalog.resolve_chat_model(chosen)
        clean_title = (title or "").strip()[:200] or DEFAULT_TITLE
        conversation = Conversation(
            user_id=user_id, model_id=spec.id, title=clean_title, help_mode=help_mode
        )
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
        help_mode: bool | None = None,
    ) -> tuple[Conversation, ConversationStats]:
        conversation = self.get_conversation(db, user_id, conversation_id)
        if title is not None:
            clean = title.strip()
            if not clean:
                raise Invalid("title must not be empty")
            conversation.title = clean[:200]
        if model_id is not None:
            conversation.model_id = self._catalog(db).resolve_chat_model(model_id).id
        if help_mode is not None:
            conversation.help_mode = help_mode
        conversation.updated_at = utcnow()
        db.flush()
        return conversation, self.stats_for(db, [conversation.id])[conversation.id]

    def delete_conversation(self, db: Session, user_id: int, conversation_id: str) -> None:
        conversation = self.get_conversation(db, user_id, conversation_id)
        db.delete(conversation)
        db.flush()

    # --- one turn -----------------------------------------------------------------

    def _awaiting(self, db: Session, conversation_id: str) -> Message | None:
        return db.scalar(
            select(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.role == "assistant",
                Message.status == AWAITING,
            )
            .order_by(Message.created_at.desc())
        )

    def _turn_settings(self, db: Session, conversation: Conversation, user: User) -> dict[str, Any]:
        catalog = self._catalog(db)
        spec = catalog.resolve_chat_model(conversation.model_id)
        chat_slot = catalog.slot_config("chat")
        admin = AdminSettingsService(db, self.settings).get()
        return {
            "spec": spec,
            "generation": GenerationSettings(chat_slot.temperature, chat_slot.max_tokens),
            "help_mode": bool(conversation.help_mode),
            "persona": admin.persona,
            "budget": admin.conversation_token_budget,
            "input_guard": admin.input_guard,
            "input_classifier": admin.input_classifier,
            "profile": profile_block(
                ProfileService(db).get(user.id),
                [(t.name, t.id, t.base_url) for t in TargetService(db).list(user.id)],
            ),
        }

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
            if self._awaiting(db, conversation.id) is not None:
                raise Conflict(
                    "this conversation is waiting for an approval: approve or reject it first"
                )
            user = db.get(User, user_id)
            assert user is not None
            info = self._turn_settings(db, conversation, user)
            verdict = check_input(content, heuristics=info["input_guard"])
            used = conversation_tokens(db, conversation.id)
            now = utcnow()
            existing = db.scalar(
                select(func.count(Message.id)).where(Message.conversation_id == conversation.id)
            )
            if conversation.title == DEFAULT_TITLE and not existing:
                conversation.title = _title_from(verdict.text)
            user_message = Message(
                conversation_id=conversation.id, role="user", content=verdict.text, created_at=now
            )
            spec: ModelSpec = info["spec"]
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
            turn = _Turn(
                user_id=user_id,
                role=user.role,
                username=user.username,
                conversation_id=conversation.id,
                assistant_id=assistant_id,
                spec=spec,
                generation=info["generation"],
                help_mode=info["help_mode"],
                persona=info["persona"],
                budget=info["budget"],
                input_classifier=info["input_classifier"],
                profile=info["profile"],
                content=verdict.text,
                verdict=verdict,
                tool_calls=[],
                guard_events=[],
            )

        self._streaming.add(conversation_id)
        yield TurnEvent(
            "start",
            {"user_message": user_out, "assistant_message_id": assistant_id, "model_id": spec.id},
        )
        for entry in self._input_guard_events(turn, verdict):
            yield TurnEvent("guard", entry)
        if used >= turn.budget:
            notice = BUDGET_NOTICE.format(used=used, budget=turn.budget)
            self._streaming.discard(conversation_id)
            persisted = self._persist(
                turn,
                text=notice,
                status="complete",
                error=None,
                citations=[],
                retrieval_mode=None,
                trace_id=None,
                latency_ms=0,
            )
            yield TurnEvent("delta", {"text": notice})
            yield TurnEvent("notice", {"kind": "budget", "message": notice})
            yield TurnEvent("done", {"assistant_message": persisted})
            return
        async for event in self._drive(turn, resume=None):
            yield event

    async def resume_turn(
        self,
        *,
        user_id: int,
        conversation_id: str,
        approval_id: str,
        decision: str | None,
    ) -> AsyncIterator[TurnEvent]:
        """Decide (``approve``/``reject``) and continue, or just continue after an admin decided."""
        if conversation_id in self._streaming:
            raise Conflict("a turn is already streaming for this conversation")
        with session_scope(self.session_factory) as db:
            conversation = self.get_conversation(db, user_id, conversation_id)
            approvals = ApprovalService(db)
            approval = approvals.for_conversation(approval_id, conversation.id, user_id)
            user = db.get(User, user_id)
            assert user is not None
            if decision is not None:
                approvals.decide(approval, user, decision)
            elif approval.status == "pending" and approval.expires_at <= utcnow():
                approval.status = "expired"
            if approval.status == "pending":
                raise Conflict("the approval is still pending")
            message = db.get(Message, approval.message_id) if approval.message_id else None
            if message is None or message.status != AWAITING:
                raise Conflict("this turn is not waiting for an approval")
            info = self._turn_settings(db, conversation, user)
            message.status = "streaming"
            turn = _Turn(
                user_id=user_id,
                role=user.role,
                username=user.username,
                conversation_id=conversation.id,
                assistant_id=message.id,
                spec=info["spec"],
                generation=info["generation"],
                help_mode=info["help_mode"],
                persona=info["persona"],
                budget=info["budget"],
                input_classifier=False,
                profile=info["profile"],
                content="",
                verdict=None,
                prior_text=message.content,
                tool_calls=list(message.tool_calls or []),
                guard_events=list(message.guard_events or []),
            )
            resume_value = {"approval_id": approval.id, "status": approval.status}
            approval_data = approval_out(approval, db).model_dump()

        self._streaming.add(conversation_id)
        yield TurnEvent(
            "resume", {"assistant_message_id": turn.assistant_id, "approval": approval_data}
        )
        async for event in self._drive(turn, resume=resume_value):
            yield event

    def _record_guard(
        self, turn: _Turn, guard: str, action: str, category: str, detail: str
    ) -> dict[str, Any]:
        entry = {"guard": guard, "action": action, "category": category, "detail": detail[:300]}
        with session_scope(self.session_factory) as db:
            db.add(
                GuardEvent(
                    user_id=turn.user_id,
                    conversation_id=turn.conversation_id,
                    message_id=turn.assistant_id,
                    **entry,
                )
            )
        assert turn.guard_events is not None
        turn.guard_events.append(entry)
        return entry

    def _input_guard_events(self, turn: _Turn, verdict: InputVerdict) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        if verdict.secrets:
            kinds = ", ".join(f"{n} {k}" for k, n in sorted(verdict.secrets.items()))
            events.append(
                self._record_guard(
                    turn,
                    "input",
                    "redacted",
                    "secret_in_input",
                    f"Removed from your message before any model saw it: {kinds}. "
                    "Rotate these credentials.",
                )
            )
        if verdict.hidden_text:
            events.append(
                self._record_guard(
                    turn,
                    "input",
                    "redacted",
                    "hidden_text",
                    "Invisible Unicode characters were removed.",
                )
            )
        if verdict.blocked:
            events.append(
                self._record_guard(
                    turn,
                    "input",
                    "blocked",
                    ",".join(verdict.categories) or "injection",
                    "; ".join(verdict.snippets)[:300],
                )
            )
        elif verdict.analysis:
            events.append(
                self._record_guard(
                    turn,
                    "input",
                    "flagged",
                    ",".join(verdict.categories) or "injection",
                    "Attack-like text framed as a question or quotation; passed as data.",
                )
            )
        return events

    def _context(self, turn: _Turn, ledger: UsageLedger) -> TurnContext:
        llm = self.model_factory.build(turn.spec, turn.generation)
        citable = CitableRegistry()
        knowledge = None
        grader: Grader | None = None
        tools: ToolSet | None = None
        with session_scope(self.session_factory) as db:
            if self.knowledge is not None:
                knowledge = self.knowledge.turn_search(
                    db,
                    user_id=turn.user_id,
                    source_types=HELP_SOURCE_TYPES if turn.help_mode else SOURCE_TYPES,
                    usage=ledger,
                )
            catalog = self._catalog(db)
            grader_slot = catalog.slot_config("grader")
            grader_ready = catalog.is_enabled(grader_slot.model.id) and model_available(
                grader_slot.model.provider, grader_slot.model.provider_model_name, self.probe
            )
            if self.registry is not None and self.gateway is not None:
                offered = self.registry.available_to(db, turn.role)
                if turn.help_mode:
                    offered = [m for m in offered if m.name == "search_knowledge"]
                tools = ToolSet(
                    registry=self.registry,
                    gateway=self.gateway,
                    offered=offered,
                    context=ToolContext(
                        user_id=turn.user_id,
                        role=turn.role,
                        conversation_id=turn.conversation_id,
                        message_id=turn.assistant_id,
                        session_factory=self.session_factory,
                        settings=self.settings,
                        knowledge=knowledge,
                        citable=citable,
                        help_mode=turn.help_mode,
                        target_transport=self.target_transport,
                    ),
                    budget=lambda: self._budget(turn),
                )
        if grader_ready:  # routing, grading, the classifier and summarising history use it
            try:
                grader = Grader(
                    self.model_factory.build(
                        grader_slot.model,
                        GenerationSettings(grader_slot.temperature, grader_slot.max_tokens),
                        purpose="grader",
                    ),
                    grader_slot.model,
                )
            except Exception:  # without a grader the search still runs, ungraded
                grader = None
        return TurnContext(
            chat_llm=llm,
            chat_spec=turn.spec,
            ledger=ledger,
            username=turn.username,
            profile=turn.profile,
            help_mode=turn.help_mode,
            persona=turn.persona,
            grader=grader,
            knowledge=knowledge,
            tools=tools,
            input_verdict=turn.verdict,
            input_classifier=turn.input_classifier,
            budget=lambda: self._budget(turn),
            guard=lambda g, a, c, d: self._record_guard(turn, g, a, c, d),
            limits=self._limits(),
            citable=citable,
        )

    def _budget(self, turn: _Turn) -> tuple[int, int | None]:
        with session_scope(self.session_factory) as db:
            return conversation_tokens(db, turn.conversation_id), turn.budget

    async def _drive(
        self, turn: _Turn, *, resume: dict[str, Any] | None
    ) -> AsyncIterator[TurnEvent]:
        ledger = UsageLedger(
            self.session_factory, turn.assistant_id, self.settings.openrouter_api_key
        )
        redactor = StreamingRedactor()
        citations: list[dict[str, Any]] = []
        retrieval_mode: str | None = None
        error: str | None = None
        trace_id: str | None = None
        interrupted: dict[str, Any] | None = None
        completed = False
        started = time.monotonic()
        summary: dict[str, Any] = {}
        assert turn.tool_calls is not None and turn.guard_events is not None
        try:
            context = self._context(turn, ledger)
            with self.tracer.turn(
                user_id=turn.user_id,
                conversation_id=turn.conversation_id,
                model_id=turn.spec.id,
                input_text=turn.content
                or f"(resumed after approval {resume and resume.get('approval_id')})",
            ) as trace:
                trace_id = trace.trace_id
                try:
                    async for chunk in self.engine.run_turn(
                        conversation_id=turn.conversation_id,
                        content=turn.content,
                        context=context,
                        callbacks=trace.callbacks,
                        resume=resume,
                    ):
                        if chunk.kind == "delta":
                            safe = redactor.feed(chunk.text)
                            if safe:
                                yield TurnEvent("delta", {"text": safe})
                        elif chunk.kind == "event" and chunk.event and chunk.data is not None:
                            if chunk.event in ("tool_call", "tool_result"):
                                _merge(turn.tool_calls, self._tool_entry(chunk.event, chunk.data))
                            yield TurnEvent(chunk.event, chunk.data)
                        elif chunk.kind == "interrupt":
                            interrupted = chunk.data or {}
                        elif chunk.message is not None:
                            summary = chunk.summary
                            completed = True
                    tail = redactor.flush()
                    if tail:
                        yield TurnEvent("delta", {"text": tail})
                    if not completed and interrupted is None:
                        raise RuntimeError("the model produced no message")
                    citations = list(summary.get("citations") or []) if completed else []
                    retrieval_mode = summary.get("retrieval_mode")
                    trace.output = turn.prior_text + redactor.text
                except GeneratorExit:
                    trace.error = DISCONNECTED
                    raise
                except Exception as exc:
                    error = describe_turn_error(exc, turn.spec, self.settings.ollama_host)
                    trace.error = error
                finally:
                    totals = ledger.totals()
                    trace.usage = totals.as_dict() if totals is not None else {}
                    trace.metadata = {
                        "help_mode": turn.help_mode,
                        "resumed": resume,
                        "route": summary.get("route"),
                        "queries": summary.get("queries"),
                        "rewrites": summary.get("rewrites"),
                        "retrieval_mode": summary.get("retrieval_mode"),
                        "relevant_passages": summary.get("relevant_ids"),
                        "cited_passages": [c.get("passage_id") for c in citations],
                        "tool_calls": [
                            {k: t.get(k) for k in ("tool", "decision", "reason_code", "status")}
                            for t in turn.tool_calls
                        ],
                        "guard_events": [
                            {k: g.get(k) for k in ("guard", "action", "category")}
                            for g in turn.guard_events
                        ],
                        "model_calls": ledger.summary(),
                        "interrupted": interrupted,
                    }
        except RampartError as exc:
            error = exc.detail
        except Exception as exc:  # the tracer, a factory or the context failed
            error = describe_error(exc)
        finally:
            self._streaming.discard(turn.conversation_id)
            if redactor.counts:
                kinds = ", ".join(f"{n} {k}" for k, n in sorted(redactor.counts.items()))
                entry = self._record_guard(
                    turn,
                    "output",
                    "redacted",
                    "secret_in_answer",
                    f"Removed from the answer: {kinds}",
                )
                guard_tail: dict[str, Any] | None = entry
            else:
                guard_tail = None
            text = turn.prior_text + redactor.text
            if interrupted is not None and error is None:
                status, final_error = AWAITING, None
            elif completed and error is None:
                status, final_error = "complete", None
            else:
                status, final_error = "error", error or DISCONNECTED
            persisted = self._persist(
                turn,
                text=text,
                status=status,
                error=final_error,
                citations=citations if status == "complete" else [],
                retrieval_mode=retrieval_mode if status == "complete" else None,
                trace_id=trace_id,
                latency_ms=int((time.monotonic() - started) * 1000),
            )

        if guard_tail is not None:
            yield TurnEvent("guard", guard_tail)
        if status == AWAITING:
            approval = persisted.get("pending_approval")
            yield TurnEvent(
                "approval_required", {"approval": approval, "assistant_message": persisted}
            )
            return
        if status == "complete":
            if citations:
                yield TurnEvent("citations", {"citations": citations})
            if summary.get("notice"):
                yield TurnEvent("notice", {"kind": summary["notice"], "message": text[-500:]})
            usage = {k: persisted.get(k) for k in ("input_tokens", "output_tokens", "cost_usd")}
            if any(v is not None for v in usage.values()):
                yield TurnEvent("usage", usage)
            yield TurnEvent("done", {"assistant_message": persisted})
        else:
            yield TurnEvent("error", {"message": final_error, "assistant_message": persisted})

    @staticmethod
    def _tool_entry(event: str, data: dict[str, Any]) -> dict[str, Any]:
        if event == "tool_call":
            status = {"approval_required": "pending", "deny": "denied"}.get(
                str(data.get("decision"))
            )
            return {
                "id": data.get("id"),
                "tool": data.get("tool"),
                "arguments": data.get("arguments") or {},
                "decision": data.get("decision"),
                "reason_code": data.get("reason_code"),
                "message": data.get("message"),
                "approval_id": data.get("approval_id"),
                "contributed_by": data.get("contributed_by"),
                "status": status,
            }
        return {
            "id": data.get("id"),
            "status": data.get("status"),
            "summary": data.get("summary"),
            "provenance": data.get("provenance"),
            "report_id": data.get("report_id"),
        }

    def _persist(
        self,
        turn: _Turn,
        *,
        text: str,
        status: str,
        error: str | None,
        citations: list[dict[str, Any]],
        retrieval_mode: str | None,
        trace_id: str | None,
        latency_ms: int,
    ) -> dict[str, Any]:
        with session_scope(self.session_factory) as db:
            row = db.get(Message, turn.assistant_id)
            if row is None:  # the Conversation was deleted while streaming
                return {}
            row.content = text
            row.status = status
            row.error = error
            row.latency_ms = (row.latency_ms or 0) + latency_ms  # a resumed turn adds up
            row.trace_id = trace_id or row.trace_id
            row.citations = citations or None
            row.retrieval_mode = retrieval_mode
            row.tool_calls = list(turn.tool_calls or []) or None
            row.guard_events = list(turn.guard_events or []) or None
            totals = message_totals(db, row.id)
            if totals is not None:
                row.input_tokens = totals.input_tokens
                row.output_tokens = totals.output_tokens
                row.cost_usd = totals.cost_usd
            conversation = db.get(Conversation, turn.conversation_id)
            if conversation is not None:
                conversation.updated_at = utcnow()
            db.flush()
            approval = None
            if status == AWAITING:
                approval = ApprovalService(db).latest_for_messages([row.id]).get(row.id)
            return message_out(row, approval=approval, db=db).model_dump()


def describe_error(exc: BaseException) -> str:
    text = str(exc).strip()
    name = type(exc).__name__
    return f"{name}: {text}" if text else name


def _is_connection_error(exc: BaseException) -> bool:
    seen: BaseException | None = exc
    for _ in range(6):  # walk __cause__ / __context__ a few levels
        if seen is None:
            return False
        if isinstance(seen, ConnectionError | httpx.ConnectError | httpx.ConnectTimeout):
            return True
        seen = seen.__cause__ or seen.__context__
    return False


def describe_turn_error(exc: BaseException, spec: ModelSpec, ollama_host: str) -> str:
    """A Provider failure in words a user can act on (P6-A22: a clear error for Ollama)."""
    if spec.provider == "ollama" and _is_connection_error(exc):
        return (
            f"The local model {spec.display_name} could not be reached: Ollama is not answering "
            f"at {ollama_host}. Start it with `ollama serve` (and `ollama pull` the model), or "
            "pick another model."
        )
    return describe_error(exc)


def _title_from(content: str) -> str:
    first_line = content.strip().splitlines()[0].strip()
    if len(first_line) <= TITLE_LENGTH:
        return first_line or DEFAULT_TITLE
    return first_line[: TITLE_LENGTH - 1].rstrip() + "…"
