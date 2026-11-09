"""The caller's own Targets: register (loopback only), list, update, delete."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from rampart.deps import csrf_protect, current_user, get_db
from rampart.models import User
from rampart.schemas import TargetCreateIn, TargetOut, TargetUpdateIn, target_out
from rampart.targets.service import TargetService

router = APIRouter(
    prefix="/api/targets",
    tags=["targets"],
    dependencies=[Depends(current_user), Depends(csrf_protect)],
)


@router.get("", response_model=list[TargetOut])
def list_targets(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[TargetOut]:
    return [target_out(view) for view in TargetService(db).list(user.id)]


@router.post("", response_model=TargetOut, status_code=status.HTTP_201_CREATED)
def register_target(
    body: TargetCreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> TargetOut:
    view = TargetService(db).register(
        user.id,
        name=body.name,
        base_url=body.base_url,
        input_surface=body.input_surface,
        profile=body.profile,
    )
    db.commit()
    return target_out(view)


@router.patch("/{target_id}", response_model=TargetOut)
def update_target(
    target_id: str,
    body: TargetUpdateIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> TargetOut:
    clear = "profile" in body.model_fields_set and body.profile is None
    view = TargetService(db).update(
        user.id, target_id, name=body.name, profile=body.profile, clear_profile=clear
    )
    db.commit()
    return target_out(view)


@router.delete("/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_target(
    target_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    TargetService(db).delete(user.id, target_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
