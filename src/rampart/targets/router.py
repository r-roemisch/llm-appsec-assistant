"""The caller's own Targets: register (loopback only), list, update, delete."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from rampart.deps import csrf_protect, current_user, get_db
from rampart.models import User
from rampart.schemas import TargetCreateIn, TargetOut, TargetUpdateIn
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
    return [TargetOut.model_validate(t) for t in TargetService(db).list(user.id)]


@router.post("", response_model=TargetOut, status_code=status.HTTP_201_CREATED)
def register_target(
    body: TargetCreateIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> TargetOut:
    target = TargetService(db).register(
        user.id,
        name=body.name,
        base_url=body.base_url,
        input_surface=body.input_surface,
        profile=body.profile,
    )
    db.commit()
    return TargetOut.model_validate(target)


@router.patch("/{target_id}", response_model=TargetOut)
def update_target(
    target_id: str,
    body: TargetUpdateIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> TargetOut:
    clear = "profile" in body.model_fields_set and body.profile is None
    target = TargetService(db).update(
        user.id, target_id, name=body.name, profile=body.profile, clear_profile=clear
    )
    db.commit()
    return TargetOut.model_validate(target)


@router.delete("/{target_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_target(
    target_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> Response:
    TargetService(db).delete(user.id, target_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
