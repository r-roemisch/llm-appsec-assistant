"""The caller's own Project Profile: read, save, delete."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from rampart.deps import csrf_protect, current_user, get_db
from rampart.errors import Invalid
from rampart.models import User
from rampart.profile.dependency_files import (
    DependencyFileError,
    ParseResult,
    parse_dependency_file,
)
from rampart.profile.service import PackageRef, ProfileService
from rampart.schemas import (
    DependencyFileIn,
    DependencyFileOut,
    DependencyImportIn,
    ParsedPackageOut,
    ProfileIn,
    ProfileOut,
)

router = APIRouter(
    prefix="/api/profile",
    tags=["profile"],
    dependencies=[Depends(current_user), Depends(csrf_protect)],
)


@router.get("", response_model=ProfileOut)
def get_profile(user: User = Depends(current_user), db: Session = Depends(get_db)) -> ProfileOut:
    return ProfileOut.model_validate(ProfileService(db).get(user.id))


@router.put("", response_model=ProfileOut)
def save_profile(
    body: ProfileIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> ProfileOut:
    packages = [PackageRef(p.ecosystem, p.name, p.version) for p in body.packages]
    view = ProfileService(db).save(user.id, body.stack, packages, body.target_ids)
    db.commit()
    return ProfileOut.model_validate(view)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(user: User = Depends(current_user), db: Session = Depends(get_db)) -> Response:
    ProfileService(db).delete(user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _parse(body: DependencyFileIn) -> ParseResult:
    try:
        return parse_dependency_file(body.content, filename=body.filename, format=body.format)
    except DependencyFileError as exc:
        raise Invalid(f"could not read the file: {exc}") from exc


@router.post("/dependency-file/preview", response_model=DependencyFileOut)
def preview_dependency_file(body: DependencyFileIn) -> DependencyFileOut:
    """(M7) What a Dependency File contains, for review before it is imported. Nothing is saved."""
    result = _parse(body)
    pinned = sum(1 for p in result.packages if p.pinned)
    return DependencyFileOut(
        format=result.format,
        packages=[ParsedPackageOut.model_validate(p) for p in result.packages],
        pinned=pinned,
        unpinned=len(result.packages) - pinned,
        skipped=result.skipped,
    )


@router.post("/dependency-file/import", response_model=ProfileOut)
def import_dependency_file(
    body: DependencyImportIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> ProfileOut:
    """(M7) Merge (or with ``replace``, set) the profile's packages from a Dependency File."""
    result = _parse(body)
    if not result.packages:
        raise Invalid("the file lists no PyPI or npm packages")
    packages = [PackageRef(p.ecosystem, p.name, p.version) for p in result.packages]
    view = ProfileService(db).import_packages(user.id, packages, replace=body.replace)
    db.commit()
    return ProfileOut.model_validate(view)
