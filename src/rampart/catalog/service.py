"""Catalog views for the API, Slot resolution, and the admin overrides stored in the database."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.catalog.catalog import (
    SLOT_KIND,
    SLOTS,
    Catalog,
    ModelSpec,
    validate_generation_settings,
)
from rampart.catalog.providers import ProviderProbe, model_available
from rampart.db import utcnow
from rampart.errors import Invalid, NotFound
from rampart.models import ModelSetting, SlotSetting


class _Unset:
    pass


UNSET = _Unset()


@dataclass(frozen=True)
class ModelView:
    spec: ModelSpec
    enabled: bool
    available: bool


@dataclass(frozen=True)
class SlotConfig:
    slot: str
    model: ModelSpec
    source: Literal["default", "override"]
    temperature: float | None
    max_tokens: int | None


class CatalogService:
    def __init__(self, db: Session, catalog: Catalog, probe: ProviderProbe) -> None:
        self.db = db
        self.catalog = catalog
        self.probe = probe

    # --- models -------------------------------------------------------------------

    def get_spec(self, model_id: str) -> ModelSpec:
        spec = self.catalog.models.get(model_id)
        if spec is None:
            raise NotFound(f"unknown model {model_id}")
        return spec

    def is_enabled(self, model_id: str) -> bool:
        row = self.db.get(ModelSetting, model_id)
        return True if row is None else row.enabled

    def _disabled_ids(self) -> set[str]:
        rows = self.db.scalars(select(ModelSetting).where(ModelSetting.enabled.is_(False)))
        return {row.model_id for row in rows}

    def model_views(self) -> list[ModelView]:
        disabled = self._disabled_ids()
        return [
            ModelView(
                spec=spec,
                enabled=spec.id not in disabled,
                available=model_available(spec.provider, spec.provider_model_name, self.probe),
            )
            for spec in self.catalog.models.values()
        ]

    def model_view(self, model_id: str) -> ModelView:
        spec = self.get_spec(model_id)
        return ModelView(
            spec=spec,
            enabled=self.is_enabled(model_id),
            available=model_available(spec.provider, spec.provider_model_name, self.probe),
        )

    def set_enabled(self, model_id: str, enabled: bool) -> ModelView:
        spec = self.get_spec(model_id)
        if not enabled:
            users = [s for s, cfg in self.slot_configs().items() if cfg.model.id == spec.id]
            if users:
                raise Invalid(
                    f"model {spec.id} is assigned to slot(s) {', '.join(users)}; reassign first"
                )
        row = self.db.get(ModelSetting, model_id)
        if row is None:
            row = ModelSetting(model_id=model_id, enabled=enabled)
            self.db.add(row)
        else:
            row.enabled = enabled
            row.updated_at = utcnow()
        self.db.flush()
        return self.model_view(model_id)

    def resolve_chat_model(self, model_id: str) -> ModelSpec:
        """The Model a Conversation may use for its next turn: known, enabled, and a chat Model."""
        spec = self.catalog.models.get(model_id)
        if spec is None:
            raise Invalid(f"unknown model {model_id}")
        if spec.kind != "chat":
            raise Invalid(f"model {model_id} is not a chat model")
        if not self.is_enabled(model_id):
            raise Invalid(f"model {model_id} is disabled")
        return spec

    # --- slots --------------------------------------------------------------------

    def slot_config(self, slot: str) -> SlotConfig:
        if slot not in SLOTS:
            raise NotFound(f"unknown slot {slot}")
        default = self.catalog.slot_defaults[slot]
        row = self.db.get(SlotSetting, slot)
        if row is None:
            return SlotConfig(
                slot=slot,
                model=self.catalog.models[default.model_id],
                source="default",
                temperature=default.temperature,
                max_tokens=default.max_tokens,
            )
        model = self.catalog.models.get(row.model_id or default.model_id)
        if model is None:  # the catalog file changed under an old override
            model = self.catalog.models[default.model_id]
        return SlotConfig(
            slot=slot,
            model=model,
            source="override",
            temperature=row.temperature,
            max_tokens=row.max_tokens,
        )

    def slot_configs(self) -> dict[str, SlotConfig]:
        return {slot: self.slot_config(slot) for slot in SLOTS}

    def set_slot(
        self,
        slot: str,
        *,
        model_id: str | _Unset = UNSET,
        temperature: float | None | _Unset = UNSET,
        max_tokens: int | None | _Unset = UNSET,
    ) -> dict[str, SlotConfig]:
        current = self.slot_config(slot)
        new_model = current.model
        if not isinstance(model_id, _Unset):
            new_model = self.get_spec(model_id)
            if new_model.kind != SLOT_KIND[slot]:
                raise Invalid(f"slot '{slot}' needs a {SLOT_KIND[slot]} model")
            if not self.is_enabled(new_model.id):
                raise Invalid(f"model {new_model.id} is disabled")
        new_temperature = current.temperature if isinstance(temperature, _Unset) else temperature
        new_max_tokens = current.max_tokens if isinstance(max_tokens, _Unset) else max_tokens
        validate_generation_settings(slot, new_temperature, new_max_tokens)
        row = self.db.get(SlotSetting, slot)
        if row is None:
            row = SlotSetting(slot=slot)
            self.db.add(row)
        row.model_id = new_model.id
        row.temperature = new_temperature
        row.max_tokens = new_max_tokens
        row.updated_at = utcnow()
        self.db.flush()
        return self.slot_configs()

    def reset_slot(self, slot: str) -> dict[str, SlotConfig]:
        self.slot_config(slot)  # validates the name
        row = self.db.get(SlotSetting, slot)
        if row is not None:
            self.db.delete(row)
            self.db.flush()
        return self.slot_configs()
