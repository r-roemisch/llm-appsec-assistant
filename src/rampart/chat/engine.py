"""Runs one turn (or the rest of an interrupted one) through the graph: progress and Tool events
and text deltas while it runs, then either the final message with a summary of the turn, or an
interrupt when a Tool call waits for an Approval."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.types import Command

from rampart.chat.graph import (
    GENERATE_NODE,
    INPUT_GUARD_NODE,
    SUMMARY_KEYS,
    TurnContext,
    build_graph,
    pending_calls,
)
from rampart.chat.llm import text_of


@dataclass(frozen=True)
class TurnChunk:
    kind: str  # "delta", "event", "interrupt" or "final"
    text: str = ""
    event: str | None = None
    data: dict[str, Any] | None = None
    message: AIMessage | None = None
    summary: dict[str, Any] = field(default_factory=dict)


class ChatEngine:
    def __init__(self, checkpointer: BaseCheckpointSaver) -> None:
        self.checkpointer = checkpointer

    async def run_turn(
        self,
        *,
        conversation_id: str,
        content: str | None,
        context: TurnContext,
        callbacks: list[BaseCallbackHandler] | None = None,
        resume: dict[str, Any] | None = None,
    ) -> AsyncIterator[TurnChunk]:
        """A new turn for ``content``, or, with ``resume``, the rest of an interrupted turn."""
        graph = build_graph(context, self.checkpointer)
        config = {
            "configurable": {"thread_id": conversation_id},
            "callbacks": list(callbacks or []),
        }
        payload: Any = (
            Command(resume=resume)
            if resume is not None
            else {"messages": [HumanMessage(content=content or "")]}
        )
        final: AIMessage | None = None
        summary: dict[str, Any] = {}
        streamed: set[str] = set()
        last_stream_id: str | None = None
        async for mode, item in graph.astream(
            payload,
            config=config,  # type: ignore[arg-type]
            stream_mode=["messages", "updates", "custom"],
        ):
            if mode == "messages":
                chunk, metadata = item  # type: ignore[misc]
                if (
                    isinstance(metadata, dict)
                    and metadata.get("langgraph_node") == GENERATE_NODE
                    and isinstance(chunk, AIMessageChunk)
                ):
                    text = text_of(chunk.content)
                    if not text:
                        continue
                    if chunk.id and chunk.id != last_stream_id:
                        if last_stream_id is not None:
                            yield TurnChunk(kind="delta", text="\n\n")  # a new answer segment
                        last_stream_id = chunk.id
                    if chunk.id:
                        streamed.add(chunk.id)
                    yield TurnChunk(kind="delta", text=text)
            elif mode == "custom" and isinstance(item, dict):
                event, data = item.get("event"), item.get("data")
                if isinstance(event, str) and isinstance(data, dict):
                    yield TurnChunk(kind="event", event=event, data=data)
            elif mode == "updates" and isinstance(item, dict):
                if "__interrupt__" in item:
                    interrupts = item["__interrupt__"] or ()
                    value = getattr(interrupts[0], "value", None) if interrupts else None
                    yield TurnChunk(kind="interrupt", data=value if isinstance(value, dict) else {})
                    return
                for node, update in item.items():
                    if not isinstance(update, dict):
                        continue
                    for key in SUMMARY_KEYS:
                        if key in update:
                            summary[key] = update[key]
                    if node in (GENERATE_NODE, INPUT_GUARD_NODE):
                        messages = update.get("messages") or []
                        if (
                            messages
                            and isinstance(messages[-1], AIMessage)
                            and not pending_calls(messages)
                        ):
                            candidate: AIMessage = messages[-1]
                            final = candidate
                            if candidate.id is None or candidate.id not in streamed:
                                text = text_of(
                                    candidate.content
                                )  # a fixed response, never streamed
                                if text:
                                    if last_stream_id is not None:
                                        yield TurnChunk(kind="delta", text="\n\n")
                                    yield TurnChunk(kind="delta", text=text)
                                    last_stream_id = "fixed"
        if final is None:
            raise RuntimeError("the model produced no message")
        yield TurnChunk(kind="final", message=final, summary=summary)

    async def delete_thread(self, conversation_id: str) -> None:
        delete = getattr(self.checkpointer, "adelete_thread", None)
        if delete is not None:
            await delete(conversation_id)
