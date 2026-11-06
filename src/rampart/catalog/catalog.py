"""The Model catalog from models.yaml, Slot defaults, and admin overrides kept in the database."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml

from rampart.errors import Invalid

Provider = Literal["openrouter", "ollama"]
Kind = Literal["chat", "embedding"]
Tier = Literal["cheap", "powerful"]

PROVIDERS: tuple[Provider, ...] = ("openrouter", "ollama")
KINDS: tuple[Kind, ...] = ("chat", "embedding")
TIERS: tuple[Tier, ...] = ("cheap", "powerful")
SLOTS: tuple[str, ...] = ("chat", "grader", "judge", "embedding")
SLOT_KIND: dict[str, Kind] = {
    "chat": "chat",
    "grader": "chat",
    "judge": "chat",
    "embedding": "embedding",
}
OLLAMA_PREFIX = "ollama/"
TEMPERATURE_RANGE = (0.0, 2.0)
MAX_TOKENS_RANGE = (1, 128_000)


@dataclass(frozen=True)
class ModelSpec:
    id: str
    provider: Provider
    display_name: str
    kind: Kind
    tier: Tier
    context_length: int | None = None
    notes: str | None = None

    @property
    def provider_model_name(self) -> str:
        """The name the Provider knows: OpenRouter ids as-is, Ollama ids without the prefix."""
        if self.provider == "ollama":
            return self.id.removeprefix(OLLAMA_PREFIX)
        return self.id


@dataclass(frozen=True)
class SlotDefault:
    model_id: str
    temperature: float | None = None
    max_tokens: int | None = None


@dataclass(frozen=True)
class Catalog:
    models: dict[str, ModelSpec]
    slot_defaults: dict[str, SlotDefault]

    @classmethod
    def load(cls, path: Path) -> Catalog:
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise Invalid(f"model catalog not found: {path}") from exc
        return cls.from_mapping(raw)

    @classmethod
    def from_mapping(cls, raw: Any) -> Catalog:
        if not isinstance(raw, dict) or not isinstance(raw.get("models"), list):
            raise Invalid("model catalog must contain a 'models' list")
        models: dict[str, ModelSpec] = {}
        for entry in raw["models"]:
            spec = _parse_model(entry)
            if spec.id in models:
                raise Invalid(f"duplicate model id in catalog: {spec.id}")
            models[spec.id] = spec
        if not models:
            raise Invalid("model catalog has no models")
        slots_raw = raw.get("slots") or {}
        slot_defaults: dict[str, SlotDefault] = {}
        for slot in SLOTS:
            entry = slots_raw.get(slot)
            if not isinstance(entry, dict) or "model" not in entry:
                raise Invalid(f"model catalog is missing the '{slot}' slot default")
            default = SlotDefault(
                model_id=str(entry["model"]),
                temperature=_opt_float(entry.get("temperature"), f"slots.{slot}.temperature"),
                max_tokens=_opt_int(entry.get("max_tokens"), f"slots.{slot}.max_tokens"),
            )
            spec = models.get(default.model_id)
            if spec is None:
                raise Invalid(f"slot '{slot}' refers to unknown model {default.model_id}")
            if spec.kind != SLOT_KIND[slot]:
                raise Invalid(f"slot '{slot}' needs a {SLOT_KIND[slot]} model, got {spec.id}")
            validate_generation_settings(slot, default.temperature, default.max_tokens)
            slot_defaults[slot] = default
        return cls(models=models, slot_defaults=slot_defaults)


def validate_generation_settings(
    slot: str, temperature: float | None, max_tokens: int | None
) -> None:
    if slot == "embedding":
        if temperature is not None or max_tokens is not None:
            raise Invalid("the embedding slot takes no temperature or max_tokens")
        return
    if temperature is not None and not (
        TEMPERATURE_RANGE[0] <= temperature <= TEMPERATURE_RANGE[1]
    ):
        raise Invalid(
            f"temperature must be between {TEMPERATURE_RANGE[0]} and {TEMPERATURE_RANGE[1]}"
        )
    if max_tokens is not None and not (MAX_TOKENS_RANGE[0] <= max_tokens <= MAX_TOKENS_RANGE[1]):
        raise Invalid(f"max_tokens must be between {MAX_TOKENS_RANGE[0]} and {MAX_TOKENS_RANGE[1]}")


def _parse_model(entry: Any) -> ModelSpec:
    if not isinstance(entry, dict):
        raise Invalid("each catalog model must be a mapping")
    try:
        model_id = str(entry["id"])
        provider = str(entry["provider"])
        kind = str(entry["kind"])
        tier = str(entry["tier"])
        display_name = str(entry.get("display_name") or model_id)
    except KeyError as exc:
        raise Invalid(f"catalog model is missing field {exc}") from exc
    if provider not in PROVIDERS:
        raise Invalid(f"model {model_id}: provider must be one of {', '.join(PROVIDERS)}")
    if kind not in KINDS:
        raise Invalid(f"model {model_id}: kind must be one of {', '.join(KINDS)}")
    if tier not in TIERS:
        raise Invalid(f"model {model_id}: tier must be one of {', '.join(TIERS)}")
    if provider == "ollama" and not model_id.startswith(OLLAMA_PREFIX):
        raise Invalid(f"model {model_id}: Ollama ids must start with '{OLLAMA_PREFIX}'")
    if provider == "openrouter" and model_id.startswith(OLLAMA_PREFIX):
        raise Invalid(f"model {model_id}: OpenRouter ids must not start with '{OLLAMA_PREFIX}'")
    return ModelSpec(
        id=model_id,
        provider=provider,  # type: ignore[arg-type]
        display_name=display_name,
        kind=kind,  # type: ignore[arg-type]
        tier=tier,  # type: ignore[arg-type]
        context_length=_opt_int(entry.get("context_length"), f"{model_id}.context_length"),
        notes=(str(entry["notes"]) if entry.get("notes") is not None else None),
    )


def _opt_float(value: Any, field: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise Invalid(f"{field} must be a number or null")
    return float(value)


def _opt_int(value: Any, field: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise Invalid(f"{field} must be an integer or null")
    return value
