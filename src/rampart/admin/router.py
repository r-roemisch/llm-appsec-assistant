"""Admin endpoints: Tool policy and approver switches, Approvals waiting for an admin, the audit
of Gateway decisions and Guard events, and the settings (persona, budget, Guard flags)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.admin.settings import AdminSettingsService
from rampart.db import utcnow
from rampart.deps import csrf_protect, get_db, require_admin
from rampart.errors import NotFound
from rampart.gateway.approvals import ApprovalService
from rampart.models import GuardEvent, ToolCallRecord, ToolPolicy, User
from rampart.schemas import (
    AdminSettingsIn,
    AdminSettingsOut,
    ApprovalDecisionIn,
    ApprovalOut,
    GuardEventRecordOut,
    ToolCallRecordOut,
    ToolOut,
    ToolPolicyIn,
    admin_settings_out,
    approval_out,
    guard_event_record_out,
    tool_call_record_out,
    tool_out,
)
from rampart.tools.registry import ToolRegistry
from rampart.unset import UNSET

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(csrf_protect)],
)


def get_registry(request: Request) -> ToolRegistry:
    return request.app.state.registry


def _usernames(db: Session, ids: set[int | None]) -> dict[int, str]:
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    return {u.id: u.username for u in db.scalars(select(User).where(User.id.in_(wanted)))}


@router.get("/tools", response_model=list[ToolOut])
def list_tools(
    registry: ToolRegistry = Depends(get_registry), db: Session = Depends(get_db)
) -> list[ToolOut]:
    return [tool_out(m) for m in registry.effective_all(db)]


@router.put("/tools/{name}", response_model=ToolOut)
def update_tool(
    name: str,
    body: ToolPolicyIn,
    admin: User = Depends(require_admin),
    registry: ToolRegistry = Depends(get_registry),
    db: Session = Depends(get_db),
) -> ToolOut:
    if registry.effective(db, name) is None:  # a built-in or an accepted Plugin Tool
        raise NotFound(f"unknown tool {name}")
    row = db.get(ToolPolicy, name)
    if row is None:
        row = ToolPolicy(name=name)
        db.add(row)
    provided = body.model_fields_set
    if "enabled" in provided:
        row.enabled = body.enabled
    if "approver" in provided:
        row.approver = body.approver
    if "rate_limit_per_hour" in provided:
        row.rate_limit_per_hour = body.rate_limit_per_hour
    row.updated_at = utcnow()
    row.updated_by = admin.id
    db.flush()
    manifest = registry.effective(db, name)
    db.commit()
    assert manifest is not None
    return tool_out(manifest)


@router.get("/approvals", response_model=list[ApprovalOut])
def list_approvals(
    status: str | None = Query(default=None, max_length=16),
    approver: str | None = Query(default=None, max_length=16),
    db: Session = Depends(get_db),
) -> list[ApprovalOut]:
    return [approval_out(a, db) for a in ApprovalService(db).list(status=status, approver=approver)]


@router.post("/approvals/{approval_id}", response_model=ApprovalOut)
def decide_approval(
    approval_id: str,
    body: ApprovalDecisionIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ApprovalOut:
    service = ApprovalService(db)
    approval = service.decide(service.get(approval_id), admin, body.decision)
    db.commit()
    return approval_out(approval, db)


@router.get("/audit/tool-calls", response_model=list[ToolCallRecordOut])
def audit_tool_calls(
    limit: int = Query(default=200, ge=1, le=1000),
    tool: str | None = Query(default=None, max_length=100),
    decision: str | None = Query(default=None, max_length=24),
    db: Session = Depends(get_db),
) -> list[ToolCallRecordOut]:
    query = select(ToolCallRecord).order_by(ToolCallRecord.started_at.desc()).limit(limit)
    if tool:
        query = query.where(ToolCallRecord.tool == tool)
    if decision:
        query = query.where(ToolCallRecord.decision == decision)
    records = list(db.scalars(query))
    names = _usernames(db, {r.user_id for r in records})
    return [tool_call_record_out(r, names) for r in records]


@router.get("/audit/guard-events", response_model=list[GuardEventRecordOut])
def audit_guard_events(
    limit: int = Query(default=200, ge=1, le=1000),
    guard: str | None = Query(default=None, max_length=16),
    db: Session = Depends(get_db),
) -> list[GuardEventRecordOut]:
    query = select(GuardEvent).order_by(GuardEvent.id.desc()).limit(limit)
    if guard:
        query = query.where(GuardEvent.guard == guard)
    events = list(db.scalars(query))
    names = _usernames(db, {e.user_id for e in events})
    return [guard_event_record_out(e, names) for e in events]


@router.get("/settings", response_model=AdminSettingsOut)
def get_settings(request: Request, db: Session = Depends(get_db)) -> AdminSettingsOut:
    return admin_settings_out(AdminSettingsService(db, request.app.state.settings).get())


@router.put("/settings", response_model=AdminSettingsOut)
def update_settings(
    body: AdminSettingsIn,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminSettingsOut:
    provided = body.model_fields_set
    settings = AdminSettingsService(db, request.app.state.settings).update(
        admin.id,
        persona=body.persona if "persona" in provided else UNSET,
        conversation_token_budget=(
            body.conversation_token_budget if "conversation_token_budget" in provided else UNSET
        ),
        input_guard=body.input_guard if "input_guard" in provided else UNSET,
        input_classifier=body.input_classifier if "input_classifier" in provided else UNSET,
    )
    db.commit()
    return admin_settings_out(settings)
