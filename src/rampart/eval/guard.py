"""Deterministic Guard metrics: replay the labelled inputs through the input Guard's heuristics
(G1) and count. Detection means the input would be blocked; a benign input that is blocked is a
false positive. The held-out set was never used to tune the rules."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from rampart.eval.datasets import GuardCase, guard_cases
from rampart.guards.input_guard import check_input


def _ratio(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator, 4) if denominator else None


def score(cases: list[GuardCase]) -> dict[str, Any]:
    tp = fn = fp = tn = 0
    missed: list[dict[str, str]] = []
    blocked_benign: list[dict[str, str]] = []
    per_category: Counter[str] = Counter()
    per_category_hits: Counter[str] = Counter()
    for case in cases:
        blocked = check_input(case.text).blocked
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
