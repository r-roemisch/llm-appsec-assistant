"""The Model catalog for everyone; Slot and enable switches for admins."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from rampart.catalog.service import CatalogService
from rampart.deps import csrf_protect, current_user, get_db, require_admin
from rampart.schemas import (
    ModelEnabledIn,
    ModelOut,
    ModelsOut,
    SlotOut,
    SlotUpdateIn,
    model_out,
    slots_out,
)
from rampart.unset import UNSET

router = APIRouter(prefix="/api/models", tags=["models"], dependencies=[Depends(current_user)])
admin_router = APIRouter(
    prefix="/api/admin/models",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(csrf_protect)],
)


def get_catalog_service(request: Request, db: Session = Depends(get_db)) -> CatalogService:
    return CatalogService(db, request.app.state.catalog, request.app.state.probe)


@router.get("", response_model=ModelsOut)
def list_models(service: CatalogService = Depends(get_catalog_service)) -> ModelsOut:
    return ModelsOut(
        models=[model_out(v) for v in service.model_views()],
        slots=slots_out(service.slot_configs()),
    )


@admin_router.put("/slots/{slot}", response_model=dict[str, SlotOut])
def update_slot(
    slot: str, body: SlotUpdateIn, service: CatalogService = Depends(get_catalog_service)
) -> dict[str, SlotOut]:
    provided = body.model_fields_set
    configs = service.set_slot(
        slot,
        model_id=body.model_id if "model_id" in provided and body.model_id else UNSET,
        temperature=body.temperature if "temperature" in provided else UNSET,
        max_tokens=body.max_tokens if "max_tokens" in provided else UNSET,
    )
    service.db.commit()
    return slots_out(configs)


@admin_router.delete("/slots/{slot}", response_model=dict[str, SlotOut])
def reset_slot(
    slot: str, service: CatalogService = Depends(get_catalog_service)
) -> dict[str, SlotOut]:
    configs = service.reset_slot(slot)
    service.db.commit()
    return slots_out(configs)


@admin_router.put("/{model_id:path}", response_model=ModelOut)
def set_model_enabled(
    model_id: str, body: ModelEnabledIn, service: CatalogService = Depends(get_catalog_service)
) -> ModelOut:
    view = service.set_enabled(model_id, body.enabled)
    service.db.commit()
    return model_out(view)
