"""The LangGraph turn graph.

    load_context -> input_guard -> route -> retrieve -> grade -> (rewrite -> retrieve)* -> generate
                         |             \\-----------------------------------------------> generate
                         \\-> (blocked) end                              generate <-> tools -> ...

``input_guard`` ends the turn with a fixed safe response when G1 blocked the message (or, with
the admin flag, the grader Slot classified it as an attack). ``route`` decides with the grader
Slot whether to search the Knowledge Base first; ``retrieve``, ``grade`` and ``rewrite`` are the
M2 retrieval sub-graph. ``generate`` answers on the chat Model with the enabled Tools bound; when
it emits Tool calls, ``tools`` sends them one at a time through the Gateway: allowed calls run,
denied calls return the reason to the Model, and a call that needs an Approval interrupts the
graph until someone decides (LangGraph ``interrupt``). One call per step means a resumed turn
never repeats a call that already ran. Bounds: model calls and Tool calls per turn, two
equivalent denials, the Conversation token budget.

The graph is built per turn: Models, the search handle, the ToolSet and the ledger arrive in a
``TurnContext`` and never enter the checkpoint; the checkpoint keeps messages and small per-turn
values, which ``load_context`` resets at the start of each turn.
"""

from __future__ import annotations

import contextlib
import secrets
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    RemoveMessage,
    SystemMessage,
    ToolMessage,
)
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from rampart.catalog.catalog import ModelSpec
from rampart.chat.citable import CitableRegistry
from rampart.chat.ledger import UsageLedger
from rampart.chat.llm import text_of
from rampart.chat.prompts import (
    BUDGET_NOTICE,
    MODEL_CALLS_NOTICE,
    SYSTEM_PROMPT,
    TOOL_RULES,
    TOOLS_STOPPED_NOTE,
    RouteDecision,
    augmented_question,
    citation_rules,
    clean_query,
    extract_citations,
    grade_messages,
    parse_relevant,
    parse_route,
    rewrite_messages,
    route_messages,
    summary_messages,
    system_prompt,
)
from rampart.chat.toolset import ToolSet
from rampart.gateway.gateway import stored_arguments
from rampart.guards.input_guard import (
    SAFE_RESPONSE,
    InputVerdict,
    classify_message,
    scan_untrusted,
)
from rampart.guards.secrets import redact
from rampart.knowledge.service import KnowledgeTurn

__all__ = ["GENERATE_NODE", "SYSTEM_PROMPT", "ChatState", "TurnContext", "build_graph"]

GENERATE_NODE = "generate"
INPUT_GUARD_NODE = "input_guard"
TOOLS_NODE = "tools"
SUMMARY_KEYS = (
    "route",
    "queries",
    "rewrites",
    "relevant_ids",
    "retrieval_mode",
    "citations",
    "notice",
)

GuardRecorder = Callable[[str, str, str, str], dict[str, Any]]
BLOCKED_PLACEHOLDER = "[A message from the user was blocked by the input guard and is not shown.]"


@dataclass(frozen=True)
class Grader:
    llm: BaseChatModel
    spec: ModelSpec


@dataclass(frozen=True)
class TurnLimits:
    max_rewrites: int = 2
    min_relevant: int = 1
    max_context_passages: int = 6
    max_model_calls: int = 8
    retrieval_budget_seconds: float = 60.0
    ungraded_keep: int = 4
    history_summary_tokens: int = 6000
    history_keep_turns: int = 3


@dataclass
class TurnContext:
    chat_llm: BaseChatModel
    chat_spec: ModelSpec
    ledger: UsageLedger
    username: str | None = None
    profile: str | None = None
    help_mode: bool = False
    persona: str | None = None
    grader: Grader | None = None
    knowledge: KnowledgeTurn | None = None
    tools: ToolSet | None = None
    input_verdict: InputVerdict | None = None
    input_classifier: bool = False
    budget: Callable[[], tuple[int, int | None]] | None = None
    guard: GuardRecorder | None = None
    limits: TurnLimits = field(default_factory=TurnLimits)
    started: float = field(default_factory=time.monotonic)
    citable: CitableRegistry = field(default_factory=CitableRegistry)


