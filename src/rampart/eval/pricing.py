"""Model prices for the estimate shown before an evaluation run: OpenRouter's public model
listing, USD per token. Local (Ollama) Models cost nothing. The run itself records the cost each
OpenRouter call reports, so the estimate is only ever compared with the real figure."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

from rampart import __version__
from rampart.catalog.catalog import ModelSpec

LISTING_URL = "https://openrouter.ai/api/v1/models"


@dataclass(frozen=True)
class Price:
    prompt: float  # USD per input token
    completion: float  # USD per output token


FREE = Price(0.0, 0.0)


def fetch_prices(
    *, transport: httpx.BaseTransport | None = None, timeout: float = 20.0
) -> dict[str, Price]:
    with httpx.Client(
        transport=transport, timeout=timeout, headers={"User-Agent": f"rampart/{__version__}"}
    ) as client:
        response = client.get(LISTING_URL)
        response.raise_for_status()
        rows = response.json().get("data", [])
    prices: dict[str, Price] = {}
    for row in rows:
        pricing = row.get("pricing") or {}
        try:
            prices[str(row["id"])] = Price(float(pricing["prompt"]), float(pricing["completion"]))
        except (KeyError, TypeError, ValueError):
            continue
    return prices


def price_for(spec: ModelSpec, prices: dict[str, Price]) -> Price | None:
    if spec.provider == "ollama":
        return FREE
    return prices.get(spec.id)
