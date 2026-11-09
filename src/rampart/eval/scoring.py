"""Scoring turns with DeepEval: faithfulness, answer relevancy, contextual precision and
contextual recall on question cases (judged by the powerful Slot), and tool correctness on Tool
cases (deterministic, no judge). Every metric result carries its score, whether it passed, the
judge's reason, or the error that stopped it; nothing is guessed.

DeepEval is imported inside the functions, after ``prepare_deepeval_env`` has run.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any, cast

from rampart.eval.datasets import ExpectedCall, QaCase, ToolCase
from rampart.eval.turns import TurnRecord

QA_METRICS = ("faithfulness", "answer_relevancy", "contextual_precision", "contextual_recall")
NEEDS_CONTEXT = frozenset({"faithfulness", "contextual_precision", "contextual_recall"})
TOOL_METRICS = (
    "tool_correctness",
    "argument_correctness",  # (M7) deterministic, from the dataset's expected calls
    "decision_correctness",
    "unnecessary_calls",
)


@dataclass
class MetricScore:
    score: float | None = None
    passed: bool | None = None
    reason: str | None = None
    error: str | None = None  # why there is no score ("skipped: ..." when not applicable)


@dataclass
class CaseResult:
    case_id: str
    source: str
    question: str
    status: str
    answer: str
    tools_called: list[str]
    expected_tools: list[str]
    context_count: int
    turn_error: str | None
    metrics: dict[str, MetricScore] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


MetricsFactory = Callable[[Any, float], dict[str, Any]]


def deepeval_qa_metrics(judge: Any, threshold: float) -> dict[str, Any]:
    from deepeval.metrics import (
        AnswerRelevancyMetric,
        ContextualPrecisionMetric,
        ContextualRecallMetric,
        FaithfulnessMetric,
    )

    common = {"model": judge, "threshold": threshold, "include_reason": True, "async_mode": True}
    return {
        "faithfulness": FaithfulnessMetric(**common, truths_extraction_limit=30),
        "answer_relevancy": AnswerRelevancyMetric(**common),
        "contextual_precision": ContextualPrecisionMetric(**common),
        "contextual_recall": ContextualRecallMetric(**common),
    }


def _short(text: Any, limit: int = 400) -> str | None:
    if text is None:
        return None
    flat = " ".join(str(text).split())
    return flat if len(flat) <= limit else flat[: limit - 1] + "…"


async def _measure(
    metric: Any, test_case: Any, threshold: float, semaphore: asyncio.Semaphore
) -> MetricScore:
    async with semaphore:
        try:
            await metric.a_measure(test_case, _show_indicator=False)
        except Exception as exc:  # a judge that returns garbage fails this metric, not the run
            return MetricScore(error=_short(f"{type(exc).__name__}: {exc}", 300))
    score = metric.score
    if score is None:
        return MetricScore(error="the metric returned no score")
    return MetricScore(
        float(score), float(score) >= threshold, _short(getattr(metric, "reason", None))
    )


async def score_qa(
    records: list[TurnRecord],
    cases: list[QaCase],
    *,
    judge: Any,
    threshold: float,
    concurrency: int,
    metrics_factory: MetricsFactory = deepeval_qa_metrics,
) -> list[CaseResult]:
    from deepeval.test_case import LLMTestCase

    by_id = {c.id: c for c in cases}
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def one(record: TurnRecord) -> CaseResult:
        case = by_id[record.case_id]
        result = CaseResult(
            case.id,
            case.source,
            case.question,
            record.status,
            record.answer,
            record.tools_called,
            [],
            len(record.contexts),
            record.error,
        )
        if record.status != "done" or not record.answer.strip():
            reason = record.error or f"the turn ended with {record.status}"
            result.metrics = {m: MetricScore(error=f"skipped: {reason}") for m in QA_METRICS}
            return result
        test_case = LLMTestCase(
            input=case.question,
            actual_output=record.answer,
            expected_output=case.expected_answer,
            retrieval_context=cast(Any, record.contexts or None),
        )
        metrics = metrics_factory(judge, threshold)
        names = [m for m in QA_METRICS if record.contexts or m not in NEEDS_CONTEXT]
        scores = await asyncio.gather(
            *(_measure(metrics[m], test_case, threshold, semaphore) for m in names)
        )
        result.metrics = dict(zip(names, scores, strict=True))
        for m in QA_METRICS:
            result.metrics.setdefault(
                m, MetricScore(error="skipped: nothing was retrieved for this question")
            )
        return result

    return list(await asyncio.gather(*(one(r) for r in records)))


async def score_tools(records: list[TurnRecord], cases: list[ToolCase]) -> list[CaseResult]:
    """Did the turn call every expected Tool (order not considered)? A case that expects no Tool
    passes only if none was called. A call that waits for an Approval counts as called."""
    from deepeval.metrics import ToolCorrectnessMetric
    from deepeval.test_case import LLMTestCase, ToolCall

    from rampart.eval.judge import build_no_call_model

    by_id = {c.id: c for c in cases}
    no_model = build_no_call_model()
    results: list[CaseResult] = []
    for record in records:
        case = by_id[record.case_id]
        result = CaseResult(
            case.id,
            case.source,
            case.question,
            record.status,
            record.answer,
            record.tools_called,
            list(case.expected_tools),
            len(record.contexts),
            record.error,
        )
        if record.status == "error" and not record.tools_called:
            skipped = MetricScore(error=f"skipped: {record.error or 'the turn failed'}")
            result.metrics = {name: skipped for name in TOOL_METRICS}
            results.append(result)
            continue
        metric = ToolCorrectnessMetric(threshold=1.0, model=no_model, include_reason=True)
        test_case = LLMTestCase(
            input=case.question,
            actual_output=record.answer or "(no answer text)",
            tools_called=[ToolCall(name=n, input_parameters=None) for n in record.tools_called],
            expected_tools=[ToolCall(name=n, input_parameters=None) for n in case.expected_tools],
        )
        result.metrics = {
            "tool_correctness": await _measure(metric, test_case, 1.0, asyncio.Semaphore(1)),
            **call_metrics(record.calls, case),
        }
        results.append(result)
    return results


def _same(actual: Any, expected: Any) -> bool:
    if isinstance(expected, str):
        return str(actual if actual is not None else "").strip().lower() == expected.lower()
    if isinstance(expected, list):
        return isinstance(actual, list) and sorted(map(str, actual)) == sorted(map(str, expected))
    return actual == expected


def arguments_match(actual: dict[str, Any], expected: ExpectedCall) -> bool:
    """Every expected argument is there with the same value (text compared case-insensitively);
    an expected value of None means the argument must be absent. Others may be present."""
    for key, value in expected.arguments:
        if value is None:
            if actual.get(key) not in (None, ""):
                return False
        elif not _same(actual.get(key), value):
            return False
    return True


def _ratio_score(hits: int, total: int, misses: list[str]) -> MetricScore:
    score = hits / total
    reason = "all expected" if not misses else "; ".join(misses)[:400]
    return MetricScore(score=round(score, 4), passed=score >= 1.0, reason=reason)


def call_metrics(calls: list[dict[str, Any]], case: ToolCase) -> dict[str, MetricScore]:
    """(M7) Deterministic checks of the calls a turn made against the case's expected calls:
    the structured arguments, the Gateway's decision, and calls nobody expected."""
    out: dict[str, MetricScore] = {}
    with_args = [e for e in case.expected_calls if e.arguments]
    if not with_args:
        out["argument_correctness"] = MetricScore(error="skipped: no argument expectations")
    else:
        misses = [
            f"{e.tool} without {dict(e.arguments)}"
            for e in with_args
            if not any(
                c["tool"] == e.tool and arguments_match(c.get("arguments") or {}, e) for c in calls
            )
        ]
        out["argument_correctness"] = _ratio_score(
            len(with_args) - len(misses), len(with_args), misses
        )
    with_decision = [e for e in case.expected_calls if e.decision]
    if not with_decision:
        out["decision_correctness"] = MetricScore(error="skipped: no decision expectations")
    else:
        misses = [
            f"{e.tool} was not {e.decision}"
            for e in with_decision
            if not any(c["tool"] == e.tool and c.get("decision") == e.decision for c in calls)
        ]
        out["decision_correctness"] = _ratio_score(
            len(with_decision) - len(misses), len(with_decision), misses
        )
    allowed = set(case.expected_tools)
    extra = [c["tool"] for c in calls if c["tool"] not in allowed]
    out["unnecessary_calls"] = MetricScore(
        score=0.0 if extra else 1.0,
        passed=not extra,
        reason=f"not expected: {', '.join(extra)}" if extra else "no unexpected call",
    )
    return out


def summarise(results: list[CaseResult], names: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """Per metric: the mean over scored cases, how many passed, and every denominator."""
    summary: dict[str, dict[str, Any]] = {}
    for name in names:
        scores = [r.metrics[name] for r in results if name in r.metrics]
        scored = [s for s in scores if s.score is not None]
        skipped = [s for s in scores if s.score is None and (s.error or "").startswith("skipped")]
        summary[name] = {
            "mean": round(sum(s.score for s in scored if s.score is not None) / len(scored), 4)
            if scored
            else None,
            "passed": sum(bool(s.passed) for s in scored),
            "scored": len(scored),
            "skipped": len(skipped),
            "errors": len(scores) - len(scored) - len(skipped),
            "total": len(results),
        }
    return summary
