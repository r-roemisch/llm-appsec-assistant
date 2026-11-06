"""Chat Model construction for both Providers, and reading usage and cost out of responses."""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from typing import Any, Protocol

import httpx
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGenerationChunk
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from rampart.catalog.catalog import ModelSpec
from rampart.config import OPENROUTER_BASE_URL, Settings
from rampart.errors import ServiceUnavailable

OPENROUTER_GENERATION_URL = f"{OPENROUTER_BASE_URL}/generation"


@dataclass(frozen=True)
class GenerationSettings:
    temperature: float | None = None
    max_tokens: int | None = None


@dataclass(frozen=True)
class TurnUsage:
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None
    generation_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class OpenRouterChat(ChatOpenAI):
    """ChatOpenAI pointed at OpenRouter that keeps OpenRouter's usage accounting.

    When streaming, langchain-openai reduces the ``usage`` object of the final chunk to
    token counts and drops every other field, including the ``cost`` OpenRouter adds
    when usage accounting is requested. This subclass copies that raw object into the
    chunk's ``response_metadata`` so that the merged message still carries it.
    """

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict,
        default_chunk_class: type,
        base_generation_info: dict | None,
    ) -> ChatGenerationChunk | None:
        generation_chunk = super()._convert_chunk_to_generation_chunk(
            chunk, default_chunk_class, base_generation_info
        )
        if generation_chunk is None:
            return None
        usage = chunk.get("usage")
        if usage:
            metadata = generation_chunk.message.response_metadata
            metadata["openrouter_usage"] = dict(usage)
            generation_id = chunk.get("id")
            if generation_id:
                metadata["openrouter_id"] = str(generation_id)
        return generation_chunk


class ChatModelFactory(Protocol):
    def build(self, spec: ModelSpec, generation: GenerationSettings) -> BaseChatModel: ...


class ProviderChatModelFactory:
    """Builds the LangChain chat model for a catalog entry, or explains why it cannot."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def build(self, spec: ModelSpec, generation: GenerationSettings) -> BaseChatModel:
        if spec.provider == "openrouter":
            return self._openrouter(spec, generation)
        return self._ollama(spec, generation)

    def _openrouter(self, spec: ModelSpec, generation: GenerationSettings) -> BaseChatModel:
        key = self.settings.openrouter_api_key
        if key is None:
            raise ServiceUnavailable(
                "OpenRouter is not configured: set OPENROUTER_API_KEY in .env or pick a local model"
            )
        kwargs: dict[str, Any] = {
            "model": spec.id,
            "api_key": key.get_secret_value(),
            "base_url": OPENROUTER_BASE_URL,
            "stream_usage": True,
            "extra_body": {"usage": {"include": True}},
            "default_headers": {"HTTP-Referer": self.settings.app_url, "X-Title": "Rampart"},
            "max_retries": 2,
            "timeout": 120,
        }
        if generation.temperature is not None:
            kwargs["temperature"] = generation.temperature
        if generation.max_tokens is not None:
            kwargs["max_tokens"] = generation.max_tokens
        return OpenRouterChat(**kwargs)

    def _ollama(self, spec: ModelSpec, generation: GenerationSettings) -> BaseChatModel:
        kwargs: dict[str, Any] = {
            "model": spec.provider_model_name,
            "base_url": self.settings.ollama_host,
        }
        if generation.temperature is not None:
            kwargs["temperature"] = generation.temperature
        if generation.max_tokens is not None:
            kwargs["num_predict"] = generation.max_tokens
        return ChatOllama(**kwargs)


def text_of(content: Any) -> str:
    """Flatten message content (a string or a list of content blocks) to plain text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") in (None, "text"):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "".join(parts)
    return str(content) if content is not None else ""


def extract_usage(message: AIMessage, provider: str) -> TurnUsage:
    """Token counts from LangChain's usage metadata; cost from OpenRouter's usage object."""
    usage_metadata = message.usage_metadata or {}
    metadata = message.response_metadata or {}
    raw = metadata.get("openrouter_usage") or metadata.get("token_usage") or {}
    if not isinstance(raw, dict):
        raw = {}
    input_tokens = _as_int(usage_metadata.get("input_tokens"), raw.get("prompt_tokens"))
    output_tokens = _as_int(usage_metadata.get("output_tokens"), raw.get("completion_tokens"))
    cost = _as_float(raw.get("cost"))
    if provider == "ollama":
        cost = 0.0
    generation_id = metadata.get("openrouter_id") or metadata.get("id")
    return TurnUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=cost,
        generation_id=str(generation_id) if generation_id else None,
    )


async def fetch_openrouter_cost(
    generation_id: str, api_key: str, *, attempts: int = 3, delay: float = 0.7
) -> float | None:
    """Fallback when a streamed response carried no cost: ask OpenRouter for the generation."""
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=10) as client:
        for attempt in range(attempts):
            try:
                response = await client.get(
                    OPENROUTER_GENERATION_URL, params={"id": generation_id}, headers=headers
                )
                if response.status_code == 200:
                    data = response.json().get("data") or {}
                    cost = _as_float(data.get("total_cost"))
                    if cost is not None:
                        return cost
            except (httpx.HTTPError, ValueError):
                pass
            if attempt + 1 < attempts:
                await asyncio.sleep(delay)
    return None


def _as_int(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, int | float):
            return int(value)
    return None


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)
