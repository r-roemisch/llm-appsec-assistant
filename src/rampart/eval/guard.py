"""Guard metrics: replay the labelled inputs through the input Guard's heuristics (G1) and count.
Detection means the input would be blocked; a benign input that is blocked is a false positive.
The Holdout Set was never used to tune the rules.

With the classifier option the grader Slot's model classifier (the admin flag) also judges every
input, through the same function the turn graph uses, and the report adds two more rows per set:
the classifier alone, and the combination the runtime applies with the flag on (blocked when the
heuristics or the classifier say so). A classifier call that fails counts as "not an attack",
as it does at runtime."""

from __future__ import annotations

import asyncio
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

from rampart.eval.datasets import GuardCase, guard_cases
from rampart.guards.input_guard import check_input


def _ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def score(
    cases: list[GuardCase], decide: Callable[[GuardCase], bool] | None = None
) -> dict[str, Any]:
    tp = fn = fp = tn = 0
    missed: list[dict[str, str]] = []
    blocked_benign: list[dict[str, str]] = []
    per_category: Counter[str] = Counter()
    per_category_hits: Counter[str] = Counter()
    for case in cases:
        blocked = decide(case) if decide is not None else check_input(case.text).blocked
        if case.label == "adversarial":
            per_category[case.category] += 1
            if blocked:
                tp += 1
                per_category_hits[case.category] += 1
            else:
                fn += 1
                missed.append({"id": case.id, "category": case.category})
        elif blocked:
            fp += 1
            blocked_benign.append({"id": case.id, "category": case.category})
        else:
            tn += 1
    precision = _ratio(tp, tp + fp)
    recall = _ratio(tp, tp + fn)
    f1 = round(2 * precision * recall / (precision + recall), 4) if precision and recall else None
    return {
        "adversarial": tp + fn,
        "benign": fp + tn,
        "true_positives": tp,
        "false_negatives": fn,
        "false_positives": fp,
        "true_negatives": tn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "false_positive_rate": _ratio(fp, fp + tn),
        "recall_by_category": {
            c: _ratio(per_category_hits[c], n) for c, n in sorted(per_category.items())
        },
        "missed": missed,
        "blocked_benign": blocked_benign,
    }


def run(eval_dir: Path) -> dict[str, Any]:
    return {
        "cases": score(guard_cases(eval_dir)),
        "holdout": score(guard_cases(eval_dir, holdout=True)),
    }


async def classify_all(
    cases: list[GuardCase],
    llm: Any,
    on_reply: Callable[[Any], Any] | None = None,
    concurrency: int = 4,
) -> dict[str, bool | None]:
    """The classifier's verdict per case id (None when the call failed)."""
    from rampart.guards.input_guard import classify_message

    gate = asyncio.Semaphore(concurrency)
    verdicts: dict[str, bool | None] = {}

    async def one(case: GuardCase) -> None:
        async with gate:
            # The runtime classifies the message after secrets are redacted.
            verdict = await classify_message(llm, check_input(case.text, heuristics=False).text)
        if verdict.reply is not None and on_reply is not None:
            await on_reply(verdict.reply)
        verdicts[case.id] = verdict.attack

    await asyncio.gather(*(one(c) for c in cases))
    return verdicts


def classifier_metrics(eval_dir: Path, verdicts: dict[str, bool | None]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, holdout in (("cases", False), ("holdout", True)):
        cases = guard_cases(eval_dir, holdout=holdout)
        out[key] = {
            "classifier": score(cases, lambda c: verdicts.get(c.id) is True),
            "combined": score(
                cases, lambda c: check_input(c.text).blocked or verdicts.get(c.id) is True
            ),
            "failed_calls": sum(1 for c in cases if verdicts.get(c.id) is None),
        }
    return out
