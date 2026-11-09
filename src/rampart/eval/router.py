"""Admin endpoints for the evaluation: dataset sizes, the cost estimate, starting a run after the
admin confirmed the estimate, and the runs with their metrics and reports."""

from __future__ import annotations

from pathlib import Path as FilePath
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, status
from sqlalchemy.orm import Session

from rampart.config import REPO_ROOT
from rampart.db import to_iso
from rampart.deps import csrf_protect, get_db, require_admin
from rampart.errors import Conflict
from rampart.eval.datasets import sizes
from rampart.eval.service import SUITE_OF, SUITES, EvalService
from rampart.models import EvalRun, User
from rampart.schemas import (
    EvalDatasetsOut,
    EvalEstimateIn,
    EvalEstimateOut,
    EvalRunDetailOut,
    EvalRunIn,
    EvalRunOut,
    SuiteEstimateOut,
)

router = APIRouter(
    prefix="/api/admin/eval",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(csrf_protect)],
)

RunId = Annotated[str, Path(max_length=36)]


def get_eval(request: Request) -> EvalService:
    return request.app.state.eval


def _suites(suite: str) -> tuple[str, ...]:
    return SUITES if suite == "all" else (suite,)


def _total(costs: list[float | None]) -> float | None:
    return None if any(c is None for c in costs) else round(sum(c or 0.0 for c in costs), 4)


def _report_name(path: str | None) -> str | None:
    if not path:
        return None
    file = FilePath(path)
    try:
        return str(file.resolve().relative_to(REPO_ROOT))
    except ValueError:
        return file.name


def _run_out(row: EvalRun, names: dict[int, str]) -> EvalRunOut:
    return EvalRunOut(
        id=row.id,
        kind=row.kind,
        suite=SUITE_OF.get(row.kind, row.kind),
        status=row.status,
        judge_model=row.judge_model,
        estimated_cost_usd=row.estimated_cost_usd,
        cost_usd=row.cost_usd,
        case_count=row.case_count,
        case_limit=row.case_limit,
        metrics=row.metrics,
        error=row.error,
        report_name=_report_name(row.report_path),
        started_by=names.get(row.started_by) if row.started_by else None,
        created_at=to_iso(row.created_at),
        finished_at=to_iso(row.finished_at) if row.finished_at else None,
    )


def _names(db: Session, rows: list[EvalRun]) -> dict[int, str]:
    return User.names(db, [r.started_by for r in rows])


@router.get("/datasets", response_model=EvalDatasetsOut)
def datasets(
    service: EvalService = Depends(get_eval), db: Session = Depends(get_db)
) -> EvalDatasetsOut:
    return EvalDatasetsOut(**sizes(service.settings.eval_dir, db))


@router.post("/estimate", response_model=EvalEstimateOut)
def estimate(body: EvalEstimateIn, service: EvalService = Depends(get_eval)) -> EvalEstimateOut:
    found = service.estimates(_suites(body.suite), body.limit)
    return EvalEstimateOut(
        estimates=[SuiteEstimateOut(**e.as_dict()) for e in found],
        total_usd=_total([e.cost_usd for e in found]),
    )


@router.post("/runs", response_model=list[EvalRunOut], status_code=status.HTTP_202_ACCEPTED)
def start_runs(
    body: EvalRunIn,
    request: Request,
    admin: User = Depends(require_admin),
    service: EvalService = Depends(get_eval),
    db: Session = Depends(get_db),
) -> list[EvalRunOut]:
    service.ensure_idle(db)
    db.commit()
    found = service.estimates(_suites(body.suite), body.limit)
    total = _total([e.cost_usd for e in found])
    confirmed = body.confirm_cost_usd
    same = (total is None and confirmed is None) or (
        total is not None
        and confirmed is not None
        and abs(total - confirmed) <= max(0.01, 0.1 * total)
    )
    if not same:
        shown = "unknown" if total is None else f"${total:.4f}"
        raise Conflict(f"the estimate is now {shown}; review it and confirm again")
    ids = service.create_runs(found, limit=body.limit, started_by=admin.id)
    request.app.state.eval_launcher(ids)
    rows = [r for r in (db.get(EvalRun, i) for i in ids) if r is not None]
    for row in rows:
        db.refresh(row)
    return [_run_out(r, {admin.id: admin.username}) for r in rows]


@router.get("/runs", response_model=list[EvalRunOut])
def list_runs(
    service: EvalService = Depends(get_eval), db: Session = Depends(get_db)
) -> list[EvalRunOut]:
    rows = service.runs(db)
    db.commit()
    return [_run_out(r, _names(db, rows)) for r in rows]


@router.get("/runs/{run_id}", response_model=EvalRunDetailOut)
def get_run(
    run_id: RunId, service: EvalService = Depends(get_eval), db: Session = Depends(get_db)
) -> EvalRunDetailOut:
    row = service.get(db, run_id)
    db.commit()
    markdown = None
    if row.report_path and FilePath(row.report_path).is_file():
        markdown = FilePath(row.report_path).read_text(encoding="utf-8")
    return EvalRunDetailOut(
        **_run_out(row, _names(db, [row])).model_dump(), report_markdown=markdown
    )
