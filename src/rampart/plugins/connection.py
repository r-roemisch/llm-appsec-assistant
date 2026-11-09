"""Talking to a Plugin's MCP server over stdio with the official MCP Python SDK.

Every listing and every call starts the server, uses it and stops it: there is no long-lived
process to look after, and a server that crashes costs one call. The process gets only the SDK's
minimal environment (PATH, HOME, USER and a few more), so Rampart's credentials never reach it. It
runs in its own folder under the data directory, with its stderr in a log file there.

The client offers the server nothing back: no sampling (a Plugin cannot use Rampart's Models), no
elicitation (it cannot ask the user anything) and no roots (it is told about no folders).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import Any

import mcp_types
from mcp import Client, Implementation, StdioServerParameters, stdio_client

from rampart import __version__
from rampart.config import Settings
from rampart.guards.secrets import redact
from rampart.plugins.catalog import CatalogEntry
from rampart.plugins.definitions import MAX_TOOLS, tool_definition
from rampart.tools.registry import ToolOutput

ClientFactory = Callable[[CatalogEntry], AbstractAsyncContextManager[Client]]
MAX_PAGES = 10
MAX_LOG_BYTES = 1_000_000
MAX_RESULT_CHARS = 20_000


class PluginError(RuntimeError):
    """The server answered, but not with something Rampart can accept."""


def stdio_client_factory(settings: Settings) -> ClientFactory:
    @asynccontextmanager
    async def open_client(entry: CatalogEntry) -> AsyncIterator[Client]:
        workdir = settings.plugin_work_dir / entry.id
        workdir.mkdir(parents=True, exist_ok=True)
        log_path = workdir / "stderr.log"
        mode = "w" if log_path.exists() and log_path.stat().st_size > MAX_LOG_BYTES else "a"
        with log_path.open(mode, encoding="utf-8") as errlog:
            params = StdioServerParameters(
                command=entry.command, args=list(entry.args), cwd=workdir
            )
            client = Client(
                stdio_client(params, errlog=errlog),
                cache=None,  # every listing is fresh: drift must never hide behind a cache
                read_timeout_seconds=entry.timeout_seconds,
                client_info=Implementation(name="rampart", version=__version__),
            )
            async with client:
                yield client

    return open_client


def describe_error(exc: BaseException) -> str:
    """A short, secret-free description of why a Plugin could not be used."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    text = str(exc).strip().splitlines()[0][:200] if str(exc).strip() else ""
    return redact(f"{type(exc).__name__}: {text}" if text else type(exc).__name__).text


async def list_definitions(client: Client) -> list[dict[str, Any]]:
    definitions: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(MAX_PAGES):
        page = await client.list_tools(cursor=cursor)
        definitions += [tool_definition(t) for t in page.tools]
        cursor = page.next_cursor
        if not cursor:
            break
    else:
        raise PluginError(f"the server listed more than {MAX_PAGES} pages of tools")
    names = [d["name"] for d in definitions]
    if len(names) != len(set(names)):
        raise PluginError("the server listed two tools with the same name")
    if len(definitions) > MAX_TOOLS:
        raise PluginError(f"the server listed {len(definitions)} tools; at most {MAX_TOOLS}")
    return sorted(definitions, key=lambda d: d["name"])


def _structured_value(structured: Any) -> Any:
    """MCPServer wraps a non-object return value as {"result": value}; unwrap it."""
    if isinstance(structured, dict) and set(structured) == {"result"}:
        return structured["result"]
    return structured


def _first_line(text: str) -> str:
    first = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return first if len(first) <= 160 else first[:159] + "\u2026"


def result_output(plugin_id: str, tool: str, result: mcp_types.CallToolResult) -> ToolOutput:
    """A call's result as Tool output. A structured list or object becomes one JSON document;
    otherwise the text blocks are joined. Other content (images, audio, resources) is counted,
    not passed on. The ToolSet then redacts secrets and delimits it all as Plugin data."""
    texts: list[str] = []
    omitted: list[str] = []
    for block in result.content:
        if isinstance(block, mcp_types.TextContent):
            texts.append(block.text)
        else:
            omitted.append(str(getattr(block, "type", type(block).__name__)))
    value = _structured_value(result.structured_content)
    if isinstance(value, list | dict) and not result.is_error:
        body = json.dumps(value, ensure_ascii=False, indent=2, default=str)
        summary = (
            f"Returned {len(value)} item(s)"
            if isinstance(value, list)
            else f"Returned an object with {len(value)} field(s)"
        )
    else:
        body = "\n".join(texts).strip()
        if not body and value is not None:
            body = value if isinstance(value, str) else json.dumps(value, default=str)
        summary = _first_line(body) or "No output"
    if omitted:
        kinds = ", ".join(sorted(set(omitted)))
        body += f"\n[{len(omitted)} non-text content block(s) omitted: {kinds}]"
    body = body[:MAX_RESULT_CHARS]
    data: dict[str, Any] = {"plugin": plugin_id, "tool": tool, "text": body}
    if result.is_error:
        return ToolOutput(
            data={**data, "is_error": True},
            summary="The Plugin reported an error",
            model_text=body,
            error=body[:300] or "the Plugin reported an error",
        )
    return ToolOutput(data=data, summary=summary, model_text=body)
