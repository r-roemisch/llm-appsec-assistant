"""Splitting documents into Passages: by heading first, then by a word window.

Markdown is split at headings down to ``split_level``; deeper headings stay inside the
section as plain lines. Sections longer than the window are split at paragraph boundaries,
and a paragraph longer than the window is split into overlapping word windows. Page-based
text (PDFs) is windowed per page and keeps "Page N" as its heading, so a Citation can
point at the page.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Collection
from dataclasses import dataclass

from rampart.knowledge.text import clean_text, estimate_tokens, word_count

MAX_WORDS = 280
OVERLAP_WORDS = 40

_HEADING = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
_FENCE = re.compile(r"^\s*(```|~~~)")
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")
_PAGE_NUMBER = re.compile(r"^\s*(page\s+)?\d{1,4}\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class Chunk:
    heading: str | None
    text: str
    token_count: int


def _clean_heading(raw: str) -> str:
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", raw)  # [label](link) -> label
    text = text.replace("**", "").replace("__", "").replace("`", "")
    return " ".join(text.split())


def _windows(words: list[str], max_words: int, overlap: int) -> list[str]:
    if len(words) <= max_words:
        return [" ".join(words)]
    step = max(1, max_words - overlap)
    out: list[str] = []
    start = 0
    while start < len(words):
        out.append(" ".join(words[start : start + max_words]))
        if start + max_words >= len(words):
            break
        start += step
    return out


def split_body(body: str, *, max_words: int = MAX_WORDS, overlap: int = OVERLAP_WORDS) -> list[str]:
    """Paragraph-aligned pieces of at most ``max_words`` words (long paragraphs are windowed)."""
    pieces: list[str] = []
    current: list[str] = []
    current_words = 0
    for paragraph in (p.strip() for p in _PARAGRAPH_BREAK.split(body)):
        if not paragraph:
            continue
        words = word_count(paragraph)
        if words > max_words:
            if current:
                pieces.append("\n\n".join(current))
                current, current_words = [], 0
            pieces.extend(_windows(paragraph.split(), max_words, overlap))
            continue
        if current and current_words + words > max_words:
            pieces.append("\n\n".join(current))
            current, current_words = [], 0
        current.append(paragraph)
        current_words += words
    if current:
        pieces.append("\n\n".join(current))
    return pieces


def chunk_markdown(
    markdown: str,
    *,
    split_level: int = 3,
    max_words: int = MAX_WORDS,
    overlap: int = OVERLAP_WORDS,
    skip_headings: Collection[str] = (),
) -> list[Chunk]:
    """Passages from Markdown, each with the heading path it sits under ("A > B")."""
    skip = {h.lower() for h in skip_headings}
    sections: list[tuple[list[str], list[str]]] = []
    stack: list[tuple[int, str]] = []
    lines: list[str] = []
    in_fence = False

    def flush() -> None:
        if any(line.strip() for line in lines):
            sections.append(([title for _, title in stack], list(lines)))
        lines.clear()

    for line in clean_text(markdown).split("\n"):
        if _FENCE.match(line):
            in_fence = not in_fence
            lines.append(line)
            continue
        match = None if in_fence else _HEADING.match(line)
        if match is None:
            lines.append(line)
            continue
        level, title = len(match.group(1)), _clean_heading(match.group(2))
        if level > split_level:
            lines.append(title)  # a deeper heading stays in the text as its own line
            continue
        flush()
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, title))
    flush()

    chunks: list[Chunk] = []
    for path, body_lines in sections:
        if path and path[-1].lower() in skip:
            continue
        heading = " > ".join(path) if path else None
        for piece in split_body("\n".join(body_lines), max_words=max_words, overlap=overlap):
            chunks.append(Chunk(heading=heading, text=piece, token_count=estimate_tokens(piece)))
    return chunks


def chunk_plain(
    text: str,
    *,
    heading: str | None = None,
    max_words: int = MAX_WORDS,
    overlap: int = OVERLAP_WORDS,
) -> list[Chunk]:
    return [
        Chunk(heading=heading, text=piece, token_count=estimate_tokens(piece))
        for piece in split_body(clean_text(text), max_words=max_words, overlap=overlap)
    ]


def clean_pages(pages: list[str]) -> list[str]:
    """Drop running headers, footers and page numbers; rejoin words hyphenated at line ends."""
    cleaned = [clean_text(page) for page in pages]
    if len(cleaned) >= 4:
        counts = Counter(
            line.strip() for page in cleaned for line in set(page.split("\n")) if line.strip()
        )
        repeated = {line for line, n in counts.items() if n >= max(3, len(cleaned) // 2)}
    else:
        repeated = set()
    out: list[str] = []
    for page in cleaned:
        kept = [
            line
            for line in page.split("\n")
            if line.strip() not in repeated and not _PAGE_NUMBER.match(line)
        ]
        joined = _HYPHEN_BREAK.sub(r"\1\2", "\n".join(kept))
        # PDF text breaks lines at the layout width; keep blank lines as paragraph breaks.
        paragraphs = [" ".join(p.split()) for p in _PARAGRAPH_BREAK.split(joined)]
        out.append("\n\n".join(p for p in paragraphs if p))
    return out


def chunk_pages(
    pages: list[str], *, max_words: int = MAX_WORDS, overlap: int = OVERLAP_WORDS
) -> list[Chunk]:
    chunks: list[Chunk] = []
    for number, page in enumerate(clean_pages(pages), start=1):
        if not page.strip():
            continue
        for piece in split_body(page, max_words=max_words, overlap=overlap):
            chunks.append(
                Chunk(heading=f"Page {number}", text=piece, token_count=estimate_tokens(piece))
            )
    return chunks
