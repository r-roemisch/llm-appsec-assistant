"""Whether each Provider can serve a Model right now: key present, Ollama reachable and pulled."""

from __future__ import annotations

import time
from typing import Protocol

import httpx

from rampart.config import Settings


class ProviderProbe(Protocol):
    def openrouter_available(self) -> bool: ...

    def ollama_models(self) -> set[str] | None:
        """Names of pulled Ollama models, or None when the server is unreachable."""
        ...


class LiveProbe:
    """Reads the environment and asks the local Ollama server, with a short cache."""

    def __init__(self, settings: Settings, timeout: float = 1.0) -> None:
        self.settings = settings
        self.timeout = timeout
        self._cached: set[str] | None = None
        self._cached_at = 0.0

    def openrouter_available(self) -> bool:
        return self.settings.openrouter_configured

    def ollama_models(self) -> set[str] | None:
        now = time.monotonic()
        if now - self._cached_at < self.settings.ollama_probe_ttl_seconds:
            return self._cached
        self._cached = self._fetch()
        self._cached_at = now
        return self._cached

    def _fetch(self) -> set[str] | None:
        try:
            response = httpx.get(f"{self.settings.ollama_host}/api/tags", timeout=self.timeout)
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        names: set[str] = set()
        for entry in payload.get("models", []):
            name = entry.get("name") or entry.get("model")
            if isinstance(name, str):
                names.add(name)
                names.add(name.removesuffix(":latest"))
        return names


def model_available(provider: str, provider_model_name: str, probe: ProviderProbe) -> bool:
    if provider == "openrouter":
        return probe.openrouter_available()
    pulled = probe.ollama_models()
    if pulled is None:
        return False
    return provider_model_name in pulled or f"{provider_model_name}:latest" in pulled
