"""The caller's own Project Profile: read, save, delete."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from rampart.deps import csrf_protect, current_user, get_db
from rampart.models import User
from rampart.profile.service import PackageRef, ProfileService
from rampart.schemas import ProfileIn, ProfileOut, profile_out

router = APIRouter(
    prefix="/api/profile",
    tags=["profile"],
    dependencies=[Depends(current_user), Depends(csrf_protect)],
)


@router.get("", response_model=ProfileOut)
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)) -> ProfileOut:
    return profile_out(ProfileService(db).get(user.id))


@router.put("", response_model=ProfileOut)
def save_profile(
    body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> ProfileOut:
    packages = [PackageRef(p.ecosystem, p.name, p.version) for p in body.packages]
    view = ProfileService(db).save(user.id, body.stack, packages, body.target_ids)
    db.commit()
    return profile_out(view)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    ProfileService(db).delete(user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
