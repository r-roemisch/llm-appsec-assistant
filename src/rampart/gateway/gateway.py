"""The Gateway: registry membership, enabled flag, role, JSON-schema validation with no extra
properties, the per-turn bound, the rate limit, the Conversation budget, argument constraints,
and an Approval bound to the argument digest and consumed once. Every decision is audited.

The Gateway is ordinary code: it reads only the call, the caller and the stored policy. No
text a Model has read can change its answer, and no Tool can edit policy.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from jsonschema import Draft202012Validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from rampart.config import Settings
from rampart.db import session_scope, utcnow
from rampart.gateway.constraints import CONSTRAINTS
from rampart.guards.secrets import redact_value
from rampart.models import Approval, ToolCallRecord
from rampart.tools.registry import ToolManifest, ToolRegistry

MAX_STORED_STRING = 2000
MAX_STORED_RESULT = 50_000

BLOCKED_MESSAGES = {
    "plugin_disabled": "the Plugin that provides this tool is disabled by an administrator",
    "plugin_drift": (
        "the Plugin's tool definitions changed since an administrator accepted them; "
        "an administrator must review and accept the change first"
    ),
    "plugin_missing": "the Plugin that provides this tool is no longer in the Plugin catalog",
}


def args_digest(tool: str, arguments: dict[str, Any]) -> str:
    canonical = json.dumps(
        {"tool": tool, "arguments": arguments}, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _cap(value: Any) -> Any:
    if isinstance(value, str) and len(value) > MAX_STORED_STRING:
        return value[:MAX_STORED_STRING] + f"…(+{len(value) - MAX_STORED_STRING} chars)"
    if isinstance(value, list):
        return [_cap(v) for v in value]
    if isinstance(value, dict):
        return {k: _cap(v) for k, v in value.items()}
    return value


def stored_arguments(arguments: dict[str, Any]) -> dict[str, Any]:
    """Arguments as the audit log and the UI keep them: secrets redacted, long strings shortened."""
    value = _cap(redact_value(arguments))
    return value if isinstance(value, dict) else {}


@dataclass(frozen=True)
class Decision:
    decision: str  # "allow", "deny" or "approval_required"
    reason_code: str
    message: str
    tool: str
    args_digest: str
    record_id: str
    manifest: ToolManifest | None = None
    approval_id: str | None = None


class Gateway:
    def __init__(
        self, session_factory: sessionmaker[Session], registry: ToolRegistry, settings: Settings
    ) -> None:
        self.session_factory = session_factory
        self.registry = registry
        self.settings = settings

    def check(
        self,
        *,
        user_id: int,
        role: str,
        conversation_id: str,
        message_id: str | None,
        tool_call_id: str,
        tool: str,
        arguments: Any,
        turn_tool_calls: int = 0,
        conversation_tokens: int = 0,
        token_budget: int | None = None,
    ) -> Decision:
        args = arguments if isinstance(arguments, dict) else {"_raw": arguments}
        digest = args_digest(tool, args)
        with session_scope(self.session_factory) as db:
            manifest, decision, reason, message, approval_id = self._decide(
                db,
                user_id=user_id,
                role=role,
                conversation_id=conversation_id,
                message_id=message_id,
                tool_call_id=tool_call_id,
                tool=tool,
                args=args,
                digest=digest,
                turn_tool_calls=turn_tool_calls,
                conversation_tokens=conversation_tokens,
                token_budget=token_budget,
            )
            record = ToolCallRecord(
                message_id=message_id,
                conversation_id=conversation_id,
                user_id=user_id,
                tool=tool[:100],
                tool_call_id=tool_call_id[:100],
                arguments=stored_arguments(args),
                args_digest=digest,
                decision=decision,
                reason_code=reason,
                message=message,
            )
            db.add(record)
            db.flush()
            record_id = record.id
        return Decision(decision, reason, message, tool, digest, record_id, manifest, approval_id)

    def _decide(
        self,
        db: Session,
        *,
        user_id: int,
        role: str,
        conversation_id: str,
        message_id: str | None,
        tool_call_id: str,
        tool: str,
        args: dict[str, Any],
        digest: str,
        turn_tool_calls: int,
        conversation_tokens: int,
        token_budget: int | None,
    ) -> tuple[ToolManifest | None, str, str, str, str | None]:
        manifest = self.registry.effective(db, tool)
        if manifest is None:
            return None, "deny", "unknown_tool", f"there is no tool named '{tool[:60]}'", None
        if manifest.blocked is not None:
            return (
                manifest,
                "deny",
                manifest.blocked,
                BLOCKED_MESSAGES.get(manifest.blocked, f"{tool} cannot be used right now"),
                None,
            )
        if not manifest.enabled:
            return (
                manifest,
                "deny",
                "tool_disabled",
                f"{tool} is disabled by an administrator",
                None,
            )
        if role not in manifest.allowed_roles:
            return manifest, "deny", "role_forbidden", f"your role may not use {tool}", None
        errors = sorted(
            Draft202012Validator(manifest.json_schema).iter_errors(args), key=lambda e: list(e.path)
        )
        if errors:
            first = errors[0]
            where = "/".join(str(p) for p in first.path) or "arguments"
            return manifest, "deny", "invalid_arguments", f"{where}: {first.message}"[:300], None
        if turn_tool_calls >= self.settings.max_tool_calls_per_turn:
            limit = self.settings.max_tool_calls_per_turn
            return (
                manifest,
                "deny",
                "turn_limit",
                f"this turn already made {limit} tool calls",
                None,
            )
        if manifest.rate_limit_per_hour:
            since = utcnow() - timedelta(hours=1)
            used = (
                db.scalar(
                    select(func.count(ToolCallRecord.id)).where(
                        ToolCallRecord.user_id == user_id,
                        ToolCallRecord.tool == tool,
                        ToolCallRecord.decision == "allow",
                        ToolCallRecord.started_at >= since,
                    )
                )
                or 0
            )
            if used >= manifest.rate_limit_per_hour:
                return (
                    manifest,
                    "deny",
                    "rate_limited",
                    f"{tool} is limited to {manifest.rate_limit_per_hour} calls per hour",
                    None,
                )
        if token_budget is not None and conversation_tokens >= token_budget:
            return (
                manifest,
                "deny",
                "conversation_budget",
                f"the conversation used its budget of {token_budget} tokens",
                None,
            )
        for name in manifest.argument_constraints:
            violation = CONSTRAINTS[name](args, db, user_id, conversation_id)
            if violation is not None:
                return manifest, "deny", violation[0], violation[1], None
        if not manifest.requires_approval:
            return manifest, "allow", "allowed", "allowed by policy", None
        return self._approval(
            db, manifest, user_id, conversation_id, message_id, tool_call_id, args, digest
        )

    def _approval(
        self,
        db: Session,
        manifest: ToolManifest,
        user_id: int,
        conversation_id: str,
        message_id: str | None,
        tool_call_id: str,
        args: dict[str, Any],
        digest: str,
    ) -> tuple[ToolManifest, str, str, str, str | None]:
        now = utcnow()
        approval = db.scalar(  # one turn's call: providers may reuse call ids across turns
            select(Approval).where(
                Approval.tool_call_id == tool_call_id[:100],
                Approval.conversation_id == conversation_id,
                Approval.message_id == message_id if message_id else Approval.message_id.is_(None),
            )
        )
        who = "an administrator" if manifest.approver == "admin" else "the user"
        if approval is None:
            ttl = (
                timedelta(hours=self.settings.admin_approval_ttl_hours)
                if manifest.approver == "admin"
                else timedelta(minutes=self.settings.approval_ttl_minutes)
            )
            approval = Approval(
                tool_call_id=tool_call_id[:100],
                conversation_id=conversation_id,
                message_id=message_id,
                requested_by=user_id,
                tool=manifest.name,
                arguments=stored_arguments(args),
                args_digest=digest,
                approver=manifest.approver,
                status="pending",
                expires_at=now + ttl,
            )
            db.add(approval)
            db.flush()
            return (
                manifest,
                "approval_required",
                "approval_pending",
                f"waiting for approval by {who}",
                approval.id,
            )
        if approval.args_digest != digest:
            return (
                manifest,
                "deny",
                "approval_mismatch",
                "the arguments differ from the approved ones; a new approval is needed",
                approval.id,
            )
        if approval.status in ("pending", "approved") and approval.expires_at <= now:
            approval.status = "expired"
        if approval.status == "pending":
            return (
                manifest,
                "approval_required",
                "approval_pending",
                f"waiting for approval by {who}",
                approval.id,
            )
        if approval.status == "approved":
            approval.status = "consumed"
            approval.consumed_at = now
            return manifest, "allow", "approved", f"approved by {who}", approval.id
        reasons = {
            "rejected": ("approval_rejected", "the approver rejected this call"),
            "expired": ("approval_expired", "the approval expired before it was used"),
            "consumed": ("approval_consumed", "this approval was already used"),
        }
        code, message = reasons.get(
            approval.status, ("approval_invalid", "the approval is not valid")
        )
        return manifest, "deny", code, message, approval.id

    def record_result(
        self,
        record_id: str,
        *,
        result: dict[str, Any] | None,
        duration_ms: int,
        error_class: str | None,
    ) -> None:
        stored = _cap(redact_value(result)) if result is not None else None
        text = json.dumps(stored, sort_keys=True, default=str) if stored is not None else None
        if text is not None and len(text) > MAX_STORED_RESULT:
            stored = {"truncated": True, "chars": len(text)}
        with session_scope(self.session_factory) as db:
            record = db.get(ToolCallRecord, record_id)
            if record is None:
                return
            record.result = stored if isinstance(stored, dict) else None
            record.result_digest = (
                hashlib.sha256(text.encode("utf-8")).hexdigest() if text else None
            )
            record.duration_ms = duration_ms
            record.error_class = error_class
