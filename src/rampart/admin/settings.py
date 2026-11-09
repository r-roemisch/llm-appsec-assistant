"""Admin settings stored in the database: the persona, the Conversation token budget, and the
input Guard flags. The security rules the code appends to every prompt (untrusted data, Tool
rules, Citations) are not part of the persona and cannot be edited."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from rampart.chat.prompts import PERSONA
from rampart.config import Settings
from rampart.errors import Invalid
from rampart.models import AppSetting
from rampart.unset import UNSET, Unset

PERSONA_RANGE = (50, 8000)
BUDGET_RANGE = (1_000, 10_000_000)


@dataclass(frozen=True)
class AdminSettings:
    persona: str
    persona_is_default: bool
    conversation_token_budget: int
    input_guard: bool
    input_classifier: bool


class AdminSettingsService:
    def __init__(self, db: Session, settings: Settings) -> None:
        self.db = db
        self.settings = settings

    def _value(self, key: str) -> Any:
        return AppSetting.read(self.db, key)

    def get(self) -> AdminSettings:
        persona = self._value("persona")
        budget = self._value("conversation_token_budget")
        input_guard = self._value("input_guard")
        classifier = self._value("input_classifier")
        return AdminSettings(
            persona=persona if isinstance(persona, str) and persona else PERSONA,
            persona_is_default=not (isinstance(persona, str) and persona),
            conversation_token_budget=budget
            if isinstance(budget, int)
            else self.settings.conversation_token_budget,
            input_guard=input_guard if isinstance(input_guard, bool) else True,
            input_classifier=classifier if isinstance(classifier, bool) else False,
        )

    def _set(self, key: str, value: Any, actor_id: int) -> None:
        AppSetting.write(self.db, key, value, actor_id)

    def update(
        self,
        actor_id: int,
        *,
        persona: Any = UNSET,
        conversation_token_budget: Any = UNSET,
        input_guard: Any = UNSET,
        input_classifier: Any = UNSET,
    ) -> AdminSettings:
        if not isinstance(persona, Unset):
            if persona is not None:
                persona = str(persona).strip()
                lo, hi = PERSONA_RANGE
                if not lo <= len(persona) <= hi:
                    raise Invalid(
                        f"the persona must be {lo} to {hi} characters (null restores the default)"
                    )
            self._set("persona", persona, actor_id)
        if not isinstance(conversation_token_budget, Unset):
            if conversation_token_budget is not None:
                lo, hi = BUDGET_RANGE
                if (
                    not isinstance(conversation_token_budget, int)
                    or not lo <= conversation_token_budget <= hi
                ):
                    raise Invalid(f"the conversation token budget must be {lo} to {hi}")
            self._set("conversation_token_budget", conversation_token_budget, actor_id)
        for key, value in (("input_guard", input_guard), ("input_classifier", input_classifier)):
            if not isinstance(value, Unset):
                if value is not None and not isinstance(value, bool):
                    raise Invalid(f"{key} must be true or false")
                self._set(key, value, actor_id)
        self.db.flush()
        return self.get()
