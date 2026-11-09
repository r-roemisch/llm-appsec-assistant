"""Rampart fixture Plugin: a small secret scanner, served over MCP stdio.

It finds credential-like strings in the text it is given and reports the kind and line of each,
with the value masked. It keeps nothing, writes nothing and makes no network calls. It ships with
Rampart to exercise the Plugin catalog; it is not a complete secret scanner.

Rampart starts it through plugins/catalog.yaml. Started by hand (python server.py) it waits for
MCP messages on stdin.
"""

from __future__ import annotations

import re
from typing import Annotated

from mcp.server.mcpserver import MCPServer
from pydantic import Field

server = MCPServer(
    "rampart-secret-scanner",
    version="1.0.0",
    instructions="Scans text for credential-like strings and reports them masked.",
)

RULES: dict[str, re.Pattern[str]] = {
    "aws_access_key_id": re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"),
    "github_token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b"),
    "slack_token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    "api_key": re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "private_key_block": re.compile(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----"),
    # The keyword alone or inside an identifier: password, DB_PASSWORD, smtp.password, secret_key.
    "password_assignment": re.compile(
        r"(?i)(?<![A-Za-z0-9_.\-])(?:[A-Za-z0-9_.\-]{0,40}[_.\-])?"
        r"(?:password|passwd|pwd|secret|api_?key|token)(?:[_.\-][A-Za-z0-9_.\-]{0,30})?"
        r"(?![A-Za-z0-9])['\"]?\s*[:=]\s*['\"]?([^\s'\"]{6,})"
    ),
}

# Values that only point at a secret (placeholders, templates, environment lookups, masks).
PLACEHOLDER = re.compile(r"^(?:\[|<|\{|\$|\*{3,}|os\.|process\.env|getenv)")


def _mask(value: str) -> str:
    shown = value[:4] if len(value) > 8 else ""
    return f"{shown}… ({len(value)} characters)"


@server.tool()
def scan_text(
    text: Annotated[
        str,
        Field(
            max_length=100_000,
            description="The text to scan, such as a system prompt or a configuration file.",
        ),
    ],
) -> str:
    """Find credential-like strings in text. Reports each finding's kind and line number with
    the value masked; never returns a full value."""
    findings: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        for kind, pattern in RULES.items():
            for match in pattern.finditer(line):
                value = match.group(1) if pattern.groups else match.group(0)
                if PLACEHOLDER.match(value):
                    continue
                findings.append(f"- line {number}: {kind} {_mask(value)}")
    if not findings:
        return "No credential-like strings found."
    return f"Found {len(findings)} credential-like string(s):\n" + "\n".join(findings)


@server.tool()
def list_rules() -> list[str]:
    """List the kinds of credential-like strings this scanner looks for."""
    return list(RULES)


if __name__ == "__main__":
    server.run()
