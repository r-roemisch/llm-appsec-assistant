"""Small text helpers shared by chunking, keyword search and citations."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable

_WORD = re.compile(r"\S+")
_TOKEN = re.compile(r"[a-z0-9]+")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_BLANK_RUNS = re.compile(r"\n{3,}")
_SPACES = re.compile(r"\s+")

# Words too common to help keyword search. Security vocabulary stays in.
STOPWORDS = frozenset(
    """a about above after again against all also am an and any are as at be because been
    before being below between both but by can could did do does doing down during each
    few for from further had has have having he her here hers him his how i if in into is
    it its itself just me more most my no nor not now of off on once only or other our
    ours out over own same she should so some such than that the their theirs them then
    there these they this those through to too under until up very was we were what when
    where which while who whom why will with would you your yours""".split()  # noqa: SIM905
)


def clean_text(text: str) -> str:
    """Normalise line endings, drop control characters and trailing spaces, squeeze blank runs."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return _BLANK_RUNS.sub("\n\n", text).strip()


def word_count(text: str) -> int:
    return len(_WORD.findall(text))


def estimate_tokens(text: str) -> int:
    """A provider-neutral estimate (about four tokens per three words); no tokenizer download."""
    words = word_count(text)
    return (words * 4 + 2) // 3 if words else 0


def collapse(text: str) -> str:
    return _SPACES.sub(" ", text).strip()


def snippet(text: str, limit: int = 300) -> str:
    flat = collapse(text)
    if len(flat) <= limit:
        return flat
    cut = flat[: limit - 1]
    space = cut.rfind(" ")
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip(" ,;:") + "…"


def keyword_tokens(text: str) -> list[str]:
    """Lower-case alphanumeric tokens without stopwords: the BM25 vocabulary."""
    return [
        token
        for token in _TOKEN.findall(text.lower())
        if token not in STOPWORDS and (len(token) > 1 or token.isdigit())
    ]


def sha256_text(parts: Iterable[str]) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\x1e")
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