class ChatState(MessagesState):
    system_prompt: str
    summary: str | None  # (M6) older turns, summarised; kept across turns in the checkpoint
    route: dict[str, Any] | None
    queries: list[str]
    rewrites: int
    candidate_ids: list[str]
    relevant_ids: list[str]
    retrieval_mode: str | None
    search_done: bool
    citations: list[dict[str, Any]]
    model_calls: int
    blocked: bool
    tool_calls: int
    denials: dict[str, int]
    tools_stopped: bool
    citable_ids: list[str]
    scanned_ids: list[str]
    notice: str | None


def estimate_tokens(messages: Sequence[BaseMessage]) -> int:
    """A rough token count (four characters a token), enough to decide when to summarise."""
    chars = 0
    for message in messages:
        chars += len(text_of(message.content))
        for call in getattr(message, "tool_calls", None) or []:
            chars += len(str(call.get("args") or ""))
    return chars // 4


def latest_question(messages: Sequence[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            return text_of(message.content)
    return ""


def _emit(event: str, data: dict[str, Any]) -> None:
    get_stream_writer()({"event": event, "data": data})


def _last_ai(messages: Sequence[BaseMessage]) -> tuple[int, AIMessage | None]:
    for index in range(len(messages) - 1, -1, -1):
        message = messages[index]
        if isinstance(message, AIMessage):
            return index, message
    return -1, None


def pending_calls(messages: Sequence[BaseMessage]) -> list[dict[str, Any]]:
    """Tool calls of the last answer that have no Tool result yet."""
    index, ai = _last_ai(messages)
    if ai is None or not ai.tool_calls:
        return []
    answered = {m.tool_call_id for m in messages[index + 1 :] if isinstance(m, ToolMessage)}
    return [dict(c) for c in ai.tool_calls if c.get("id") not in answered]


def build_graph(ctx: TurnContext, checkpointer: BaseCheckpointSaver | None) -> CompiledStateGraph:
    limits = ctx.limits

    def guard_event(guard: str, action: str, category: str, detail: str) -> None:
        entry = (
            ctx.guard(guard, action, category, detail)
            if ctx.guard is not None
            else {"guard": guard, "action": action, "category": category, "detail": detail}
        )
        _emit("guard", entry)

    async def memory(state: ChatState) -> dict:
        """Short-term memory (spec section 9): when the model-facing history grows past the
        configured size, summarise the older turns with the grader Slot and drop them from the
        checkpoint. The last few user turns stay word for word, and the cut always falls on a
        user message, so a Tool call is never separated from its result. The stored messages
        the UI shows are not touched. If summarising fails, the full history is kept."""
        history = list(state["messages"])
        if estimate_tokens(history) <= limits.history_summary_tokens:
            return {}
        starts = [i for i, m in enumerate(history) if isinstance(m, HumanMessage)]
        if len(starts) <= limits.history_keep_turns:
            return {}
        cut = starts[-limits.history_keep_turns]
        older = history[:cut]
        model, spec = (
            (ctx.grader.llm, ctx.grader.spec)
            if ctx.grader is not None
            else (ctx.chat_llm, ctx.chat_spec)
        )
        try:
            reply = await model.ainvoke(summary_messages(state.get("summary"), older))
            await ctx.ledger.record_chat("summarise", spec, reply)
        except Exception:
            return {}
        summary = redact(text_of(reply.content)).text.strip()[:4000]
        if not summary:
            return {}
        return {
            "summary": summary,
            "messages": [RemoveMessage(id=m.id) for m in older if m.id is not None],
        }

    async def load_context(state: ChatState) -> dict:
        return {
            "system_prompt": system_prompt(
                username=ctx.username,
                profile=ctx.profile,
                help_mode=ctx.help_mode,
                persona=ctx.persona,
                summary=state.get("summary"),
            ),
            "route": None,
            "queries": [],
            "rewrites": 0,
            "candidate_ids": [],
            "relevant_ids": [],
            "retrieval_mode": None,
            "search_done": False,
            "citations": [],
            "model_calls": 0,
            "blocked": False,
            "tool_calls": 0,
            "denials": {},
            "tools_stopped": False,
            "citable_ids": [],
            "scanned_ids": [],
            "notice": None,
        }

    async def input_guard(state: ChatState) -> dict:
        blocked = bool(ctx.input_verdict and ctx.input_verdict.blocked)
        calls = 0
        if not blocked and ctx.input_classifier and ctx.grader is not None:
            question = latest_question(state["messages"])
            verdict = await classify_message(ctx.grader.llm, question)
            if verdict.reply is not None:
                calls = 1
                with contextlib.suppress(Exception):  # accounting must not fail the turn
                    await ctx.ledger.record_chat("classify", ctx.grader.spec, verdict.reply)
            if verdict.attack is True:  # a failed classifier never blocks
                blocked = True
                guard_event("input", "blocked", "classifier", verdict.reason)
        update: dict[str, Any] = {"model_calls": state["model_calls"] + calls}
        if blocked:
            # The blocked text leaves the model-facing history too, so a later turn cannot
            # carry it to a Model; the message as typed stays visible to its author.
            last = state["messages"][-1]
            placeholder = HumanMessage(content=BLOCKED_PLACEHOLDER, id=last.id)
            update["messages"] = [placeholder, AIMessage(content=SAFE_RESPONSE)]
            update["blocked"] = True
        return update

    def after_input_guard(state: ChatState) -> str:
        return END if state.get("blocked") else "route"

    async def route(state: ChatState) -> dict:
        question = latest_question(state["messages"])
        calls = 0
        if ctx.knowledge is None:
            decision = RouteDecision(
                mode="answer", reason="nothing in the Knowledge Base to search"
            )
        elif ctx.help_mode:
            decision = RouteDecision(
                mode="retrieve",
                arguments={"query": question},
                reason="help mode searches Rampart's guides",
            )
        elif ctx.grader is None:
            decision = RouteDecision(
                mode="retrieve",
                arguments={"query": question},
                reason="no grader Model available; searching by default",
            )
        else:
            try:
                reply = await ctx.grader.llm.ainvoke(
                    route_messages(state["messages"][:-1], question)
                )
                calls = 1
                await ctx.ledger.record_chat("route", ctx.grader.spec, reply)
                decision = parse_route(text_of(reply.content)) or RouteDecision(
                    mode="retrieve",
                    arguments={"query": question},
                    reason="routing reply was not valid; searching by default",
                )
            except Exception as exc:  # a failed router must not fail the turn
                decision = RouteDecision(
                    mode="retrieve",
                    arguments={"query": question},
                    reason=f"routing failed ({type(exc).__name__}); searching by default",
                )
        update: dict[str, Any] = {
            "route": decision.model_dump(),
            "model_calls": state["model_calls"] + calls,
        }
        if decision.mode == "retrieve":
            update["queries"] = [decision.query or question[:300]]
        return update

    def after_route(state: ChatState) -> str:
        mode = (state.get("route") or {}).get("mode")
        return "retrieve" if mode == "retrieve" and ctx.knowledge is not None else GENERATE_NODE

    async def retrieve(state: ChatState) -> dict:
        assert ctx.knowledge is not None
        query = state["queries"][-1]
        _emit("retrieval", {"phase": "search", "round": len(state["queries"]), "query": query})
        result = await ctx.knowledge.search(query)
        mode = "hybrid" if "hybrid" in (result.mode, state.get("retrieval_mode")) else "bm25"
        return {"candidate_ids": [p.id for p in result.passages], "retrieval_mode": mode}

    async def grade(state: ChatState) -> dict:
        assert ctx.knowledge is not None
        question = latest_question(state["messages"])
        passages = ctx.knowledge.passages(state["candidate_ids"])
        scanned = list(state["scanned_ids"])
        for passage in passages:  # G2: every passage a Model will read, the grader included
            if passage.id in scanned:
                continue
            scanned.append(passage.id)
            for category, snippet in scan_untrusted(passage.text):
                guard_event("provenance", "flagged", category, f"{passage.source_title}: {snippet}")
        calls = 0
        relevant: list[str] = []
        if passages and ctx.grader is None:
            relevant = [p.id for p in passages[: limits.ungraded_keep]]
        elif passages and ctx.grader is not None:
            try:
                reply = await ctx.grader.llm.ainvoke(
                    grade_messages(question, passages, secrets.token_hex(4))
                )
                calls = 1
                await ctx.ledger.record_chat("grade", ctx.grader.spec, reply)
                numbers = parse_relevant(text_of(reply.content), len(passages))
                if numbers is None:  # unparseable: keep the best-ranked passages
                    relevant = [p.id for p in passages[: limits.ungraded_keep]]
                else:
                    relevant = [passages[n - 1].id for n in numbers]
            except Exception:
                relevant = [p.id for p in passages[: limits.ungraded_keep]]
        merged = list(dict.fromkeys([*state["relevant_ids"], *relevant]))
        _emit(
            "retrieval",
            {
                "phase": "graded",
                "round": len(state["queries"]),
                "query": state["queries"][-1],
                "mode": state.get("retrieval_mode") or "bm25",
                "found": len(passages),
                "relevant": len(relevant),
                # (M6) the passages the answer will be written from, in order; the evaluation
                # scores retrieval with them. All are passages the caller may read.
                "context_ids": merged[: limits.max_context_passages],
            },
        )
        return {
            "relevant_ids": merged,
            "model_calls": state["model_calls"] + calls,
            "scanned_ids": scanned,
        }

    def after_grade(state: ChatState) -> str:
        if len(state["relevant_ids"]) >= limits.min_relevant or ctx.grader is None:
            return GENERATE_NODE
        if state["rewrites"] >= limits.max_rewrites:
            return GENERATE_NODE
        if state["model_calls"] + 3 > limits.max_model_calls:  # rewrite, grade, generate
            return GENERATE_NODE
        if time.monotonic() - ctx.started > limits.retrieval_budget_seconds:
            return GENERATE_NODE
        return "rewrite"

    async def rewrite(state: ChatState) -> dict:
        assert ctx.grader is not None
        question = latest_question(state["messages"])
        calls = 0
        query: str | None = None
        try:
            reply = await ctx.grader.llm.ainvoke(rewrite_messages(question, state["queries"]))
            calls = 1
            await ctx.ledger.record_chat("rewrite", ctx.grader.spec, reply)
            query = clean_query(text_of(reply.content))
        except Exception:
            query = None
        update: dict[str, Any] = {
            "rewrites": state["rewrites"] + 1,
            "model_calls": state["model_calls"] + calls,
        }
        if query is None or query.lower() in {q.lower() for q in state["queries"]}:
            update["search_done"] = True
        else:
            update["queries"] = [*state["queries"], query]
        return update

    def after_rewrite(state: ChatState) -> str:
        return GENERATE_NODE if state["search_done"] else "retrieve"

    async def generate(state: ChatState) -> dict:
        history = list(state["messages"])
        searched = (state.get("route") or {}).get(
            "mode"
        ) == "retrieve" and ctx.knowledge is not None
        update: dict[str, Any] = {}
        if ctx.knowledge is not None and state["citable_ids"] and not ctx.citable.ids():
            ctx.citable.add(ctx.knowledge.passages(state["citable_ids"]))  # a resumed turn
        initial = (
            ctx.knowledge.passages(state["relevant_ids"][: limits.max_context_passages])
            if searched and ctx.knowledge is not None
            else []
        )
        numbers = ctx.citable.add(initial)  # these passages were scanned when graded
        if ctx.budget is not None:
            used, budget = ctx.budget()
            if budget is not None and used >= budget:
                notice = BUDGET_NOTICE.format(used=used, budget=budget)
                return {**update, "messages": [AIMessage(content=notice)], "notice": "budget"}
        if state["model_calls"] >= limits.max_model_calls:
            notice = MODEL_CALLS_NOTICE.format(calls=limits.max_model_calls)
            return {**update, "messages": [AIMessage(content=notice)], "notice": "model_calls"}

        prompt = state["system_prompt"]
        nonce = secrets.token_hex(4)
        if ctx.knowledge is not None:
            prompt = f"{prompt}\n\n{citation_rules(nonce)}"
        offered = ctx.tools.specs if ctx.tools is not None else []
        stop_tools = state["tools_stopped"] or state["model_calls"] >= limits.max_model_calls - 1
        if offered:
            prompt = f"{prompt}\n\n{TOOL_RULES}"
            if stop_tools:
                prompt = f"{prompt}\n\n{TOOLS_STOPPED_NOTE}"
        index = max((i for i, m in enumerate(history) if isinstance(m, HumanMessage)), default=-1)
        model_input: list[BaseMessage] = [SystemMessage(content=prompt)]
        if searched and index >= 0:
            question = augmented_question(latest_question(history), initial, nonce, numbers=numbers)
            model_input += [*history[:index], HumanMessage(content=question), *history[index + 1 :]]
        else:
            model_input += history
        runnable: Any = ctx.chat_llm
        if offered:
            runnable = ctx.chat_llm.bind_tools(offered, tool_choice="none" if stop_tools else None)
        response = await runnable.ainvoke(model_input)
        await ctx.ledger.record_chat("generate", ctx.chat_spec, response)
        text = text_of(response.content)
        tool_calls = list(getattr(response, "tool_calls", None) or [])
        if tool_calls and (not offered or stop_tools):
            tool_calls = []  # calls the turn no longer allows are dropped, never run
        stored = AIMessage(
            content=redact(text).text,  # G4 for the model-facing history as well
            tool_calls=tool_calls,
            id=response.id,
            response_metadata=getattr(response, "response_metadata", {}) or {},
            usage_metadata=getattr(response, "usage_metadata", None),
        )
        update.update(
            {
                "messages": [stored],
                "model_calls": state["model_calls"] + 1,
                "citable_ids": ctx.citable.ids(),
            }
        )
        if not tool_calls:
            update["citations"] = extract_citations(text, ctx.citable.passages)
        return update

    def after_generate(state: ChatState) -> str:
        return TOOLS_NODE if pending_calls(state["messages"]) and ctx.tools is not None else END

    async def tools(state: ChatState) -> dict:
        assert ctx.tools is not None
        call = pending_calls(state["messages"])[0]
        name, call_id = str(call.get("name") or ""), str(call.get("id") or "")
        raw_args = call.get("args")
        arguments: dict[str, Any] = raw_args if isinstance(raw_args, dict) else {}
        decision = ctx.tools.check(call_id, name, arguments, state["tool_calls"])

        def announce() -> None:
            _emit(
                "tool_call",
                {
                    "id": call_id,
                    "tool": name,
                    "arguments": stored_arguments(arguments),
                    "decision": decision.decision,
                    "reason_code": decision.reason_code,
                    "message": decision.message,
                    "approval_id": decision.approval_id,
                    "contributed_by": decision.manifest.contributed_by
                    if decision.manifest is not None
                    else None,
                },
            )

        announce()
        if decision.decision == "approval_required":
            interrupt({"approval_id": decision.approval_id, "tool_call_id": call_id, "tool": name})
            decision = ctx.tools.check(
                call_id, name, arguments, state["tool_calls"]
            )  # after resume
            announce()
        manifest = decision.manifest
        provenance = manifest.provenance if manifest is not None else "system"
        update: dict[str, Any] = {"tool_calls": state["tool_calls"] + 1}
        if decision.decision == "allow" and manifest is not None:
            output, redactions = await ctx.tools.execute(decision, name, arguments)
            if redactions:
                guard_event(
                    "output",
                    "redacted",
                    "secret_in_tool_output",
                    f"{redactions} secret(s) removed from {name} output",
                )
            content = ctx.tools.model_text(name, provenance, output, manifest.max_output_chars)
            if provenance in ("API", "target", "plugin", "source"):
                for category, snippet in scan_untrusted(content):
                    guard_event("provenance", "flagged", category, f"{name} output: {snippet}")
            if output.citable_ids:
                update["citable_ids"] = ctx.citable.ids()
            _emit(
                "tool_result",
                {
                    "id": call_id,
                    "tool": name,
                    "status": "error" if output.error else "ok",
                    "summary": f"{output.summary}: {output.error}"
                    if output.error
                    else output.summary,
                    "provenance": provenance,
                    "report_id": output.report_id,
                },
            )
        else:
            rejected = decision.reason_code == "approval_rejected"
            content = (
                f"Rampart's Gateway did not run {name}: {decision.message} "
                f"(reason: {decision.reason_code}). Do not repeat this call; continue without it."
            )
            key = f"{name}:{decision.reason_code}"
            denials = {**state["denials"], key: state["denials"].get(key, 0) + 1}
            update["denials"] = denials
            if denials[key] >= 2:
                update["tools_stopped"] = True  # two equivalent denials end Tool use this turn
            _emit(
                "tool_result",
                {
                    "id": call_id,
                    "tool": name,
                    "status": "rejected" if rejected else "denied",
                    "summary": decision.message,
                    "provenance": None,
                    "report_id": None,
                },
            )
        if update["tool_calls"] >= ctx.tools.gateway.settings.max_tool_calls_per_turn:
            update["tools_stopped"] = True
        update["messages"] = [ToolMessage(content=content, tool_call_id=call_id, name=name)]
        return update

    def after_tools(state: ChatState) -> str:
        return TOOLS_NODE if pending_calls(state["messages"]) else GENERATE_NODE

    builder = StateGraph(ChatState)
    builder.add_node("memory", memory)
    builder.add_node("load_context", load_context)
    builder.add_node(INPUT_GUARD_NODE, input_guard)
    builder.add_node("route", route)
    builder.add_node("retrieve", retrieve)
    builder.add_node("grade", grade)
    builder.add_node("rewrite", rewrite)
    builder.add_node(GENERATE_NODE, generate)
    builder.add_node(TOOLS_NODE, tools)
    builder.add_edge(START, "memory")
    builder.add_edge("memory", "load_context")
    builder.add_edge("load_context", INPUT_GUARD_NODE)
    builder.add_conditional_edges(INPUT_GUARD_NODE, after_input_guard, ["route", END])
    builder.add_conditional_edges("route", after_route, ["retrieve", GENERATE_NODE])
    builder.add_edge("retrieve", "grade")
    builder.add_conditional_edges("grade", after_grade, ["rewrite", GENERATE_NODE])
    builder.add_conditional_edges("rewrite", after_rewrite, ["retrieve", GENERATE_NODE])
    builder.add_conditional_edges(GENERATE_NODE, after_generate, [TOOLS_NODE, END])
    builder.add_conditional_edges(TOOLS_NODE, after_tools, [TOOLS_NODE, GENERATE_NODE])
    return builder.compile(checkpointer=checkpointer)
