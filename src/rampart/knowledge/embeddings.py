"""Embeddings from the embedding Slot: OpenRouter's embeddings endpoint or a local Ollama.

Both are called with plain HTTP so the request shape stays visible and testable. OpenRouter
reports the charged cost of each request in ``usage.cost`` (usage accounting); Ollama costs
nothing. Provider errors are retried with backoff and then raised as ``EmbeddingError``.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from rampart.catalog.catalog import ModelSpec
from rampart.config import OPENROUTER_BASE_URL, Settings
from rampart.errors import ServiceUnavailable

BATCH_SIZE = 64
MAX_INPUT_CHARS = 24_000
RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class EmbeddingError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmbeddingBatch:
    vectors: list[list[float]]
    input_tokens: int | None
    cost_usd: float | None


class Embedder(Protocol):
    spec: ModelSpec

    async def embed(self, texts: Sequence[str]) -> EmbeddingBatch: ...


class EmbedderFactory(Protocol):
    def build(self, spec: ModelSpec) -> Embedder:
        """An embedder for the catalog entry, or ``ServiceUnavailable`` explaining why not."""
        ...


def _merge(batches: list[EmbeddingBatch]) -> EmbeddingBatch:
    vectors = [v for batch in batches for v in batch.vectors]
    tokens = [b.input_tokens for b in batches]
    costs = [b.cost_usd for b in batches]
    return EmbeddingBatch(
        vectors=vectors,
        input_tokens=None if any(t is None for t in tokens) else sum(t or 0 for t in tokens),
        cost_usd=None if any(c is None for c in costs) else sum(c or 0.0 for c in costs),
    )


async def _post_with_retries(
    client: httpx.AsyncClient, url: str, payload: dict[str, Any], *, attempts: int = 3
) -> dict[str, Any]:
    delay = 1.0
    last: str = "no response"
    for attempt in range(attempts):
        try:
            response = await client.post(url, json=payload)
        except httpx.HTTPError as exc:
            last = f"{type(exc).__name__}: {exc}"
        else:
            if response.status_code == 200:
                try:
                    return response.json()
                except ValueError as exc:
                    raise EmbeddingError("the embedding response was not JSON") from exc
            last = f"status {response.status_code}: {response.text[:300]}"
            if response.status_code not in RETRY_STATUS:
                break
        if attempt + 1 < attempts:
            await asyncio.sleep(delay)
            delay *= 2
    raise EmbeddingError(f"embedding request failed ({last})")


class OpenRouterEmbedder:
    def __init__(self, spec: ModelSpec, api_key: str, *, app_url: str, timeout: float = 60.0):
        self.spec = spec
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "HTTP-Referer": app_url,
            "X-Title": "Rampart",
        }
        self._timeout = timeout

    async def embed(self, texts: Sequence[str]) -> EmbeddingBatch:
        batches: list[EmbeddingBatch] = []
        async with httpx.AsyncClient(headers=self._headers, timeout=self._timeout) as client:
            for start in range(0, len(texts), BATCH_SIZE):
                part = [t[:MAX_INPUT_CHARS] for t in texts[start : start + BATCH_SIZE]]
                payload = {"model": self.spec.id, "input": part, "usage": {"include": True}}
                body = await _post_with_retries(
                    client, f"{OPENROUTER_BASE_URL}/embeddings", payload
                )
                data = sorted(body.get("data") or [], key=lambda item: item.get("index", 0))
                vectors = [list(map(float, item["embedding"])) for item in data]
                if len(vectors) != len(part):
                    raise EmbeddingError(f"expected {len(part)} vectors, got {len(vectors)}")
                usage = body.get("usage") or {}
                cost = usage.get("cost")
                tokens = usage.get("prompt_tokens")
                batches.append(
                    EmbeddingBatch(
                        vectors=vectors,
                        input_tokens=int(tokens) if isinstance(tokens, int | float) else None,
                        cost_usd=float(cost) if isinstance(cost, int | float) else None,
                    )
                )
        return _merge(batches)


class OllamaEmbedder:
    def __init__(self, spec: ModelSpec, host: str, *, timeout: float = 120.0):
        self.spec = spec
        self._host = host
        self._timeout = timeout

    async def embed(self, texts: Sequence[str]) -> EmbeddingBatch:
        batches: list[EmbeddingBatch] = []
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            for start in range(0, len(texts), BATCH_SIZE):
                part = [t[:MAX_INPUT_CHARS] for t in texts[start : start + BATCH_SIZE]]
                payload = {"model": self.spec.provider_model_name, "input": part}
                body = await _post_with_retries(client, f"{self._host}/api/embed", payload)
                vectors = [list(map(float, v)) for v in body.get("embeddings") or []]
                if len(vectors) != len(part):
                    raise EmbeddingError(f"expected {len(part)} vectors, got {len(vectors)}")
                tokens = body.get("prompt_eval_count")
                batches.append(
                    EmbeddingBatch(
                        vectors=vectors,
                        input_tokens=int(tokens) if isinstance(tokens, int | float) else None,
                        cost_usd=0.0,
                    )
                )
        return _merge(batches)


class ProviderEmbedderFactory:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def build(self, spec: ModelSpec) -> Embedder:
        if spec.kind != "embedding":
            raise ServiceUnavailable(f"{spec.id} is not an embedding model")
        if spec.provider == "openrouter":
            key = self.settings.openrouter_api_key
            if key is None:
                raise ServiceUnavailable("OpenRouter is not configured (no OPENROUTER_API_KEY)")
            return OpenRouterEmbedder(spec, key.get_secret_value(), app_url=self.settings.app_url)
        return OllamaEmbedder(spec, self.settings.ollama_host)
