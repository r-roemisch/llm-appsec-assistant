"""Plugin Tools in the registry: manifests built from accepted definitions only, and an executor
that checks for drift again, against the live server, right before every call.

The Gateway already denies a Tool whose Plugin is disabled, missing or known to have drifted. The
executor's own check covers drift nobody has seen yet: a server whose definitions changed since
they were accepted is recorded as drifted and the call is not made.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.db import session_scope
from rampart.gateway.gateway import BLOCKED_MESSAGES
from rampart.models import Plugin
from rampart.plugins.catalog import PLUGIN_ID
from rampart.plugins.connection import describe_error, list_definitions, result_output
from rampart.plugins.definitions import manifest_for, tools_digest
from rampart.plugins.service import PluginService, blocked_reason
from rampart.tools.registry import Executor, ToolContext, ToolManifest, ToolOutput


class PluginToolSource:
    def __init__(self, service: PluginService) -> None:
        self.service = service

    def manifests(self, db: Session) -> list[ToolManifest]:
        catalog = self.service.catalog()
        found: list[ToolManifest] = []
        for row in db.scalars(select(Plugin).order_by(Plugin.id)):
            if not row.accepted_tools:
                continue
            blocked = blocked_reason(catalog.entries.get(row.id), row)
            for definition in row.accepted_tools:
                manifest = manifest_for(row.id, definition, blocked)
                if manifest is not None:
                    found.append(manifest)
        return found

    def executor(self, name: str) -> Executor | None:
        plugin_id, separator, tool = name.partition("__")
        if not separator or not tool or not PLUGIN_ID.fullmatch(plugin_id):
            return None

        async def run(arguments: dict[str, Any], ctx: ToolContext) -> ToolOutput:
            return await self._run(plugin_id, tool, arguments, ctx)

        return run

    async def _run(
        self, plugin_id: str, tool: str, arguments: dict[str, Any], ctx: ToolContext
    ) -> ToolOutput:
        entry = self.service.catalog().entries.get(plugin_id)
        with session_scope(ctx.session_factory) as db:
            row = db.get(Plugin, plugin_id)
            blocked = blocked_reason(entry, row)
            accepted = row.accepted_tools_digest if row is not None else None
        data: dict[str, Any] = {"plugin": plugin_id, "tool": tool}
        if blocked is not None or entry is None or accepted is None:
            reason = blocked or "plugin_missing"
            return ToolOutput(
                data={**data, "blocked": reason},
                summary="Blocked",
                error=BLOCKED_MESSAGES.get(reason, "the Plugin cannot be used"),
            )
        try:
            async with self.service.client_factory(entry) as client:
                definitions = await list_definitions(client)
                if tools_digest(definitions) != accepted:
                    self.service.record_listing(plugin_id, definitions, None)
                    return ToolOutput(
                        data={**data, "blocked": "plugin_drift"},
                        summary="Blocked",
                        error=BLOCKED_MESSAGES["plugin_drift"],
                    )
                result = await client.call_tool(tool, arguments)
        except Exception as exc:  # a broken server costs this call, never the turn
            return ToolOutput(
                data=data,
                summary="Plugin unavailable",
                error=f"the Plugin could not be used: {describe_error(exc)}",
            )
        self.service.record_listing(plugin_id, definitions, None)  # seen just now, unchanged
        return result_output(plugin_id, tool, result)
