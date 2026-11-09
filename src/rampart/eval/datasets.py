"""The evaluation datasets: authored cases in eval/*.jsonl and the cases admins added from
Feedback, which join the matching dataset on the next run."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.models import EvaluationCase

QA_FILE = "qa_cases.jsonl"
TOOL_FILE = "tool_cases.jsonl"
GUARD_FILE = "guard_cases.jsonl"
GUARD_HOLDOUT_FILE = "guard_holdout.jsonl"


class DatasetError(ValueError):
    pass


@dataclass(frozen=True)
class QaCase:
    id: str
    question: str
    expected_answer: str
    source: str  # "authored" or "feedback:<feedback id>"


@dataclass(frozen=True)
class ToolCase:
    id: str
    question: str
    expected_tools: tuple[str, ...]
    source: str


@dataclass(frozen=True)
class GuardCase:
    id: str
    label: str  # "adversarial" or "benign"
    category: str
    text: str


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise DatasetError(f"{path.name} line {number}: {exc.msg}") from exc
        if not isinstance(row, dict):
            raise DatasetError(f"{path.name} line {number}: not an object")
        rows.append(row)
    return rows


def _text(row: dict[str, Any], key: str, where: str) -> str:
    value = row.get(key)
    if not isinstance(value, str) or not value.strip():
        raise DatasetError(f"{where}: '{key}' must be a non-empty string")
    return value.strip()


def _added(db: Session | None, kind: str) -> list[EvaluationCase]:
    if db is None:
        return []
    return list(
        db.scalars(
            select(EvaluationCase)
            .where(EvaluationCase.kind == kind)
            .order_by(EvaluationCase.created_at)
        )
    )


def qa_cases(eval_dir: Path, db: Session | None = None) -> list[QaCase]:
    cases = [
        QaCase(
            id=_text(r, "id", QA_FILE),
            question=_text(r, "question", f"{QA_FILE} {r.get('id')}"),
            expected_answer=_text(r, "expected_answer", f"{QA_FILE} {r.get('id')}"),
            source="authored",
        )
        for r in read_jsonl(eval_dir / QA_FILE)
    ]
    cases += [
        QaCase(f"case-{c.id[:8]}", c.question, c.expected_answer or "", c.source)
        for c in _added(db, "qa")
        if c.expected_answer
    ]
    return cases


def tool_cases(eval_dir: Path, db: Session | None = None) -> list[ToolCase]:
    cases: list[ToolCase] = []
    for r in read_jsonl(eval_dir / TOOL_FILE):
        tools = r.get("expected_tools")
        if not isinstance(tools, list) or not all(isinstance(t, str) for t in tools):
            raise DatasetError(f"{TOOL_FILE} {r.get('id')}: 'expected_tools' must be a list")
        cases.append(
            ToolCase(
                id=_text(r, "id", TOOL_FILE),
                question=_text(r, "question", f"{TOOL_FILE} {r.get('id')}"),
                expected_tools=tuple(tools),
                source="authored",
            )
        )
    cases += [
        ToolCase(f"case-{c.id[:8]}", c.question, tuple(c.expected_tools or ()), c.source)
        for c in _added(db, "tool")
    ]
    return cases


def guard_cases(eval_dir: Path, *, holdout: bool = False) -> list[GuardCase]:
    name = GUARD_HOLDOUT_FILE if holdout else GUARD_FILE
    cases: list[GuardCase] = []
    for r in read_jsonl(eval_dir / name):
        label = r.get("label")
        if label not in ("adversarial", "benign"):
            raise DatasetError(f"{name} {r.get('id')}: label must be adversarial or benign")
        cases.append(
            GuardCase(
                id=_text(r, "id", name),
                label=label,
                category=str(r.get("category") or "uncategorised"),
                text=_text(r, "text", f"{name} {r.get('id')}"),
            )
        )
    return cases


def sizes(eval_dir: Path, db: Session | None = None) -> dict[str, dict[str, int]]:
    qa = qa_cases(eval_dir, db)
    tools = tool_cases(eval_dir, db)
    return {
        "qa": {
            "authored": sum(c.source == "authored" for c in qa),
            "added": sum(c.source != "authored" for c in qa),
        },
        "tool": {
            "authored": sum(c.source == "authored" for c in tools),
            "added": sum(c.source != "authored" for c in tools),
        },
        "guard": {
            "cases": len(guard_cases(eval_dir)),
            "holdout": len(guard_cases(eval_dir, holdout=True)),
        },
    }
