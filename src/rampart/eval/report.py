"""Evaluation reports: one JSON file (everything) and one Markdown file (for people and the admin
page) per run, in the reports folder (``docs/reports/eval/`` by default).

Cases an admin added from Feedback came from users' Conversations, so reports name them by id
only: their questions and answers stay in the database.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

METRIC_LABELS = {
    "faithfulness": "Faithfulness",
    "answer_relevancy": "Answer relevancy",
    "contextual_precision": "Contextual precision",
    "contextual_recall": "Contextual recall",
    "tool_correctness": "Tool correctness",
}


def public_cases(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for case in cases:
        if case.get("source") == "authored":
            out.append({**case, "answer": (case.get("answer") or "")[:2000]})
        else:
            out.append({**case, "question": "(added from Feedback)", "answer": ""})
    return out


def _label(name: str) -> str:
    return METRIC_LABELS.get(name) or name


def _money(value: Any) -> str:
    return "unknown" if value is None else f"${value:.4f}"


def _pct(value: Any) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def _cell(text: Any, limit: int = 120) -> str:
    flat = " ".join(str(text or "").split()).replace("|", "\\|")
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


def render(payload: dict[str, Any]) -> str:
    suite = payload["suite"]
    lines = [f"# Evaluation report: {suite}", ""]
    facts = [
        ("Run", payload["run_id"]),
        ("Finished", payload["finished_at"]),
        ("Cases", payload["dataset_line"]),
    ]
    models = payload.get("models") or {}
    if suite != "guard":
        facts += [
            ("Chat Model", models.get("chat")),
            ("Grader Model", models.get("grader")),
            ("Judge Model", models.get("judge") or "none (deterministic)"),
            ("Pass threshold", payload.get("threshold")),
        ]
    cost = payload.get("cost") or {}
    facts += [
        ("Estimated cost", _money((payload.get("estimate") or {}).get("cost_usd"))),
        (
            "Actual cost",
            _money(cost.get("total_usd"))
            + (
                f" ({cost['unknown_cost_calls']} calls without a reported cost)"
                if cost.get("unknown_cost_calls")
                else ""
            ),
        ),
    ]
    lines += ["| Run | Value |", "|---|---|"]
    lines += [f"| {k} | {_cell(v, 200)} |" for k, v in facts if k != "Run"] + [""]
    lines.insert(2, f"Run `{payload['run_id']}`.")
    lines.insert(3, "")

    if suite == "guard":
        lines += _guard_section(payload["metrics"])
    else:
        lines += _metric_section(payload)
    lines += [
        "",
        "Datasets live in `eval/` and are read only by `rampart eval`; no Tool, Source or",
        "upload path reaches them. Cases added from Feedback are listed by id only.",
    ]
    return "\n".join(lines) + "\n"


def _guard_section(metrics: dict[str, Any]) -> list[str]:
    lines = [
        "## Input Guard (G1 heuristics)",
        "",
        "| Set | Adversarial | Benign | Precision | Recall | F1 | False-positive rate |",
        "|---|---|---|---|---|---|---|",
    ]
    for key, label in (
        ("cases", "guard_cases.jsonl (written with the rules)"),
        ("holdout", "guard_holdout.jsonl (held out, never tuned against)"),
    ):
        m = metrics[key]
        lines.append(
            f"| {label} | {m['adversarial']} | {m['benign']} | {_pct(m['precision'])} | "
            f"{_pct(m['recall'])} | {_pct(m['f1'])} | {_pct(m['false_positive_rate'])} |"
        )
    lines += ["", "Recall by category (written set):", ""]
    lines += [f"- {c}: {_pct(r)}" for c, r in metrics["cases"]["recall_by_category"].items()]
    for key, label in (("cases", "written set"), ("holdout", "held-out set")):
        missed = metrics[key]["missed"]
        if missed:
            lines += [
                "",
                f"Missed adversarial inputs ({label}): "
                + ", ".join(f"`{m['id']}` ({m['category']})" for m in missed),
            ]
        blocked = metrics[key]["blocked_benign"]
        if blocked:
            lines += [
                "",
                f"Benign inputs blocked ({label}): " + ", ".join(f"`{b['id']}`" for b in blocked),
            ]
    lines += [
        "",
        "Detection means the input would be blocked. The optional model classifier is not part of",
        "this deterministic run.",
    ]
    return lines


def _metric_section(payload: dict[str, Any]) -> list[str]:
    summary = payload["metrics"]
    lines = [
        "## Metrics",
        "",
        "| Metric | Mean score | Passed | Scored | Skipped | Errors | Cases |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, m in summary.items():
        mean = "n/a" if m["mean"] is None else f"{m['mean']:.3f}"
        counts = f"{m['passed']} | {m['scored']} | {m['skipped']} | {m['errors']} | {m['total']}"
        lines.append(f"| {_label(name)} | {mean} | {counts} |")
    names = list(summary)
    lines += [
        "",
        "## Cases",
        "",
        "| Case | Source | Turn | " + " | ".join(_label(n) for n in names) + " |",
        "|---|---|---|" + "---|" * len(names),
    ]
    for case in payload["cases"]:
        cells = []
        for n in names:
            s = case["metrics"].get(n) or {}
            cells.append(
                "n/a"
                if s.get("score") is None
                else f"{s['score']:.2f}{'' if s.get('passed') else ' ✗'}"
            )
        source = "authored" if case["source"] == "authored" else "Feedback"
        lines.append(
            f"| `{case['case_id']}` | {source} | {case['status']} | " + " | ".join(cells) + " |"
        )
    notes = []
    for case in payload["cases"]:
        for n in names:
            s = case["metrics"].get(n) or {}
            if s.get("error"):
                notes.append(f"- `{case['case_id']}` {_label(n)}: {_cell(s['error'], 200)}")
            elif s.get("passed") is False and s.get("reason"):
                where = f"`{case['case_id']}` {_label(n)} ({s['score']:.2f})"
                notes.append(f"- {where}: {_cell(s['reason'], 240)}")
    if notes:
        lines += ["", "## Below the threshold, skipped or failed", ""] + notes
    if payload["suite"] == "tool":
        lines += [
            "",
            "Tool correctness: every expected Tool called (order not considered); a case that",
            "expects no Tool passes only if none was called. A call waiting for an Approval",
            "counts as called.",
        ]
    return lines


def write(payload: dict[str, Any], reports_dir: Path) -> tuple[Path, Path]:
    reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    base = reports_dir / f"{stamp}-{payload['suite']}-{payload['run_id'][:8]}"
    json_path, md_path = base.with_suffix(".json"), base.with_suffix(".md")
    json_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8"
    )
    md_path.write_text(render(payload), encoding="utf-8")
    return md_path, json_path
