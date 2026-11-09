"""A scripted stand-in chat Model for offline tests: replays fixed replies with fake usage."""

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Callable, Iterator, Sequence
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from langchain_core.runnables import Runnable
from pydantic import Field

# A reply is text, or {"content": str, "tool_calls": [{"name", "args", "id"}]}.
Reply = str | dict[str, Any]


class ScriptedModelError(RuntimeError):
    pass


class ScriptedChatModel(BaseChatModel):
    """Returns ``replies`` in order (cycling), streamed word by word.

    The final chunk carries LangChain usage metadata and an ``openrouter_usage`` entry
    with ``cost`` so that the same accounting path as a real OpenRouter call is exercised.
    ``fail_with`` makes every call raise, to test error handling. ``responder``, when set,
    sees the messages of each call and may return the reply itself (``None`` falls back to
    ``replies``); tests use it to answer routing and grading prompts and to emit Tool calls
    (a dict reply with ``tool_calls``). ``tool_offers`` records the Tools each call was offered.
    """

    replies: list[Reply] = Field(default_factory=lambda: ["Scripted reply."])
    cost: float = 0.001
    input_tokens: int = 12
    output_tokens: int = 7
    fail_with: str | None = None
    responder: Callable[[list[BaseMessage]], Reply | None] | None = None
    reply_index: int = 0
    calls: list[list[BaseMessage]] = Field(default_factory=list)
    tool_offers: list[dict[str, Any]] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(
        self,
        tools: Sequence[Any],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> Runnable[Any, AIMessage]:
        return self.bind(scripted_tools=list(tools), scripted_tool_choice=tool_choice, **kwargs)  # type: ignore[return-value]

    def _next_reply(self, messages: list[BaseMessage], kwargs: dict[str, Any]) -> Reply:
        if self.fail_with:
            raise ScriptedModelError(self.fail_with)
        reply = self.responder(list(messages)) if self.responder is not None else None
        if reply is None:
            reply = self.replies[self.reply_index % len(self.replies)]
            self.reply_index += 1
        self.calls.append(list(messages))
        self.tool_offers.append(
            {
                "tools": [
                    t.get("function", {}).get("name") if isinstance(t, dict) else str(t)
                    for t in kwargs.get("scripted_tools") or []
                ],
                "tool_choice": kwargs.get("scripted_tool_choice"),
            }
        )
        return reply

    @staticmethod
    def _parts(reply: Reply) -> tuple[str, list[dict[str, Any]]]:
        if isinstance(reply, str):
            return reply, []
        calls = [
            {
                "name": str(c["name"]),
                "args": dict(c.get("args") or {}),
                "id": str(c.get("id") or f"call-{i}"),
                "type": "tool_call",
            }
            for i, c in enumerate(reply.get("tool_calls") or [])
        ]
        return str(reply.get("content") or ""), calls

    def _final_metadata(self) -> dict[str, Any]:
        return {
            "model_name": "scripted",
            "openrouter_usage": {
                "prompt_tokens": self.input_tokens,
                "completion_tokens": self.output_tokens,
                "total_tokens": self.input_tokens + self.output_tokens,
                "cost": self.cost,
            },
            "openrouter_id": "gen-scripted",
        }

    def _usage(self) -> dict[str, int]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.input_tokens + self.output_tokens,
        }

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        text, calls = self._parts(self._next_reply(messages, kwargs))
        message = AIMessage(
            content=text,
            tool_calls=calls,
            usage_metadata=self._usage(),  # type: ignore[arg-type]
            response_metadata=self._final_metadata(),
        )
        return ChatResult(generations=[ChatGeneration(message=message)])

    def _chunks(
        self, messages: list[BaseMessage], kwargs: dict[str, Any]
    ) -> Iterator[ChatGenerationChunk]:
        text, calls = self._parts(self._next_reply(messages, kwargs))
        for piece in (p for p in re.split(r"(\s+)", text) if p):
            yield ChatGenerationChunk(message=AIMessageChunk(content=piece))
        if calls:
            yield ChatGenerationChunk(
                message=AIMessageChunk(
                    content="",
                    tool_call_chunks=[
                        {
                            "name": c["name"],
                            "args": json.dumps(c["args"]),
                            "id": c["id"],
                            "index": i,
                        }
                        for i, c in enumerate(calls)
                    ],
                )
            )
        yield ChatGenerationChunk(
            message=AIMessageChunk(
                content="",
                usage_metadata=self._usage(),  # type: ignore[arg-type]
                response_metadata=self._final_metadata(),
            )
        )

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        for chunk in self._chunks(messages, kwargs):
            if run_manager and chunk.message.content:
                run_manager.on_llm_new_token(str(chunk.message.content), chunk=chunk)
            yield chunk

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        for chunk in self._chunks(messages, kwargs):
            if run_manager and chunk.message.content:
                await run_manager.on_llm_new_token(str(chunk.message.content), chunk=chunk)
            yield chunk
