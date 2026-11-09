"""Feedback endpoints: a user rates their own answers; an admin reads the Feedback dashboard and
turns answers into Evaluation Cases. Nothing here touches policy, Guards, Slots or prompts."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.deps import csrf_protect, current_user, get_db, require_admin
from rampart.feedback.service import FeedbackService
from rampart.models import User
from rampart.schemas import (
    EvaluationCaseIn,
    EvaluationCaseOut,
    FeedbackDashboardOut,
    FeedbackIn,
    FeedbackOut,
    evaluation_case_out,
    feedback_out,
    feedback_record_out,
)
from rampart.tools.registry import ToolRegistry

router = APIRouter(
    prefix="/api/messages",
    tags=["feedback"],
    dependencies=[Depends(current_user), Depends(csrf_protect)],
)
admin_router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(csrf_protect)],
)

IdPath = Annotated[str, Path(max_length=36)]


def _service(request: Request, db: Session) -> FeedbackService:
    return FeedbackService(db, request.app.state.tracer)


@router.put("/{message_id}/feedback", response_model=FeedbackOut)
def set_feedback(
    body: FeedbackIn,
    request: Request,
    message_id: IdPath,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> FeedbackOut:
    row = _service(request, db).set(user, message_id, body.value, body.comment)
    db.commit()
    return feedback_out(row)


@router.delete("/{message_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
def delete_feedback(
    request: Request,
    message_id: IdPath,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Response:
    _service(request, db).delete(user, message_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@admin_router.get("/feedback", response_model=FeedbackDashboardOut)
def feedback_dashboard(
    request: Request,
    value: int | None = Query(default=None, ge=-1, le=1),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
) -> FeedbackDashboardOut:
    service = _service(request, db)
    totals = service.totals()
    records = service.records(value=value if value in (1, -1) else None, limit=limit)
    return FeedbackDashboardOut(
        up=totals.up,
        down=totals.down,
        converted=totals.converted,
        items=[feedback_record_out(r) for r in records],
    )


@admin_router.post(
    "/feedback/{feedback_id}/evaluation-case",
    response_model=EvaluationCaseOut,
    status_code=status.HTTP_201_CREATED,
)
def convert_feedback(
    body: EvaluationCaseIn,
    request: Request,
    feedback_id: IdPath,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> EvaluationCaseOut:
    registry: ToolRegistry = request.app.state.registry
    case = _service(request, db).convert(
        admin,
        feedback_id,
        kind=body.kind,
        question=body.question,
        expected_answer=body.expected_answer,
        expected_tools=body.expected_tools,
        known_tools={m.name for m in registry.effective_all(db)},
    )
    db.commit()
    return evaluation_case_out(case, {admin.id: admin.username})


@admin_router.get("/evaluation-cases", response_model=list[EvaluationCaseOut])
def list_cases(request: Request, db: Session = Depends(get_db)) -> list[EvaluationCaseOut]:
    cases = _service(request, db).cases()
    ids = {c.created_by for c in cases if c.created_by}
    names = (
        {u.id: u.username for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    )
    return [evaluation_case_out(c, names) for c in cases]


@admin_router.delete("/evaluation-cases/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_case(request: Request, case_id: IdPath, db: Session = Depends(get_db)) -> Response:
    _service(request, db).delete_case(case_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
