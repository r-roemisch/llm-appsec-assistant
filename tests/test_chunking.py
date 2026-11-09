import pytest

from helpers import make_pdf
from rampart.errors import Invalid
from rampart.knowledge.chunking import chunk_markdown, chunk_pages, clean_pages, split_body
from rampart.knowledge.parsers import clean_filename, parse_upload
from rampart.knowledge.text import keyword_tokens, snippet


def test_markdown_splits_by_heading_path_and_keeps_deeper_headings_inline():
    text = """# Guide

Intro line.

## Install

Run the installer.

### Options

#### Flags

Use --fast.

```
# not a heading inside a fence
```

## Reference Links

- https://example.org
"""
    chunks = chunk_markdown(text, split_level=3, skip_headings={"Reference Links"})
    headings = [c.heading for c in chunks]
    assert headings == ["Guide", "Guide > Install", "Guide > Install > Options"]
    options = chunks[2].text
    assert "Flags" in options and "Use --fast." in options
    assert "# not a heading inside a fence" in options
    assert all(c.token_count > 0 for c in chunks)


def test_long_sections_are_windowed_on_paragraphs_then_words():
    paragraphs = "\n\n".join(" ".join(["word"] * 120) for _ in range(5))  # 600 words
    pieces = split_body(paragraphs, max_words=280, overlap=40)
    assert len(pieces) == 3 and all(len(p.split()) <= 280 for p in pieces)
    huge = " ".join(f"w{i}" for i in range(700))
    windows = split_body(huge, max_words=280, overlap=40)
    assert len(windows) == 3
    assert windows[0].split()[-40:] == windows[1].split()[:40]  # overlapping windows


def test_pages_drop_running_headers_and_join_hyphenation():
    pages = [
        f"NIST AI 100-1\nPage text {i} about manage-\nment of risk number {i}\n{i}"
        for i in range(1, 6)
    ]
    cleaned = clean_pages(pages)
    assert all("NIST AI 100-1" not in page for page in cleaned)  # running header
    assert "management of risk number 1" in cleaned[0]  # hyphenation joined
    assert not cleaned[0].rstrip().endswith("1\n1")  # bare page number dropped
    chunks = chunk_pages(pages)
    assert [c.heading for c in chunks] == [f"Page {i}" for i in range(1, 6)]


def test_keyword_tokens_and_snippets():
    assert keyword_tokens("The AML.T0051 LLM-Prompt injection, of course!") == [
        "aml",
        "t0051",
        "llm",
        "prompt",
        "injection",
        "course",
    ]
    long_text = "word " * 200
    cut = snippet(long_text, 50)
    assert len(cut) <= 50 and cut.endswith("…")


def test_upload_parsing_checks_type_by_extension_and_content():
    md = parse_upload("notes.md", b"# Notes\n\nSome text about tokens.", max_pages=10)
    assert md.kind == "markdown" and md.title == "notes.md" and md.chunks
    txt = parse_upload("../../etc/plain.TXT", "Grüße, plain text".encode(), max_pages=10)
    assert txt.kind == "text" and txt.title == "plain.TXT"
    pdf = parse_upload("doc.pdf", make_pdf(["Hello quokka page one", "Second page"]), max_pages=10)
    assert pdf.kind == "pdf" and [c.heading for c in pdf.chunks] == ["Page 1", "Page 2"]
    assert "quokka" in pdf.chunks[0].text

    for name, data, message in [
        ("tool.exe", b"MZ\x90\x00", "unsupported file type"),
        ("image.png", b"\x89PNG\r\n", "unsupported file type"),
        ("fake.pdf", b"just text", "does not look like a PDF"),
        ("fake.txt", b"%PDF-1.4 binary", "binary"),
        ("zip.md", b"PK\x03\x04rest", "binary"),
        ("nul.txt", b"abc\x00def", "NUL"),
        ("latin.txt", "café".encode("latin-1"), "UTF-8"),
        ("empty.md", b"", "empty"),
        ("blank.txt", b"   \n\n  ", "no text"),
    ]:
        with pytest.raises(Invalid, match=message):
            parse_upload(name, data, max_pages=10)
    with pytest.raises(Invalid, match="pages"):
        parse_upload("long.pdf", make_pdf(["a"] * 4), max_pages=3)
    with pytest.raises(Invalid, match="no extractable text"):
        parse_upload("blank.pdf", make_pdf([""]), max_pages=3)
    broken = make_pdf(["fine"]).replace(b"/Root 1 0 R", b"/Root 99 0 R")
    with pytest.raises(Invalid, match="could not be read"):
        parse_upload("broken.pdf", broken[:200], max_pages=3)


def test_clean_filename_strips_paths_and_control_characters():
    assert clean_filename("C:\\Users\\x\\report.pdf") == "report.pdf"
    assert clean_filename("a\x00b\nc.md") == "abc.md"
    assert clean_filename("") == "upload"
