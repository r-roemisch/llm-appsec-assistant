"""A scripted stand-in chat Model for offline tests: replays fixed replies with fake usage."""

from __future__ import annotations

import re
from collections.abc import AsyncIterator, Iterator
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import Field


class ScriptedModelError(RuntimeError):
    pass


class ScriptedChatModel(BaseChatModel):
    """Returns ``replies`` in order (cycling), streamed word by word.

    The final chunk carries LangChain usage metadata and an ``openrouter_usage`` entry
    with ``cost`` so that the same accounting path as a real OpenRouter call is exercised.
    ``fail_with`` makes every call raise, to test error handling.
    """

    replies: list[str] = Field(default_factory=lambda: ["Scripted reply."])
    cost: float = 0.001
    input_tokens: int = 12
    output_tokens: int = 7
    fail_with: str | None = None
    calls: list[list[BaseMessage]] = Field(default_factory=list)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _next_reply(self, messages: list[BaseMessage]) -> str:
        if self.fail_with:
            raise ScriptedModelError(self.fail_with)
        reply = self.replies[len(self.calls) % len(self.replies)]
        self.calls.append(list(messages))
        return reply

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
        reply = self._next_reply(messages)
        message = AIMessage(
            content=reply,
            usage_metadata=self._usage(),  # type: ignore[arg-type]
            response_metadata=self._final_metadata(),
        )
        return ChatResult(generations=[ChatGeneration(message=message)])

    def _chunks(self, messages: list[BaseMessage]) -> Iterator[ChatGenerationChunk]:
        reply = self._next_reply(messages)
        pieces = [p for p in re.split(r"(\s+)", reply) if p]
        for piece in pieces:
            yield ChatGenerationChunk(message=AIMessageChunk(content=piece))
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
        for chunk in self._chunks(messages):
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
        for chunk in self._chunks(messages):
            if run_manager and chunk.message.content:
                await run_manager.on_llm_new_token(str(chunk.message.content), chunk=chunk)
            yield chunk
