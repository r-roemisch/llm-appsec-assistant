"""Reading, saving and deleting the Project Profile, and the text block the model sees."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from rampart.db import utcnow
from rampart.errors import Invalid
from rampart.guards.secrets import redact
from rampart.models import ProjectProfile, Target

# OSV.dev ecosystem names, so that M3's vulnerability lookup can use the packages directly.
ECOSYSTEMS = (
    "PyPI",
    "npm",
    "Maven",
    "Go",
    "crates.io",
    "RubyGems",
    "NuGet",
    "Packagist",
    "Hex",
    "Pub",
    "CRAN",
    "Hackage",
    "SwiftURL",
)
MAX_STACK_CHARS = 2000
MAX_PACKAGES = 1000  # (M7) room for an imported lock file
PROMPT_PACKAGES = 30  # more than this, and the prompt gets counts instead of the list
MAX_TARGET_IDS = 20
MAX_NAME_CHARS = 214
MAX_VERSION_CHARS = 64
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


@dataclass(frozen=True)
class PackageRef:
    ecosystem: str
    name: str
    version: str | None


@dataclass(frozen=True)
class ProfileView:
    exists: bool
    stack: str = ""
    packages: list[PackageRef] = field(default_factory=list)
    target_ids: list[str] = field(default_factory=list)
    updated_at: datetime | None = None


def _clean_line(value: str) -> str:
    return " ".join(_CONTROL.sub("", value).split())


def validate(stack: str, packages: list[PackageRef]) -> tuple[str, list[PackageRef]]:
    # The profile is in every system prompt: pasted credentials never get there.
    clean_stack = redact(_CONTROL.sub("", stack.replace("\r\n", "\n")).strip()).text
    if len(clean_stack) > MAX_STACK_CHARS:
        raise Invalid(f"stack must be at most {MAX_STACK_CHARS} characters")
    if len(packages) > MAX_PACKAGES:
        raise Invalid(f"at most {MAX_PACKAGES} packages")
    clean: list[PackageRef] = []
    for index, package in enumerate(packages, start=1):
        if package.ecosystem not in ECOSYSTEMS:
            raise Invalid(f"package {index}: ecosystem must be one of {', '.join(ECOSYSTEMS)}")
        name = _clean_line(package.name)
        if not name or len(name) > MAX_NAME_CHARS:
            raise Invalid(f"package {index}: name must be 1 to {MAX_NAME_CHARS} characters")
        version = _clean_line(package.version or "") or None
        if version is not None and len(version) > MAX_VERSION_CHARS:
            raise Invalid(
                f"package {index}: version must be at most {MAX_VERSION_CHARS} characters"
            )
        clean.append(PackageRef(package.ecosystem, name, version))
    return clean_stack, clean


class ProfileService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, user_id: int) -> ProfileView:
        row = self.db.get(ProjectProfile, user_id)
        if row is None:
            return ProfileView(exists=False)
        packages = [
            PackageRef(str(p.get("ecosystem", "")), str(p.get("name", "")), p.get("version"))
            for p in row.packages or []
            if isinstance(p, dict)
        ]
        return ProfileView(
            exists=True,
            stack=row.stack,
            packages=packages,
            target_ids=list(row.target_ids or []),
            updated_at=row.updated_at,
        )

    def save(
        self,
        user_id: int,
        stack: str,
        packages: list[PackageRef],
        target_ids: list[str] | None = None,
    ) -> ProfileView:
        clean_stack, clean_packages = validate(stack, packages)
        clean_targets = self._validate_targets(user_id, target_ids)
        row = self.db.get(ProjectProfile, user_id)
        if row is None:
            row = ProjectProfile(user_id=user_id, target_ids=[])
            self.db.add(row)
        row.stack = clean_stack
        row.packages = [
            {"ecosystem": p.ecosystem, "name": p.name, "version": p.version} for p in clean_packages
        ]
        if target_ids is not None:
            row.target_ids = clean_targets
        row.updated_at = utcnow()
        self.db.flush()
        return self.get(user_id)

    def _validate_targets(self, user_id: int, target_ids: list[str] | None) -> list[str]:
        if not target_ids:
            return []
        if len(target_ids) > MAX_TARGET_IDS:
            raise Invalid(f"at most {MAX_TARGET_IDS} targets")
        owned = set(self.db.scalars(select(Target.id).where(Target.owner_user_id == user_id)))
        unknown = [tid for tid in target_ids if tid not in owned]
        if unknown:
            raise Invalid("target_ids must be your own registered Targets")
        return list(dict.fromkeys(target_ids))

    def import_packages(
        self, user_id: int, imported: list[PackageRef], *, replace: bool = False
    ) -> ProfileView:
        """Merge packages read from a Dependency File: a package already in the profile (same
        ecosystem and name) takes the imported version or versions, new ones are added, nothing
        else is removed. With ``replace`` the imported packages become the whole list."""
        from rampart.profile.dependency_files import package_key

        if len(imported) > MAX_PACKAGES:
            raise Invalid(
                f"the file lists {len(imported)} packages; a Project Profile holds at most "
                f"{MAX_PACKAGES}"
            )
        view = self.get(user_id)
        if replace:
            merged = list(imported)
        else:
            incoming = {package_key(p.ecosystem, p.name) for p in imported}
            kept = [p for p in view.packages if package_key(p.ecosystem, p.name) not in incoming]
            merged = kept + list(imported)
        if len(merged) > MAX_PACKAGES:
            raise Invalid(
                f"with this file the profile would hold {len(merged)} packages; it holds at most "
                f"{MAX_PACKAGES}. Import with 'replace all packages', or remove some first"
            )
        return self.save(user_id, view.stack, merged, None)

    def delete(self, user_id: int) -> None:
        row = self.db.get(ProjectProfile, user_id)
        if row is not None:
            self.db.delete(row)
            self.db.flush()


def profile_block(
    view: ProfileView, targets: list[tuple[str, str, str]] | None = None
) -> str | None:
    """The profile as the model sees it, or None when there is nothing to say.

    ``targets`` is the (name, id, base_url) of the user's registered loopback Targets, so the
    assistant can offer to test them and knows the id to pass to run_injection_test; the Gateway
    still enforces which Targets may be tested.
    """
    if not (view.stack or view.packages or targets):
        return None  # targets show even before a profile is saved
    lines: list[str] = []
    if view.stack:
        lines.append(f"Stack: {view.stack}")
    if len(view.packages) > PROMPT_PACKAGES:
        counts: dict[str, int] = {}
        for p in view.packages:
            counts[p.ecosystem] = counts.get(p.ecosystem, 0) + 1
        pinned = sum(1 for p in view.packages if p.version)
        per = ", ".join(f"{n} {eco}" for eco, n in sorted(counts.items()))
        lines.append(
            f"Packages: {len(view.packages)} ({per}); {pinned} with an exact version. The list is "
            "too long to show here: call check_dependencies to check them all for known "
            "vulnerabilities, or lookup_vulnerabilities for one package."
        )
    elif view.packages:
        lines.append("Packages:")
        lines += [
            f"- {p.ecosystem} {p.name}" + (f" {p.version}" if p.version else "")
            for p in view.packages
        ]
    if targets:
        lines.append(
            "Registered loopback test Targets (use the id as run_injection_test's target_id):"
        )
        lines += [f'- "{name}" id={tid} ({url})' for name, tid, url in targets]
    return "\n".join(lines)
