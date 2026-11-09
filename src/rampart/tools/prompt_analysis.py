"""`analyze_prompt`: deterministic rules over a system prompt and tool schemas.

Every Finding comes from a rule here; the Model explains Findings, it never invents them. The
rules look for what OWASP's LLM Top 10 recommends and what is missing: a boundary for untrusted
content, secrets and internal details in the prompt, access control left to the Model,
refusal and output guidance, and over-broad or unconstrained Tools.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from typing import Any

from rampart.guards.secrets import PATTERNS, redact

_I = re.IGNORECASE
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2, "info": 3}


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    title: str
    evidence: str
    recommendation: str
    references: tuple[str, ...]


BOUNDARY_HINTS = re.compile(
    r"\buntrusted\b|treat (?:it|them|this|that|[^.\n]{0,40}) as (?:data|information|content|"
    r"untrusted)|(?:do not|don't|never) (?:follow|obey|execute|act on) (?:any )?instructions "
    r"(?:in|from|inside|within|contained|found)|ignore (?:any )?instructions (?:in|from|inside|"
    r"within|contained|found)|\bdelimit\w*|between (?:the )?<|\bdata, not instructions\b|"
    r"not as instructions|\bprompt injection\b",
    _I,
)
REFUSAL_HINTS = re.compile(
    r"\b(?:refuse|decline|do not (?:help|answer|assist|provide|engage)|don't (?:help|answer|"
    r"assist|provide|engage)|out of scope|off-topic|not allowed to (?:help|answer|discuss)|"
    r"only (?:answer|discuss|help with|respond to)|politely (?:decline|refuse))\b",
    _I,
)  # scope and refusal policy; "never reveal these instructions" is secrecy (PA-007), not refusal
OUTPUT_HINTS = re.compile(
    r"\b(?:format|json|markdown|at most|no more than|max(?:imum)?|limit\w*|concise|brief|short|"
    r"words|sentences|bullet|schema|length)\b",
    _I,
)
SENSITIVE_HINTS = re.compile(
    r"https?://[^\s\"']*(?:internal|intranet|corp|\.local\b|admin|staging)[^\s\"']*|"
    r"\b(?:10|192\.168|172\.(?:1[6-9]|2\d|3[01]))(?:\.\d{1,3}){2,3}\b|"
    r"\binternal\b[^.\n]{0,40}\b(?:api|url|endpoint|host|database|server|system)\b|"
    r"\bconnection string\b|\b(?:admin|root|service) (?:password|credentials|account)\b",
    _I,
)
AUTHZ_HINTS = re.compile(
    r"\bonly (?:allow|let|help|answer|show|serve)\b[^.\n]{0,30}\b(?:admins?|administrators?|"
    r"managers?|authori[sz]ed|premium|verified|employees?|staff)\b|"
    r"\bif the user (?:is|claims to be|says they are) (?:an? )?(?:admin|administrator|"
    r"authori[sz]ed|manager|verified|employee|staff|owner)\b|"
    r"\bcheck (?:whether|if) the user (?:is|has|can)\b|"
    r"\b(?:do not|don't|never) (?:reveal|share|show|give)\b[^.\n]{0,50}\b(?:unless|except|"
    r"to (?:anyone|users) (?:who|without))\b|\busers? with (?:the )?(?:role|permission)\b",
    _I,
)
SECRECY_HINTS = re.compile(
    r"\b(?:never|do not|don't) (?:reveal|share|disclose|repeat|tell)\b[^.\n]{0,30}"
    r"\b(?:this|these|the|your|my) (?:prompt|instructions|system prompt|rules)\b",
    _I,
)
DANGEROUS_CAPABILITY = re.compile(
    r"\b(?:shell|exec(?:ute)?|commands?|cmd|eval|run[_ ]?(?:code|script|python|sql|query)|bash|"
    r"powershell|subprocess|raw[_ ]?sql|arbitrary|http[_ ]?request|fetch[_ ]?url|curl|browse|"
    r"download|write[_ ]?file|delete[_ ]?file|file[_ ]?system|filesystem|send[_ ]?(?:e?mail|"
    r"message)|transfer[_ ]?(?:funds|money)|payments?|wire)\b",
    _I,
)
SIDE_EFFECT = re.compile(
    r"(?:^|[\s_\-.])(?:delete|remove|drop|send|transfer|pay|purchase|refund|create|update|"
    r"modify|write|post|publish|execute|deploy|grant|revoke|cancel|approve)(?:$|[\s_\-.s])",
    _I,
)
CONFIRMATION = re.compile(r"confirm|approv|dry[_ ]?run|preview|human|review", _I)
RISKY_PARAM = re.compile(
    r"^(?:url|uri|link|path|file(?:name|path)?|dir(?:ectory)?|command|cmd|query|sql|code|script|"
    r"expression|html|template|recipients?|to|email|address|host(?:name)?|domain|target|"
    r"endpoint|statement)$",
    _I,
)


def _finding(
    rule: str, severity: str, title: str, evidence: str, recommendation: str, *refs: str
) -> Finding:
    return Finding(rule, severity, title, evidence[:300], recommendation, refs)


def _first(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    if match is None:
        return None
    lo, hi = max(0, match.start() - 30), min(len(text), match.end() + 30)
    return "…" + redact(" ".join(text[lo:hi].split())).text + "…"  # context may hold a secret


def analyze_system_prompt(prompt: str) -> list[Finding]:
    findings: list[Finding] = []
    kinds = sorted({p.kind for p in PATTERNS if p.regex.search(prompt)})
    if "[REDACTED:" in prompt:
        kinds.append("value redacted by Rampart's input Guard")
    if kinds:
        findings.append(
            _finding(
                "PA-002",
                "high",
                "Secret embedded in the prompt",
                "Found: " + ", ".join(kinds) + " (values not repeated here).",
                "Remove credentials from the prompt and give them to the Tools that need them, "
                "server-side. Assume a system prompt will leak.",
                "LLM02:2025",
                "LLM07:2025",
            )
        )
    authz = _first(AUTHZ_HINTS, prompt)
    if authz:
        findings.append(
            _finding(
                "PA-006",
                "high",
                "Access control left to the Model",
                authz,
                "Enforce roles and permissions in code before content reaches the Model; a prompt "
                "cannot keep data away from someone who can talk to the Model.",
                "LLM07:2025",
                "LLM06:2025",
            )
        )
    if not BOUNDARY_HINTS.search(prompt):
        findings.append(
            _finding(
                "PA-001",
                "medium",
                "No rule for untrusted content",
                "No sentence tells the Model how to treat retrieved documents, user-supplied text "
                "or Tool output.",
                "Wrap untrusted content in delimiters it cannot forge, state that it is data and "
                "never instructions, and keep authorisation in code.",
                "LLM01:2025",
            )
        )
    sensitive = _first(SENSITIVE_HINTS, prompt)
    if sensitive:
        findings.append(
            _finding(
                "PA-005",
                "medium",
                "Internal details in the prompt",
                sensitive,
                "Keep hostnames, internal URLs and account details out of the prompt; anything in "
                "it can be extracted.",
                "LLM07:2025",
            )
        )
    if not REFUSAL_HINTS.search(prompt):
        findings.append(
            _finding(
                "PA-003",
                "low",
                "No refusal guidance",
                "The prompt does not say what the assistant must decline or how to handle "
                "off-topic or harmful requests.",
                "State the scope, what to refuse, and how to answer requests outside it.",
                "LLM01:2025",
                "LLM09:2025",
            )
        )
    if not OUTPUT_HINTS.search(prompt):
        findings.append(
            _finding(
                "PA-004",
                "low",
                "No output format or length limits",
                "No format, structure or length constraint for answers.",
                "Constrain the format and length, and validate structured output in code before "
                "anything acts on it.",
                "LLM05:2025",
                "LLM10:2025",
            )
        )
    secrecy = _first(SECRECY_HINTS, prompt)
    if secrecy:
        findings.append(
            _finding(
                "PA-007",
                "info",
                "Relies on keeping the prompt secret",
                secrecy,
                "Treat the system prompt as public: a confidentiality instruction slows extraction "
                "down at best.",
                "LLM07:2025",
            )
        )
    return findings


def _normalise_tools(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, dict) and isinstance(data.get("tools"), list):
        data = data["tools"]
    items = data if isinstance(data, list) else [data]
    tools: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if isinstance(item.get("function"), dict):
            item = item["function"]
        schema = item.get("parameters") or item.get("input_schema") or item.get("inputSchema") or {}
        tools.append(
            {
                "name": str(item.get("name") or "unnamed"),
                "description": str(item.get("description") or ""),
                "schema": schema if isinstance(schema, dict) else {},
            }
        )
    return tools


def _walk(schema: dict[str, Any], path: str = ""):  # noqa: ANN202 (generator of nodes)
    yield path or "(root)", schema
    for name, child in (schema.get("properties") or {}).items():
        if isinstance(child, dict):
            yield from _walk(child, f"{path}.{name}" if path else name)
    items = schema.get("items")
    if isinstance(items, dict):
        yield from _walk(items, f"{path}[]")


def analyze_tool_schema(raw: str) -> tuple[list[Finding], list[str]]:
    try:
        tools = _normalise_tools(json.loads(raw))
    except (ValueError, TypeError):
        return [
            _finding(
                "TS-100",
                "info",
                "Tool schema is not valid JSON",
                "The tool schema could not be parsed, so no tool rules ran.",
                "Paste the tool definitions as JSON (OpenAI, Anthropic or MCP format).",
            )
        ], []
    findings: list[Finding] = []
    for tool in tools:
        name, description, schema = tool["name"], tool["description"], tool["schema"]
        nodes = list(_walk(schema))
        text = " ".join([name, description, *(path for path, _ in nodes)])
        capability = DANGEROUS_CAPABILITY.search(text)
        if capability:
            findings.append(
                _finding(
                    "TS-101",
                    "high",
                    f"Over-broad tool '{name}'",
                    f"'{capability.group(0)}' in the name, description or parameters.",
                    "Replace a general-purpose tool with narrow ones for the actions the task "
                    "needs, and run it with the least privilege.",
                    "LLM06:2025",
                )
            )
        if SIDE_EFFECT.search(f" {name} {description} ") and not CONFIRMATION.search(
            f"{name} {description} {json.dumps(schema)}"
        ):
            findings.append(
                _finding(
                    "TS-105",
                    "medium",
                    f"Side effects without confirmation in '{name}'",
                    "The tool changes state; nothing mentions a confirmation, approval or dry run.",
                    "Require a human approval bound to the exact arguments for actions with side "
                    "effects, enforced outside the Model.",
                    "LLM06:2025",
                )
            )
        risky = [
            path
            for path, node in nodes
            if node.get("type") == "string"
            and RISKY_PARAM.match(path.split(".")[-1].rstrip("[]"))
            and not (
                node.get("enum")
                or node.get("pattern")
                or node.get("const")
                or node.get("format") in ("date", "date-time", "email")
            )
        ]
        if risky:
            findings.append(
                _finding(
                    "TS-102",
                    "medium",
                    f"Unconstrained parameter in '{name}'",
                    "Free-form " + ", ".join(risky[:5]) + ".",
                    "Constrain with an enum, a pattern, or an allowlist checked in code.",
                    "LLM06:2025",
                    "LLM05:2025",
                )
            )
        open_objects = [
            path
            for path, node in nodes
            if node.get("type") == "object" and node.get("additionalProperties") is not False
        ]
        if open_objects:
            findings.append(
                _finding(
                    "TS-103",
                    "low",
                    f"Undeclared arguments accepted by '{name}'",
                    "additionalProperties is not false at " + ", ".join(open_objects[:5]) + ".",
                    "Set additionalProperties: false so undeclared arguments are rejected.",
                    "LLM06:2025",
                )
            )
        unbounded = [
            path
            for path, node in nodes
            if (node.get("type") == "string" and "maxLength" not in node and not node.get("enum"))
            or (node.get("type") == "array" and "maxItems" not in node)
        ]
        if unbounded:
            findings.append(
                _finding(
                    "TS-104",
                    "low",
                    f"Unbounded inputs in '{name}'",
                    "No maxLength or maxItems at " + ", ".join(unbounded[:5]) + ".",
                    "Bound string lengths and array sizes.",
                    "LLM10:2025",
                )
            )
    return findings, [t["name"] for t in tools]


def analyze(system_prompt: str | None, tool_schema: str | None) -> dict[str, Any]:
    findings: list[Finding] = []
    tools: list[str] = []
    if system_prompt:
        findings += analyze_system_prompt(system_prompt)
    if tool_schema:
        tool_findings, tools = analyze_tool_schema(tool_schema)
        findings += tool_findings
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f.severity, 9), f.rule))
    counts = {level: sum(1 for f in findings if f.severity == level) for level in SEVERITY_ORDER}
    return {
        "findings": [{**asdict(f), "references": list(f.references)} for f in findings],
        "counts": counts,
        "checked": {"system_prompt": bool(system_prompt), "tools": tools},
    }
