"""Fingerprints of what decides Rampart's behaviour, so a test (A18) can show that something,
Feedback in particular, changed none of it.

``policy_digest`` covers the admin-controlled state: Tool policies, settings (persona, budget,
Guard flags), Slot and Model settings, and Plugin enablement and accepted definitions.
``guard_digest`` covers the Guards' rules, which are code: the input and untrusted-text
patterns, the secret patterns and the safe response.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.models import AppSetting, ModelSetting, Plugin, SlotSetting, ToolPolicy


def _digest(material: Any) -> str:
    text = json.dumps(material, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def policy_digest(db: Session) -> str:
    return _digest(
        {
            "tool_policies": [
                [p.name, p.enabled, p.approver, p.rate_limit_per_hour]
                for p in db.scalars(select(ToolPolicy).order_by(ToolPolicy.name))
            ],
            "settings": [
                [s.key, s.value] for s in db.scalars(select(AppSetting).order_by(AppSetting.key))
            ],
            "slots": [
                [s.slot, s.model_id, s.temperature, s.max_tokens]
                for s in db.scalars(select(SlotSetting).order_by(SlotSetting.slot))
            ],
            "models": [
                [m.model_id, m.enabled]
                for m in db.scalars(select(ModelSetting).order_by(ModelSetting.model_id))
            ],
            "plugins": [
                [p.id, p.enabled, p.accepted_tools_digest]
                for p in db.scalars(select(Plugin).order_by(Plugin.id))
            ],
        }
    )


def guard_digest() -> str:
    from rampart.guards.input_guard import SAFE_RESPONSE
    from rampart.guards.patterns import AI_DIRECTED, INJECTION_RULES
    from rampart.guards.secrets import PATTERNS

    return _digest(
        {
            "input": [
                [r.category, r.weight, r.regex.pattern] for r in (*INJECTION_RULES, AI_DIRECTED)
            ],
            "secrets": [[p.kind, p.regex.pattern, p.group] for p in PATTERNS],
            "safe_response": SAFE_RESPONSE,
        }
    )
