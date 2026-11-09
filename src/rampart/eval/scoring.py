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

from rampart.eval.datasets import QaCase, ToolCase
from rampart.eval.turns import TurnRecord

QA_METRICS = ("faithfulness", "answer_relevancy", "contextual_precision", "contextual_recall")
NEEDS_CONTEXT = frozenset({"faithfulness", "contextual_precision", "contextual_recall"})
TOOL_METRICS = ("tool_correctness",)


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
            result.metrics = {
                "tool_correctness": MetricScore(
                    error=f"skipped: {record.error or 'the turn failed'}"
                )
            }
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
            "tool_correctness": await _measure(metric, test_case, 1.0, asyncio.Semaphore(1))
        }
        results.append(result)
    return results


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
