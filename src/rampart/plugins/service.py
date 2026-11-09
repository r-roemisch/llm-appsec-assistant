"""Plugins as the admin handles them: the catalog merged with stored state, listing a server's
Tools, enabling and disabling, and accepting definitions.

Status of a Plugin:

- ``new``             in the catalog, never listed
- ``pending_review``  listed, never accepted: none of its Tools is offered
- ``ok``              the last listing matches the accepted definitions
- ``drifted``         the last listing differs from the accepted definitions: use is blocked
- ``error``           the last listing failed (definitions accepted earlier stay as they were)
- ``missing``         stored, but no longer in the catalog: use is blocked
- ``invalid``         the catalog entry itself is invalid

Accepting is bound to the digest the admin reviewed, so definitions that changed between the
review and the click are never accepted unseen.
"""

from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from rampart.config import Settings
from rampart.db import session_scope, utcnow
from rampart.errors import Conflict, Invalid, NotFound
from rampart.models import Plugin
from rampart.plugins.catalog import Catalog, CatalogEntry, CatalogFile
from rampart.plugins.connection import ClientFactory, describe_error, list_definitions
from rampart.plugins.definitions import tools_digest

STATUSES = ("new", "pending_review", "ok", "drifted", "error", "missing", "invalid")


def plugin_status(entry: CatalogEntry | None, row: Plugin | None) -> str:
    if entry is None:
        return "missing"
    if entry.error is not None:
        return "invalid"
    if row is None or (row.current_tools_digest is None and row.last_error is None):
        return "new"
    if row.current_tools_digest is None:
        return "error"
    if row.accepted_tools_digest is None:
        return "pending_review"
    if row.current_tools_digest != row.accepted_tools_digest:
        return "drifted"
    return "error" if row.last_error else "ok"


def blocked_reason(entry: CatalogEntry | None, row: Plugin | None) -> str | None:
    """Why a Plugin's accepted Tools may not be used now, as a Gateway reason code."""
    if entry is None or entry.error is not None:
        return "plugin_missing"
    if row is None or not row.enabled:
        return "plugin_disabled"
    if row.current_tools_digest != row.accepted_tools_digest:
        return "plugin_drift"
    return None


@dataclass(frozen=True)
class PluginView:
    id: str
    entry: CatalogEntry | None
    row: Plugin | None
    status: str


class PluginService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        settings: Settings,
        client_factory: ClientFactory,
        builtin_names: frozenset[str] = frozenset(),
    ) -> None:
        self.session_factory = session_factory
        self.settings = settings
        self.client_factory = client_factory
        self.builtin_names = builtin_names
        self.catalog_file = CatalogFile(
            settings.plugins_catalog_path, settings.plugins_dir, settings.plugin_timeout_seconds
        )

    def catalog(self) -> Catalog:
        return self.catalog_file.get()

    # ---- reads -------------------------------------------------------------------------------

    def views(self, db: Session) -> list[PluginView]:
        """Every catalog entry in file order, then stored Plugins no longer in the catalog."""
        catalog = self.catalog()
        rows = {r.id: r for r in db.scalars(select(Plugin))}
        ids = list(catalog.entries) + sorted(set(rows) - set(catalog.entries))
        return [
            PluginView(
                i,
                catalog.entries.get(i),
                rows.get(i),
                plugin_status(catalog.entries.get(i), rows.get(i)),
            )
            for i in ids
        ]

    def view(self, db: Session, plugin_id: str) -> PluginView:
        entry = self.catalog().entries.get(plugin_id)
        row = db.get(Plugin, plugin_id)
        if entry is None and row is None:
            raise NotFound(f"there is no Plugin {plugin_id} in the catalog")
        return PluginView(plugin_id, entry, row, plugin_status(entry, row))

    # ---- actions -----------------------------------------------------------------------------

    def _usable_entry(self, plugin_id: str) -> CatalogEntry:
        entry = self.catalog().entries.get(plugin_id)
        if entry is None:
            raise NotFound(f"there is no Plugin {plugin_id} in the catalog")
        if entry.error is not None:
            raise Invalid(f"the catalog entry for {plugin_id} is invalid: {entry.error}")
        return entry

    async def list_tools(self, entry: CatalogEntry) -> list[dict[str, Any]]:
        """Start the server, list its Tools, stop it. Raises when that fails."""
        async with self.client_factory(entry) as client:
            return await list_definitions(client)

    async def refresh(self, plugin_id: str, admin_id: int | None = None) -> str:
        """List the server's Tools now and store the result; returns the new status."""
        entry = self._usable_entry(plugin_id)
        try:
            definitions = await asyncio.wait_for(
                self.list_tools(entry), timeout=entry.timeout_seconds + 5
            )
        except Exception as exc:  # a broken server is a status, not a crash
            return self.record_listing(plugin_id, None, describe_error(exc), admin_id)
        return self.record_listing(plugin_id, definitions, None, admin_id)

    def record_listing(
        self,
        plugin_id: str,
        definitions: list[dict[str, Any]] | None,
        error: str | None,
        admin_id: int | None = None,
    ) -> str:
        """Store a listing, or why it failed, and return the new status. A listing whose digest
        differs from the accepted one is drift; it is recorded here wherever it was seen."""
        with session_scope(self.session_factory) as db:
            row = self._row(db, plugin_id)
            if definitions is not None:
                row.current_tools = definitions
                row.current_tools_digest = tools_digest(definitions)
                row.last_seen = utcnow()
                row.last_error = None
            else:
                row.last_error = (error or "unknown error")[:500]
            row.status = plugin_status(self.catalog().entries.get(plugin_id), row)
            row.updated_at = utcnow()
            if admin_id is not None:
                row.updated_by = admin_id
            return row.status

    async def set_enabled(self, plugin_id: str, enabled: bool, admin_id: int) -> None:
        """Enabling lists the server's Tools straight away; its Tools are still not offered
        until an admin accepts their definitions."""
        if enabled:
            self._usable_entry(plugin_id)
        with session_scope(self.session_factory) as db:
            if db.get(Plugin, plugin_id) is None and plugin_id not in self.catalog().entries:
                raise NotFound(f"there is no Plugin {plugin_id} in the catalog")
            row = self._row(db, plugin_id)
            row.enabled = enabled
            row.updated_at = utcnow()
            row.updated_by = admin_id
        if enabled:
            await self.refresh(plugin_id, admin_id)

    def accept(self, plugin_id: str, digest: str, admin_id: int) -> None:
        entry = self._usable_entry(plugin_id)
        with session_scope(self.session_factory) as db:
            row = db.get(Plugin, plugin_id)
            if row is None or row.current_tools_digest is None or row.current_tools is None:
                raise Conflict("list the Plugin's tools before accepting them")
            if digest != row.current_tools_digest:
                raise Conflict(
                    "the tool definitions changed since you reviewed them; review the current "
                    "definitions and accept again"
                )
            row.accepted_tools = copy.deepcopy(row.current_tools)
            row.accepted_tools_digest = row.current_tools_digest
            row.accepted_at = utcnow()
            row.accepted_by = admin_id
            row.status = plugin_status(entry, row)
            row.updated_at = utcnow()
            row.updated_by = admin_id

    @staticmethod
    def _row(db: Session, plugin_id: str) -> Plugin:
        row = db.get(Plugin, plugin_id)
        if row is None:
            row = Plugin(id=plugin_id, enabled=False, status="new")
            db.add(row)
            db.flush()
        return row
