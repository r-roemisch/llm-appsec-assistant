"""Admin endpoints for Plugins: the catalog with each Plugin's state, listing a server's Tools,
enabling and disabling, and accepting reviewed definitions.

There is no endpoint that adds a Plugin or sets a command: those live in ``plugins/catalog.yaml``
on the server, and request bodies that carry anything else are rejected.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.db import session_scope
from rampart.deps import csrf_protect, get_db, require_admin
from rampart.models import User
from rampart.plugins.service import PluginService, PluginView
from rampart.schemas import (
    PluginAcceptIn,
    PluginCatalogOut,
    PluginDetailOut,
    PluginUpdateIn,
    plugin_detail_out,
    plugin_out,
)

router = APIRouter(
    prefix="/api/admin/plugins",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(csrf_protect)],
)

PluginId = Annotated[str, Path(max_length=40)]


def get_plugins(request: Request) -> PluginService:
    return request.app.state.plugins


def _usernames(db: Session, views: list[PluginView]) -> dict[int, str]:
    ids = {v.row.accepted_by for v in views if v.row is not None and v.row.accepted_by}
    if not ids:
        return {}
    return {u.id: u.username for u in db.scalars(select(User).where(User.id.in_(ids)))}


def _detail(service: PluginService, plugin_id: str) -> PluginDetailOut:
    with session_scope(service.session_factory) as db:
        view = service.view(db, plugin_id)
        return plugin_detail_out(view, _usernames(db, [view]), service.builtin_names)


@router.get("", response_model=PluginCatalogOut)
def list_plugins(
    service: PluginService = Depends(get_plugins), db: Session = Depends(get_db)
) -> PluginCatalogOut:
    views = service.views(db)
    names = _usernames(db, views)
    return PluginCatalogOut(
        catalog_error=service.catalog().error, plugins=[plugin_out(v, names) for v in views]
    )


@router.get("/{plugin_id}", response_model=PluginDetailOut)
def get_plugin(
    plugin_id: PluginId, service: PluginService = Depends(get_plugins)
) -> PluginDetailOut:
    return _detail(service, plugin_id)


@router.post("/{plugin_id}/refresh", response_model=PluginDetailOut)
async def refresh_plugin(
    plugin_id: PluginId,
    admin: User = Depends(require_admin),
    service: PluginService = Depends(get_plugins),
) -> PluginDetailOut:
    """Start the server, list its Tools and compare them with the accepted definitions."""
    await service.refresh(plugin_id, admin.id)
    return _detail(service, plugin_id)


@router.put("/{plugin_id}", response_model=PluginDetailOut)
async def update_plugin(
    body: PluginUpdateIn,
    plugin_id: PluginId,
    admin: User = Depends(require_admin),
    service: PluginService = Depends(get_plugins),
) -> PluginDetailOut:
    await service.set_enabled(plugin_id, body.enabled, admin.id)
    return _detail(service, plugin_id)


@router.post("/{plugin_id}/accept", response_model=PluginDetailOut)
def accept_plugin(
    body: PluginAcceptIn,
    plugin_id: PluginId,
    admin: User = Depends(require_admin),
    service: PluginService = Depends(get_plugins),
) -> PluginDetailOut:
    service.accept(plugin_id, body.digest, admin.id)
    return _detail(service, plugin_id)
