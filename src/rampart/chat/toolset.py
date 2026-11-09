"""The Tools of one turn: what the Model is offered, the Gateway check of each call, execution
with a timeout, output redaction (G4), the Provenance-labelled text the Model reads (G2), and the
audit record of the result."""

from __future__ import annotations

import asyncio
import json
import secrets
import time
from collections.abc import Callable
from typing import Any

from rampart.gateway.gateway import Decision, Gateway
from rampart.guards.secrets import redact, redact_value
from rampart.tools.registry import ToolContext, ToolManifest, ToolOutput, ToolRegistry

TOOL_TIMEOUT_SECONDS = 60.0


class ToolSet:
    def __init__(
        self,
        *,
        registry: ToolRegistry,
        gateway: Gateway,
        offered: list[ToolManifest],
        context: ToolContext,
        budget: Callable[[], tuple[int, int | None]],
    ) -> None:
        self.registry = registry
        self.gateway = gateway
        self.offered = offered
        self.context = context
        self.budget = budget  # (tokens used by the conversation, budget) at the time of a call

    @property
    def specs(self) -> list[dict[str, Any]]:
        return [m.openai_tool() for m in self.offered]

    def check(self, call_id: str, name: str, arguments: Any, turn_tool_calls: int) -> Decision:
        used, budget = self.budget()
        return self.gateway.check(
            user_id=self.context.user_id,
            role=self.context.role,
            conversation_id=self.context.conversation_id,
            message_id=self.context.message_id,
            tool_call_id=call_id,
            tool=name,
            arguments=arguments,
            turn_tool_calls=turn_tool_calls,
            conversation_tokens=used,
            token_budget=budget,
        )

    async def execute(
        self, decision: Decision, name: str, arguments: dict[str, Any]
    ) -> tuple[ToolOutput, int]:
        """Run an allowed call. Returns the redacted output and the number of secrets removed."""
        executor = self.registry.executor(name)
        started = time.monotonic()
        error_class: str | None = None
        try:
            output = await asyncio.wait_for(executor(arguments, self.context), TOOL_TIMEOUT_SECONDS)
        except TimeoutError:
            error_class = "TimeoutError"
            output = ToolOutput(
                data={},
                summary="Timed out",
                error=f"{name} took longer than {TOOL_TIMEOUT_SECONDS:.0f} s",
            )
        except Exception as exc:  # an executor bug must not end the turn
            error_class = type(exc).__name__
            output = ToolOutput(data={}, summary="Failed", error=f"{name} failed: {error_class}")
        redactions = 0
        if output.model_text is not None:
            red = redact(output.model_text)
            redactions += red.total
            output.model_text = red.text
        summary = redact(output.summary)
        redactions += summary.total
        output.summary = summary.text
        output.data = redact_value(output.data)  # type: ignore[assignment]
        if output.error:
            output.error = redact(output.error).text
        duration = int((time.monotonic() - started) * 1000)
        self.gateway.record_result(
            decision.record_id,
            result={
                **output.data,
                "summary": output.summary,
                **({"error": output.error} if output.error else {}),
            },
            duration_ms=duration,
            error_class=error_class or ("ToolError" if output.error else None),
        )
        return output, redactions

    def model_text(self, name: str, provenance: str, output: ToolOutput, limit: int) -> str:
        """The Tool output as the Model reads it: delimited untrusted data with its Provenance."""
        body = (
            output.model_text
            if output.model_text is not None
            else json.dumps(output.data, ensure_ascii=False)
        )
        if output.error:
            body = f"ERROR: {output.error}\n{body}"
        if len(body) > limit:
            body = body[:limit] + f"\n…(output shortened to {limit} characters)"
        nonce = secrets.token_hex(4)
        return (
            f'<tool-output-{nonce} tool="{name}" provenance="{provenance}">\n{body}\n'
            f"</tool-output-{nonce}>"
        )
