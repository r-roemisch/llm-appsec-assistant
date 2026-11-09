"""Token and cost totals: the caller's own, and everyone's for admins."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from rampart.deps import current_user, get_db, require_admin
from rampart.models import User
from rampart.schemas import AdminUsageOut, UsageOut
from rampart.usage.service import UsageService

router = APIRouter(tags=["usage"])


@router.get("/api/usage/me", response_model=UsageOut)
def my_usage(user: User = Depends(current_user), db: Session = Depends(get_db)) -> UsageOut:
    return UsageOut.model_validate(UsageService(db).for_user(user.id))


@router.get("/api/admin/usage", response_model=AdminUsageOut)
def everyone_usage(
    _admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> AdminUsageOut:
    return AdminUsageOut.model_validate(UsageService(db).for_everyone())
