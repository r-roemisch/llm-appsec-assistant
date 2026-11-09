"""The DeepEval judge: the powerful Slot's Model through Rampart's own Provider code, so every
judge call goes through OpenRouter (or Ollama) and records the cost the Provider reports.

Import this module only after ``prepare_deepeval_env``: importing DeepEval reads ``.env`` files
and enables telemetry unless told otherwise.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage

from rampart.catalog.catalog import ModelSpec
from rampart.chat.llm import extract_usage, fetch_openrouter_cost, text_of


def prepare_deepeval_env(cache_dir: Path) -> None:
    """Before DeepEval is imported: no telemetry, no reading of .env files, no upload of results
    to Confident AI, and DeepEval's cache folder inside the run's own folder."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    os.environ["DEEPEVAL_TELEMETRY_OPT_OUT"] = "1"
    os.environ["DEEPEVAL_DISABLE_DOTENV"] = "1"
    os.environ["DEEPEVAL_CACHE_FOLDER"] = str(cache_dir)
    for key in ("CONFIDENT_API_KEY", "DEEPEVAL_RESULTS_FOLDER"):
        os.environ.pop(key, None)


@dataclass
class CostLedger:
    """Model calls made for an evaluation run, with what each Provider reported."""

    api_key: str | None = None
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    unknown_cost_calls: int = 0
    by_purpose: dict[str, float] = field(default_factory=dict)

    async def add(self, purpose: str, spec: ModelSpec, message: AIMessage) -> None:
        usage = extract_usage(message, spec.provider)
        cost = usage.cost_usd
        if spec.provider == "ollama":
            cost = 0.0
        elif cost is None and usage.generation_id and self.api_key:
            cost = await fetch_openrouter_cost(usage.generation_id, self.api_key)
        self.record(purpose, usage.input_tokens, usage.output_tokens, cost)

    def record(
        self, purpose: str, input_tokens: int | None, output_tokens: int | None, cost: float | None
    ) -> None:
        self.calls += 1
        self.input_tokens += input_tokens or 0
        self.output_tokens += output_tokens or 0
        if cost is None:
            self.unknown_cost_calls += 1
            return
        self.cost_usd += cost
        self.by_purpose[purpose] = self.by_purpose.get(purpose, 0.0) + cost


def _json_object(text: str) -> Any:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object in the reply")
    return json.loads(text[start : end + 1])


def build_judge(llm: BaseChatModel, spec: ModelSpec, ledger: CostLedger) -> Any:
    """A ``DeepEvalBaseLLM`` around a LangChain chat model. DeepEval asks for JSON matching a
    schema; a reply that does not parse is asked for once more, then handed to DeepEval as text
    (which records the metric as failed for that case rather than guessing)."""
    from deepeval.models.base_model import DeepEvalBaseLLM

    class RampartJudge(DeepEvalBaseLLM):
        def __init__(self) -> None:
            super().__init__(spec.id)

        def load_model(self, *args: Any, **kwargs: Any) -> Any:
            return llm

        def get_model_name(self) -> str:
            return spec.id

        def generate(self, prompt: str, schema: Any = None) -> Any:  # DeepEval's sync path
            reply = llm.invoke([HumanMessage(content=prompt)])
            usage = extract_usage(reply, spec.provider)
            cost = 0.0 if spec.provider == "ollama" else usage.cost_usd
            ledger.record("judge", usage.input_tokens, usage.output_tokens, cost)
            return self._parse(text_of(reply.content), schema)

        async def a_generate(self, prompt: str, schema: Any = None) -> Any:
            reply = await llm.ainvoke([HumanMessage(content=prompt)])
            await ledger.add("judge", spec, reply)
            text = text_of(reply.content)
            parsed = self._parse(text, schema)
            if schema is None or not isinstance(parsed, str):
                return parsed
            retry = await llm.ainvoke(
                [
                    HumanMessage(
                        content=prompt + "\n\nReply with only the JSON object, nothing else."
                    )
                ]
            )
            await ledger.add("judge", spec, retry)
            return self._parse(text_of(retry.content), schema)

        @staticmethod
        def _parse(text: str, schema: Any) -> Any:
            if schema is None:
                return text
            try:
                return schema.model_validate(_json_object(text))
            except Exception:
                return text

    return RampartJudge()


def build_no_call_model() -> Any:
    """A placeholder DeepEval model for metrics that must not call one (tool correctness without
    ``available_tools`` is deterministic). Calling it is a bug and fails loudly."""
    from deepeval.models.base_model import DeepEvalBaseLLM

    class NoCallModel(DeepEvalBaseLLM):
        def __init__(self) -> None:
            super().__init__("no-model")

        def load_model(self, *args: Any, **kwargs: Any) -> Any:
            return self

        def get_model_name(self) -> str:
            return "no-model"

        def generate(self, *args: Any, **kwargs: Any) -> str:
            raise RuntimeError("this metric was expected to make no Model call")

        async def a_generate(self, *args: Any, **kwargs: Any) -> str:
            raise RuntimeError("this metric was expected to make no Model call")

    return NoCallModel()
