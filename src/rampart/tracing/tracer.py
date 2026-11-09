"""Per-turn tracing: Langfuse cloud when configured, otherwise JSONL files under data/traces."""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from langchain_core.callbacks import BaseCallbackHandler

from rampart.config import Settings


@dataclass
class TurnTrace:
    """What one chat turn gives the tracer and what the tracer gives back (the trace id)."""

    trace_id: str
    callbacks: list[BaseCallbackHandler]
    output: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class Tracer(Protocol):
    backend: str

    def turn(
        self, *, user_id: int, conversation_id: str, model_id: str, input_text: str
    ) -> AbstractContextManager[TurnTrace]: ...

    def score(
        self,
        *,
        trace_id: str,
        name: str,
        value: float,
        comment: str | None = None,
        score_id: str | None = None,
    ) -> None: ...

    def flush(self) -> None: ...


class _RecordingHandler(BaseCallbackHandler):
    """Collects model-level callback events for the JSONL record."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict[str, Any]] = []

    def _add(self, kind: str, **data: Any) -> None:
        self.events.append({"at": _now_iso(), "kind": kind, **data})

    def on_chat_model_start(self, serialized, messages, **kwargs):  # type: ignore[override]
        name = kwargs.get("name") or (serialized or {}).get("name")
        count = sum(len(batch) for batch in messages)
        self._add("model_start", model=name, message_count=count)

    def on_llm_end(self, response, **kwargs):  # type: ignore[override]
        usage: dict[str, Any] | None = None
        for generations in response.generations:
            for generation in generations:
                message = getattr(generation, "message", None)
                meta = getattr(message, "usage_metadata", None)
                if meta:
                    usage = dict(meta)
        self._add("model_end", usage=usage)

    def on_llm_error(self, error, **kwargs):  # type: ignore[override]
        self._add("model_error", error=f"{type(error).__name__}: {error}")


class JsonlTracer:
    """Appends one JSON line per turn (and per score) to ``<dir>/<date>.jsonl``."""

    backend = "jsonl"

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    @contextmanager
    def turn(
        self, *, user_id: int, conversation_id: str, model_id: str, input_text: str
    ) -> Iterator[TurnTrace]:
        trace = TurnTrace(trace_id=uuid.uuid4().hex, callbacks=[])
        with self.recording(
            trace,
            user_id=user_id,
            conversation_id=conversation_id,
            model_id=model_id,
            input_text=input_text,
        ):
            yield trace

    @contextmanager
    def recording(
        self,
        trace: TurnTrace,
        *,
        user_id: int,
        conversation_id: str,
        model_id: str,
        input_text: str,
    ) -> Iterator[TurnTrace]:
        """Write one line for ``trace`` (under its trace id) when the turn ends."""
        handler = _RecordingHandler()
        trace.callbacks.append(handler)
        started = time.monotonic()
        started_at = datetime.now(UTC)
        try:
            yield trace
        finally:
            self._append(
                started_at,
                {
                    "type": "turn",
                    "trace_id": trace.trace_id,
                    "started_at": started_at.isoformat(),
                    "duration_ms": int((time.monotonic() - started) * 1000),
                    "user_id": user_id,
                    "conversation_id": conversation_id,
                    "model_id": model_id,
                    "input": input_text,
                    "output": trace.output,
                    "usage": trace.usage,
                    "error": trace.error,
                    "metadata": trace.metadata,
                    "events": handler.events,
                },
            )

    def score(
        self,
        *,
        trace_id: str,
        name: str,
        value: float,
        comment: str | None = None,
        score_id: str | None = None,
    ) -> None:
        now = datetime.now(UTC)
        self._append(
            now,
            {
                "type": "score",
                "score_id": score_id,
                "trace_id": trace_id,
                "at": now.isoformat(),
                "name": name,
                "value": value,
                "comment": comment,
            },
        )

    def flush(self) -> None:
        return None

    def _append(self, when: datetime, record: dict[str, Any]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        path = self.directory / f"{when.date().isoformat()}.jsonl"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


def redact_trace_data(*, data: Any, **_kwargs: Any) -> Any:
    """Langfuse's mask hook: every value the SDK exports (inputs, outputs, metadata, including
    raw model output captured by the LangChain callback) has secret-like strings redacted."""
    from rampart.guards.secrets import redact_value

    return redact_value(data)


class LangfuseTracer:
    """Langfuse through the LangChain callback handler; one trace per chat turn."""

    backend = "langfuse"

    def __init__(self, settings: Settings) -> None:
        from langfuse import Langfuse

        assert settings.langfuse_secret_key is not None
        self.client = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key.get_secret_value(),
            base_url=settings.langfuse_host,
            mask=redact_trace_data,  # G4 for traces: nothing credential-like leaves for Langfuse
        )

    @contextmanager
    def turn(
        self, *, user_id: int, conversation_id: str, model_id: str, input_text: str
    ) -> Iterator[TurnTrace]:
        from langfuse._client.propagation import propagate_attributes
        from langfuse.langchain import CallbackHandler

        with (
            propagate_attributes(
                user_id=str(user_id),
                session_id=conversation_id,
                trace_name="chat_turn",
                metadata={"model_id": model_id},
            ),
            self.client.start_as_current_observation(
                name="chat_turn", as_type="span", input=input_text
            ) as span,
        ):
            trace = TurnTrace(
                trace_id=self.client.get_current_trace_id() or uuid.uuid4().hex,
                callbacks=[CallbackHandler()],
            )
            try:
                yield trace
            finally:
                span.update(
                    output=trace.output,
                    metadata={"usage": trace.usage, "error": trace.error, **trace.metadata},
                    level="ERROR" if trace.error else None,
                    status_message=trace.error,
                )

    def score(
        self,
        *,
        trace_id: str,
        name: str,
        value: float,
        comment: str | None = None,
        score_id: str | None = None,
    ) -> None:
        # The same score_id updates the score rather than adding another one.
        self.client.create_score(
            trace_id=trace_id,
            name=name,
            value=value,
            comment=comment,
            score_id=score_id,
            data_type="NUMERIC",
        )

    def flush(self) -> None:
        self.client.flush()


class MirroredTracer:
    """Langfuse, plus a JSONL copy of every turn and score under the same trace id. Langfuse
    exports in the background, so an outage cannot be seen in time to switch; keeping the local
    copy always means a trace survives when Langfuse cannot be reached (P6-A22)."""

    backend = "langfuse"

    def __init__(self, primary: LangfuseTracer, mirror: JsonlTracer) -> None:
        self.primary = primary
        self.mirror = mirror

    @contextmanager
    def turn(
        self, *, user_id: int, conversation_id: str, model_id: str, input_text: str
    ) -> Iterator[TurnTrace]:
        details = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "model_id": model_id,
            "input_text": input_text,
        }
        with self.primary.turn(**details) as trace, self.mirror.recording(trace, **details):
            yield trace

    def score(
        self,
        *,
        trace_id: str,
        name: str,
        value: float,
        comment: str | None = None,
        score_id: str | None = None,
    ) -> None:
        self.mirror.score(
            trace_id=trace_id, name=name, value=value, comment=comment, score_id=score_id
        )
        self.primary.score(
            trace_id=trace_id, name=name, value=value, comment=comment, score_id=score_id
        )

    def flush(self) -> None:
        self.primary.flush()


def build_tracer(settings: Settings) -> Tracer:
    mirror = JsonlTracer(settings.traces_dir)
    if settings.langfuse_configured:
        return MirroredTracer(LangfuseTracer(settings), mirror)
    return mirror


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()
