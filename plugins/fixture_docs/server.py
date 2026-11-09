"""Rampart fixture Plugin: read-only access to a few synthetic security notes, over MCP stdio.

The notes are fixed Markdown files in docs/ next to this script. A document id is looked up in a
fixed table, so no path from a caller ever reaches the filesystem. One note (vendor-faq) carries an
instruction aimed at AI assistants on purpose, to show that Rampart treats Plugin output as
untrusted data: the instruction is flagged, not obeyed. Everything here is synthetic.

plugins/fixture_docs_drifted/ is a modified copy of this server, used to demonstrate drift.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import Field

DOCS_DIR = Path(__file__).resolve().parent / "docs"
DOCS: dict[str, tuple[str, str]] = {
    "mcp-hardening": ("MCP server hardening checklist", "mcp-hardening.md"),
    "approval-policy": ("Tool approval policy", "approval-policy.md"),
    "vendor-faq": ("Vendor FAQ (third-party page)", "vendor-faq.md"),
}

server = MCPServer(
    "rampart-fixture-docs",
    version="1.0.0",
    instructions="Read-only access to a few synthetic internal security notes.",
)


def _text(doc_id: str) -> str:
    return (DOCS_DIR / DOCS[doc_id][1]).read_text(encoding="utf-8")


@server.tool()
def list_docs() -> list[dict[str, str]]:
    """List the available notes with their ids and titles."""
    return [{"id": doc_id, "title": title} for doc_id, (title, _) in DOCS.items()]


@server.tool()
def read_doc(
    doc_id: Annotated[str, Field(max_length=64, description="A document id from list_docs.")],
) -> str:
    """Read one note by its id."""
    if doc_id not in DOCS:
        raise ToolError(f"unknown document id {doc_id!r}; list_docs gives the ids")
    return _text(doc_id)


@server.tool()
def search_docs(
    query: Annotated[str, Field(min_length=2, max_length=200, description="Words to look for.")],
) -> list[dict[str, str]]:
    """Find notes that mention all the given words; returns ids, titles and a short snippet."""
    words = [w.lower() for w in query.split()]
    hits: list[dict[str, str]] = []
    for doc_id, (title, _) in DOCS.items():
        text = _text(doc_id)
        lower = text.lower()
        if words and all(w in lower for w in words):
            at = lower.find(words[0])
            snippet = " ".join(text[max(0, at - 60) : at + 140].split())
            hits.append({"id": doc_id, "title": title, "snippet": snippet})
    return hits


if __name__ == "__main__":
    server.run()
