"""Deciding Approvals. The Model can only cause an Approval to be requested; it never decides one.

By default the requesting user approves. When an admin switched a Tool to admin approval, only
an admin can approve (the requester can still reject, which cancels the call). A decision is
accepted only while the Approval is pending and unexpired; the Gateway consumes it once.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.db import utcnow
from rampart.errors import Conflict, Forbidden, Invalid, NotFound
from rampart.models import Approval, User

DECISIONS = ("approve", "reject")


class ApprovalService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def for_conversation(self, approval_id: str, conversation_id: str, user_id: int) -> Approval:
        approval = self.db.get(Approval, approval_id)
        if (
            approval is None
            or approval.conversation_id != conversation_id
            or approval.requested_by != user_id
        ):
            raise NotFound("approval not found")
        return approval

    def get(self, approval_id: str) -> Approval:
        approval = self.db.get(Approval, approval_id)
        if approval is None:
            raise NotFound("approval not found")
        return approval

    def decide(self, approval: Approval, actor: User, decision: str) -> Approval:
        if decision not in DECISIONS:
            raise Invalid("decision must be 'approve' or 'reject'")
        now = utcnow()
        if approval.status == "pending" and approval.expires_at <= now:
            approval.status = "expired"
            self.db.flush()
        if approval.status != "pending":
            raise Conflict(f"this approval is {approval.status}")
        if decision == "approve":
            if approval.approver == "admin" and actor.role != "admin":
                raise Forbidden("an administrator must approve this tool call")
            if approval.approver == "requester" and actor.id != approval.requested_by:
                raise Forbidden("only the person who asked can approve this tool call")
        elif actor.id != approval.requested_by and actor.role != "admin":
            raise Forbidden("you cannot decide this approval")
        approval.status = "approved" if decision == "approve" else "rejected"
        approval.decided_by = actor.id
        approval.decided_at = now
        self.db.flush()
        return approval

    def list(self, *, status: str | None = None, approver: str | None = None) -> list[Approval]:
        query = select(Approval).order_by(Approval.created_at.desc()).limit(200)
        if status:
            query = query.where(Approval.status == status)
        if approver:
            query = query.where(Approval.approver == approver)
        return list(self.db.scalars(query))

    def latest_for_messages(self, message_ids: list[str]) -> dict[str, Approval]:
        if not message_ids:
            return {}
        rows = self.db.scalars(
            select(Approval)
            .where(Approval.message_id.in_(message_ids))
            .order_by(Approval.created_at)
        )
        return {row.message_id: row for row in rows if row.message_id}
