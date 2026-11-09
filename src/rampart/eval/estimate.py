"""What an evaluation run is expected to cost, shown before it starts and recorded with it.

Tokens per call are typical figures for Rampart's own calls (routing, grading, answering, the
answer after a Tool result) and for DeepEval's judge prompts, with the retrieved passages in the
prompt. Multiplied by the prices OpenRouter's listing reports, they give the estimate; every
report puts the estimate next to what the run actually cost.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from rampart.catalog.catalog import ModelSpec
from rampart.eval.pricing import Price, price_for

# (purpose, slot, input tokens, output tokens) per evaluated case
TURN_CALLS = (
    ("route", "grader", 900, 40),
    ("grade", "grader", 2600, 60),
    ("answer", "chat", 4200, 450),
)
TOOL_FOLLOW_UP = ("answer after the Tool result", "chat", 4800, 350)
# DeepEval judge calls per QA case: metric -> [(input tokens, output tokens) per call]
JUDGE_CALLS: dict[str, list[tuple[int, int]]] = {
    "faithfulness": [(2900, 500), (900, 350), (1900, 450), (700, 120)],
    "answer_relevancy": [(900, 300), (1100, 350), (700, 120)],
    "contextual_precision": [(3300, 500), (900, 120)],
    "contextual_recall": [(3100, 450), (800, 120)],
}


@dataclass
class SuiteEstimate:
    suite: str  # "qa", "tool" or "guard"
    cases: int
    chat_model: str | None
    judge_model: str | None
    model_calls: int
    judge_calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float | None  # None when a Model's price is unknown
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _cost(calls: list[tuple[int, int]], price: Price | None) -> float | None:
    if price is None:
        return None
    return sum(i * price.prompt + o * price.completion for i, o in calls)


def estimate(
    suite: str,
    cases: int,
    *,
    chat: ModelSpec,
    grader: ModelSpec,
    judge: ModelSpec | None,
    prices: dict[str, Price],
) -> SuiteEstimate:
    if suite == "guard":
        return SuiteEstimate(
            "guard",
            cases,
            None,
            None,
            0,
            0,
            0,
            0,
            0.0,
            ["Deterministic: the input Guard's rules run locally, no Model is called."],
        )
    specs = {"chat": chat, "grader": grader}
    turn = list(TURN_CALLS) + ([TOOL_FOLLOW_UP] if suite == "tool" else [])
    notes: list[str] = []
    cost: float | None = 0.0
    model_calls = input_tokens = output_tokens = 0
    for _purpose, slot, i, o in turn:
        part = _cost([(i, o)] * cases, price_for(specs[slot], prices))
        if part is None:
            notes.append(f"no price listed for {specs[slot].id}")
        cost = None if cost is None or part is None else cost + part
        model_calls += cases
        input_tokens += i * cases
        output_tokens += o * cases
    judge_calls = 0
    if suite == "qa" and judge is not None:
        per_case = [call for calls in JUDGE_CALLS.values() for call in calls]
        judge_calls = len(per_case) * cases
        part = _cost(per_case * cases, price_for(judge, prices))
        if part is None:
            notes.append(f"no price listed for the judge {judge.id}")
        cost = None if cost is None or part is None else cost + part
        input_tokens += sum(i for i, _ in per_case) * cases
        output_tokens += sum(o for _, o in per_case) * cases
    if suite == "tool":
        notes.append("Tool correctness is deterministic: no judge calls.")
    return SuiteEstimate(
        suite,
        cases,
        chat.id,
        judge.id if suite == "qa" and judge is not None else None,
        model_calls,
        judge_calls,
        input_tokens,
        output_tokens,
        round(cost, 4) if cost is not None else None,
        notes,
    )
