"""User endpoints: the Tools a user's turns may use, and the user's own Reports."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from rampart.deps import csrf_protect, current_user, get_db
from rampart.models import User
from rampart.schemas import ReportDetailOut, ReportOut, ToolOut
from rampart.tools.registry import ToolRegistry
from rampart.tools.reports import ReportService

router = APIRouter(
    prefix="/api",
    tags=["tools"],
    dependencies=[Depends(current_user), Depends(csrf_protect)],
)


def get_registry(request: Request) -> ToolRegistry:
    return request.app.state.registry


@router.get("/tools", response_model=list[ToolOut])
def list_tools(
    user: User = Depends(current_user),
    registry: ToolRegistry = Depends(get_registry),
    db: Session = Depends(get_db),
) -> list[ToolOut]:
    return [ToolOut.model_validate(m) for m in registry.available_to(db, user.role)]


@router.get("/reports", response_model=list[ReportOut])
def list_reports(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[ReportOut]:
    return [ReportOut.model_validate(r) for r in ReportService(db).list(user.id)]


@router.get("/reports/{report_id}", response_model=ReportDetailOut)
def get_report(
    report_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> ReportDetailOut:
    return ReportDetailOut.model_validate(ReportService(db).get(user.id, report_id))


@router.get("/reports/{report_id}/download")
def download_report(
    report_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    report = ReportService(db).get(user.id, report_id)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", report.title).strip("-").lower()[:60] or "report"
    return Response(
        content=report.markdown,
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{slug}.md"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/reports/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(
    report_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    ReportService(db).delete(user.id, report_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
