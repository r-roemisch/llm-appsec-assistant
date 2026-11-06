"""Runs one turn of a Conversation through the graph: text deltas first, the final message last."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langgraph.checkpoint.base import BaseCheckpointSaver

from rampart.chat.graph import GENERATE_NODE, build_graph
from rampart.chat.llm import text_of


@dataclass(frozen=True)
class TurnChunk:
    kind: str  # "delta" or "final"
    text: str = ""
    message: AIMessage | None = None


class ChatEngine:
    def __init__(self, checkpointer: BaseCheckpointSaver) -> None:
        self.checkpointer = checkpointer

    async def run_turn(
        self,
        *,
        conversation_id: str,
        llm: BaseChatModel,
        content: str,
        callbacks: list[BaseCallbackHandler] | None = None,
    ) -> AsyncIterator[TurnChunk]:
        graph = build_graph(llm, self.checkpointer)
        config = {
            "configurable": {"thread_id": conversation_id},
            "callbacks": list(callbacks or []),
        }
        final: AIMessage | None = None
        async for mode, payload in graph.astream(
            {"messages": [HumanMessage(content=content)]},
            config=config,  # type: ignore[arg-type]
            stream_mode=["messages", "updates"],
        ):
            if mode == "messages":
                chunk, metadata = payload  # type: ignore[misc]
                if (
                    isinstance(metadata, dict)
                    and metadata.get("langgraph_node") == GENERATE_NODE
                    and isinstance(chunk, AIMessageChunk)
                ):
                    text = text_of(chunk.content)
                    if text:
                        yield TurnChunk(kind="delta", text=text)
            elif mode == "updates" and isinstance(payload, dict):
                update = payload.get(GENERATE_NODE)
                if isinstance(update, dict):
                    messages = update.get("messages") or []
                    if messages and isinstance(messages[-1], AIMessage):
                        final = messages[-1]
        if final is None:
            raise RuntimeError("the model produced no message")
        yield TurnChunk(kind="final", message=final)

    async def delete_thread(self, conversation_id: str) -> None:
        delete = getattr(self.checkpointer, "adelete_thread", None)
        if delete is not None:
            await delete(conversation_id)
