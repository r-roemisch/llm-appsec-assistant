"""Secret and credential patterns, and their redaction (G1 for pasted secrets, G4 for output).

Each match is replaced by ``[REDACTED:<kind>]``. For key-value forms only the value is
replaced, so the text stays readable ("password: [REDACTED:credential]"). Values that are
clearly references, not secrets (environment lookups, template placeholders), are left alone.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

_NOT_A_VALUE = (
    r"(?!\[REDACTED|os\.|process\.env|env\(|getenv|\$\{|\$[A-Z_]|<|\{\{|\*{3,}|x{6,}|X{6,})"
)

# A credential key: the keyword alone or inside an identifier joined by _ . or - (DB_PASSWORD,
# smtp.password, AWS_SECRET_ACCESS_KEY, secret_key), as configuration files and environment
# variables name them. A bare "token" is left out: max_tokens and tokenizer are everyday words
# in LLM configuration, and token-shaped secrets have their own patterns above.
_CREDENTIAL_KEY = (
    r"(?<![A-Za-z0-9_.\-])(?:[A-Za-z0-9_.\-]{0,40}[_.\-])?"
    r"(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|"
    r"client[_-]?secret|private[_-]?key)"
    r"(?:[_.\-][A-Za-z0-9_.\-]{0,30})?(?![A-Za-z0-9])"
)


@dataclass(frozen=True)
class SecretPattern:
    kind: str
    regex: re.Pattern[str]
    group: int = 0  # 0 redacts the whole match, otherwise just this group


PATTERNS: tuple[SecretPattern, ...] = (
    SecretPattern(
        "private_key",
        re.compile(
            r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?"
            r"-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----"
        ),
    ),
    SecretPattern("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}")),
    SecretPattern("openrouter_key", re.compile(r"\bsk-or-v1-[A-Za-z0-9]{20,}")),
    SecretPattern("langfuse_key", re.compile(r"\b(?:sk|pk)-lf-[A-Za-z0-9\-]{16,}")),
    SecretPattern("openai_key", re.compile(r"\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{20,}")),
    SecretPattern("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    SecretPattern(
        "github_token",
        re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    ),
    SecretPattern("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}")),
    SecretPattern("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    SecretPattern("stripe_key", re.compile(r"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b")),
    SecretPattern(
        "jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}")
    ),
    SecretPattern(
        "url_credentials",
        # The scheme is bounded: unbounded, every word boundary in "a.a.a..." rescanned the rest.
        re.compile(r"\b[a-z][a-z0-9+.\-]{0,63}://[^\s:/@]+:" + _NOT_A_VALUE + r"([^\s@/]{3,})@"),
        group=1,
    ),
    SecretPattern(
        "credential",
        re.compile(
            _CREDENTIAL_KEY + r"[\"']?\s*[:=]\s*[\"']?" + _NOT_A_VALUE + r"([^\s\"'`,;]{8,})",
            re.IGNORECASE,
        ),
        group=1,
    ),
)

# A credential key whose value may still be arriving at the end of a streamed buffer.
CREDENTIAL_TAIL = re.compile(_CREDENTIAL_KEY + r"[\"']?\s*[:=]?\s*[\"']?\S*$", re.IGNORECASE)


@dataclass
class Redaction:
    text: str
    counts: Counter[str] = field(default_factory=Counter)

    @property
    def total(self) -> int:
        return sum(self.counts.values())


def redact(text: str) -> Redaction:
    counts: Counter[str] = Counter()
    for pattern in PATTERNS:

        def replace(
            match: re.Match[str], kind: str = pattern.kind, group: int = pattern.group
        ) -> str:
            counts[kind] += 1
            marker = f"[REDACTED:{kind}]"
            if group == 0:
                return marker
            start, end = match.span(group)
            offset = match.start()
            whole = match.group(0)
            return whole[: start - offset] + marker + whole[end - offset :]

        text = pattern.regex.sub(replace, text)
    return Redaction(text=text, counts=counts)


def redact_value(value: object) -> object:
    """Redact strings inside JSON-like data (Tool arguments and results)."""
    if isinstance(value, str):
        return redact(value).text
    if isinstance(value, list):
        return [redact_value(v) for v in value]
    if isinstance(value, dict):
        return {k: redact_value(v) for k, v in value.items()}
    return value
