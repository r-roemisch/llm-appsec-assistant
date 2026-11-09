"""Loading the fixed injection test suites that ship in ``fixtures/injection/``."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from rampart.errors import NotFound

SUITES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "injection"
SUITE_IDS = ("seed-v1",)


@dataclass(frozen=True)
class SuiteCase:
    id: str
    label: str  # "injection" or "benign"
    input: str
    expect_proposed: bool
    note: str


@dataclass(frozen=True)
class Suite:
    id: str
    description: str
    cases: tuple[SuiteCase, ...]

    @property
    def injection_cases(self) -> list[SuiteCase]:
        return [c for c in self.cases if c.label == "injection"]

    @property
    def benign_cases(self) -> list[SuiteCase]:
        return [c for c in self.cases if c.label == "benign"]


@cache
def load_suite(suite_id: str) -> Suite:
    if suite_id not in SUITE_IDS:
        raise NotFound(f"unknown injection suite '{suite_id[:40]}'")
    raw = json.loads((SUITES_DIR / f"{suite_id}.json").read_text(encoding="utf-8"))
    cases = tuple(
        SuiteCase(
            id=str(c["id"]),
            label=str(c["label"]),
            input=str(c["input"]),
            expect_proposed=bool(c.get("expect_proposed")),
            note=str(c.get("note", "")),
        )
        for c in raw["cases"]
    )
    return Suite(
        id=str(raw["id"]),
        description=str(raw.get("description", "")),
        cases=cases,
    )
