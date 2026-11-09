"""Type checks and text extraction for uploads (PDF, Markdown, text) and fetched PDFs.

The type is decided by the file extension and confirmed by the content: a PDF must carry
the PDF header, and Markdown or text must be UTF-8 without NUL bytes or a binary signature.
The client's declared content type is ignored.
"""

from __future__ import annotations

import io
import re
import unicodedata
from dataclasses import dataclass
from pathlib import PurePath

from rampart.errors import Invalid
from rampart.knowledge.chunking import Chunk, chunk_markdown, chunk_pages, chunk_plain

UPLOAD_TYPES: dict[str, str] = {
    ".pdf": "pdf",
    ".md": "markdown",
    ".markdown": "markdown",
    ".txt": "text",
}
MAX_EXTRACTED_CHARS = 2_000_000

_BINARY_SIGNATURES = (
    b"%PDF-",
    b"\x89PNG",
    b"GIF8",
    b"\xff\xd8\xff",
    b"PK\x03\x04",
    b"\x7fELF",
    b"MZ",
    b"\x1f\x8b",
    b"\xd0\xcf\x11\xe0",
)
_UNSAFE_NAME = re.compile(r"[\x00-\x1f\x7f/\\]")


@dataclass(frozen=True)
class ParsedUpload:
    kind: str  # "pdf", "markdown" or "text"
    title: str
    chunks: list[Chunk]


def clean_filename(name: str) -> str:
    base = PurePath(name.replace("\\", "/")).name
    base = unicodedata.normalize("NFC", _UNSAFE_NAME.sub("", base)).strip()
    return base[:200] or "upload"


def upload_kind(filename: str) -> str:
    suffix = PurePath(filename.lower()).suffix
    kind = UPLOAD_TYPES.get(suffix)
    if kind is None:
        allowed = ", ".join(UPLOAD_TYPES)
        raise Invalid(f"unsupported file type '{suffix or filename}': upload {allowed}")
    return kind


def decode_text(data: bytes) -> str:
    head = data[:8]
    if any(head.startswith(signature) for signature in _BINARY_SIGNATURES):
        raise Invalid("the file content is binary, not Markdown or text")
    if b"\x00" in data:
        raise Invalid("the file contains NUL bytes; Markdown and text uploads must be UTF-8 text")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise Invalid("Markdown and text uploads must be UTF-8 encoded") from exc
    return text


def pdf_pages(data: bytes, *, max_pages: int) -> list[str]:
    """Text of each page. Refuses non-PDF content, encrypted files and oversized documents."""
    if b"%PDF-" not in data[:1024]:
        raise Invalid("the file does not look like a PDF (no PDF header)")
    from pypdf import PdfReader

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    raise Invalid("encrypted PDFs are not supported")
            except Invalid:
                raise
            except Exception as exc:
                raise Invalid("encrypted PDFs are not supported") from exc
        count = len(reader.pages)
        if count > max_pages:
            raise Invalid(f"the PDF has {count} pages; the limit is {max_pages}")
        pages: list[str] = []
        total = 0
        for page in reader.pages:
            text = page.extract_text() or ""
            total += len(text)
            if total > MAX_EXTRACTED_CHARS:
                raise Invalid("the PDF holds more text than an upload may contain")
            pages.append(text)
    except Invalid:
        raise
    except Exception as exc:  # any parser failure on a hostile or broken file is a bad upload
        raise Invalid(f"the PDF could not be read: {type(exc).__name__}") from exc
    return pages


def parse_upload(filename: str, data: bytes, *, max_pages: int) -> ParsedUpload:
    title = clean_filename(filename)
    kind = upload_kind(title)
    if not data:
        raise Invalid("the file is empty")
    if kind == "pdf":
        chunks = chunk_pages(pdf_pages(data, max_pages=max_pages))
        if not chunks:
            raise Invalid("the PDF has no extractable text (scanned PDFs are not supported)")
    else:
        text = decode_text(data)
        if len(text) > MAX_EXTRACTED_CHARS:
            raise Invalid("the file holds more text than an upload may contain")
        chunks = chunk_markdown(text) if kind == "markdown" else chunk_plain(text)
        if not chunks:
            raise Invalid("the file has no text")
    return ParsedUpload(kind=kind, title=title, chunks=chunks)
