"""Reading a Dependency File into package names and versions, without a Model.

Supported: ``requirements.txt``, ``uv.lock``, ``poetry.lock`` and ``package-lock.json`` (or
``npm-shrinkwrap.json``), which pin exact versions, and ``pyproject.toml`` and ``package.json``,
which usually give ranges: a package without one exact version is kept but marked unpinned,
because a vulnerability lookup needs a version. Only PyPI and npm are read; other ecosystems are
entered by hand. The file itself is never stored, only what is parsed from it.
"""

from __future__ import annotations

import json
import re
import tomllib
from dataclasses import dataclass, field
from typing import Any, Literal

from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import canonicalize_name

Format = Literal[
    "requirements.txt",
    "uv.lock",
    "poetry.lock",
    "package-lock.json",
    "pyproject.toml",
    "package.json",
]
FORMATS: tuple[Format, ...] = (
    "requirements.txt",
    "uv.lock",
    "poetry.lock",
    "package-lock.json",
    "pyproject.toml",
    "package.json",
)
MAX_NAME_CHARS = 214
MAX_VERSION_CHARS = 64
MAX_SKIPPED = 50

_EXACT_NPM = re.compile(r"^[=v]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$")
_NPM_NON_REGISTRY = ("file:", "link:", "workspace:", "git", "http:", "https:", "github:", "npm:")


class DependencyFileError(ValueError):
    """The file could not be read as the format it claims or appears to be."""


@dataclass(frozen=True)
class ParsedPackage:
    ecosystem: str  # "PyPI" or "npm"
    name: str
    version: str | None  # None when the file gives no single exact version

    @property
    def pinned(self) -> bool:
        return self.version is not None


@dataclass
class ParseResult:
    format: Format
    packages: list[ParsedPackage] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)  # lines or entries not read, with why

    def skip(self, what: str, why: str) -> None:
        if len(self.skipped) < MAX_SKIPPED:
            self.skipped.append(f"{what[:120]}: {why}")


def package_key(ecosystem: str, name: str) -> tuple[str, str]:
    """Two names for the same package compare equal (PyPI normalises names, npm is lowercase)."""
    if ecosystem == "PyPI":
        return ecosystem, canonicalize_name(name)
    if ecosystem == "npm":
        return ecosystem, name.lower()
    return ecosystem, name


def detect_format(filename: str | None, content: str) -> Format:
    base = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].lower()
    if base in ("uv.lock", "poetry.lock", "pyproject.toml", "package.json"):
        return base  # type: ignore[return-value]
    if base in ("package-lock.json", "npm-shrinkwrap.json"):
        return "package-lock.json"
    if base.endswith(".txt") or base.endswith(".in"):
        return "requirements.txt"
    text = content.lstrip()
    if text.startswith("{"):
        try:
            data = json.loads(content)
        except ValueError as exc:
            raise DependencyFileError("this looks like JSON but does not parse") from exc
        if isinstance(data, dict) and "lockfileVersion" in data:
            return "package-lock.json"
        return "package.json"
    if "[[package]]" in content:
        if re.search(r"^\[metadata\]", content, re.MULTILINE) or "python-versions" in content:
            return "poetry.lock"
        return "uv.lock"
    if re.search(r"^\[(?:project|tool\.poetry)\]", content, re.MULTILINE):
        return "pyproject.toml"
    return "requirements.txt"


def parse_dependency_file(
    content: str, *, filename: str | None = None, format: Format | None = None
) -> ParseResult:
    fmt = format or detect_format(filename, content)
    result = ParseResult(fmt)
    parser = {
        "requirements.txt": _requirements,
        "uv.lock": _uv_lock,
        "poetry.lock": _poetry_lock,
        "package-lock.json": _package_lock,
        "pyproject.toml": _pyproject,
        "package.json": _package_json,
    }[fmt]
    parser(content, result)
    seen: set[tuple[str, str, str | None]] = set()
    unique: list[ParsedPackage] = []
    for package in result.packages:
        key = (*package_key(package.ecosystem, package.name), package.version)
        if key not in seen:
            seen.add(key)
            unique.append(package)
    unique.sort(key=lambda p: (p.ecosystem, package_key(p.ecosystem, p.name)[1], p.version or ""))
    result.packages = unique
    return result


def _add(result: ParseResult, ecosystem: str, name: str, version: str | None) -> None:
    name = name.strip()
    version = version.strip() if version else None
    if not name or len(name) > MAX_NAME_CHARS:
        result.skip(name or "(no name)", "the name is empty or too long")
        return
    if version is not None and len(version) > MAX_VERSION_CHARS:
        result.skip(f"{name} {version}", "the version is too long to be a release version")
        return
    if ecosystem == "PyPI":
        name = canonicalize_name(name)
    result.packages.append(ParsedPackage(ecosystem, name, version or None))


# ---- Python ------------------------------------------------------------------------------------


def _exact_pep440(requirement: Requirement) -> str | None:
    specs = list(requirement.specifier)
    if len(specs) == 1 and specs[0].operator in ("==", "===") and "*" not in specs[0].version:
        return specs[0].version
    return None


def _requirement(result: ParseResult, text: str) -> None:
    try:
        requirement = Requirement(text)
    except InvalidRequirement:
        result.skip(text, "not a requirement this parser understands")
        return
    if requirement.url:
        result.skip(text, "installed from a URL or path, not from PyPI")
        return
    _add(result, "PyPI", requirement.name, _exact_pep440(requirement))


def _requirements(content: str, result: ParseResult) -> None:
    joined = re.sub(r"\\\r?\n", " ", content)  # continuation lines
    for raw in joined.splitlines():
        line = re.sub(r"(^|\s)#.*$", "", raw).strip()
        if not line:
            continue
        if line.startswith("-"):
            result.skip(line, "an option such as -r, -c, -e or --index-url")
            continue
        if line.startswith(("git+", "http:", "https:", "file:", "./", "../", "/")):
            result.skip(line, "installed from a URL or path, not from PyPI")
            continue
        line = re.split(r"\s+--", line, maxsplit=1)[0].strip()  # per-line options such as --hash
        _requirement(result, line)


def _toml(content: str) -> dict[str, Any]:
    try:
        return tomllib.loads(content)
    except tomllib.TOMLDecodeError as exc:
        raise DependencyFileError(f"the TOML does not parse: {exc}") from exc


def _uv_lock(content: str, result: ParseResult) -> None:
    for package in _toml(content).get("package") or []:
        if not isinstance(package, dict):
            continue
        name, version = str(package.get("name") or ""), package.get("version")
        source = package.get("source") or {}
        if isinstance(source, dict) and any(k in source for k in ("editable", "virtual")):
            continue  # the project itself or a workspace member
        if isinstance(source, dict) and any(k in source for k in ("path", "directory")):
            result.skip(name, "a local path, not a PyPI release")
            continue
        _add(result, "PyPI", name, str(version) if version else None)


def _poetry_lock(content: str, result: ParseResult) -> None:
    for package in _toml(content).get("package") or []:
        if not isinstance(package, dict):
            continue
        name, version = str(package.get("name") or ""), package.get("version")
        source = package.get("source") or {}
        if isinstance(source, dict) and source.get("type") in ("directory", "file"):
            result.skip(name, "a local path, not a PyPI release")
            continue
        _add(result, "PyPI", name, str(version) if version else None)


def _poetry_dependency(result: ParseResult, name: str, spec: Any) -> None:
    if name.lower() == "python":
        return
    version = spec.get("version") if isinstance(spec, dict) else spec
    if isinstance(spec, dict) and any(k in spec for k in ("path", "git", "url")):
        result.skip(name, "installed from a URL, Git or a path, not from PyPI")
        return
    text = str(version or "").strip()
    exact = text[2:].strip() if text.startswith("==") else text
    pinned = bool(re.fullmatch(r"\d+(?:\.\d+)*(?:[a-z]+\d*)?(?:\.post\d+)?(?:\.dev\d+)?", exact))
    _add(result, "PyPI", name, exact if pinned else None)


def _pyproject(content: str, result: ParseResult) -> None:
    data = _toml(content)
    project = data.get("project") or {}
    lists: list[Any] = [project.get("dependencies") or []]
    lists += list((project.get("optional-dependencies") or {}).values())
    lists += list((data.get("dependency-groups") or {}).values())
    for entries in lists:
        for entry in entries if isinstance(entries, list) else []:
            if isinstance(entry, str):
                _requirement(result, entry)
    poetry = (data.get("tool") or {}).get("poetry") or {}
    tables = [poetry.get("dependencies") or {}, poetry.get("dev-dependencies") or {}]
    tables += [
        (group or {}).get("dependencies") or {} for group in (poetry.get("group") or {}).values()
    ]
    for table in tables:
        for name, spec in table.items() if isinstance(table, dict) else []:
            _poetry_dependency(result, str(name), spec)


# ---- npm ---------------------------------------------------------------------------------------


def _json(content: str) -> dict[str, Any]:
    try:
        data = json.loads(content)
    except ValueError as exc:
        raise DependencyFileError(f"the JSON does not parse: {exc}") from exc
    if not isinstance(data, dict):
        raise DependencyFileError("the JSON is not an object")
    return data


def _npm_version(result: ParseResult, name: str, version: Any) -> None:
    text = str(version or "").strip()
    if text.startswith(_NPM_NON_REGISTRY) or "/" in text:
        result.skip(f"{name} {text}", "not from the npm registry")
        return
    match = _EXACT_NPM.match(text)
    _add(result, "npm", name, match.group(1) if match else None)


def _package_json(content: str, result: ParseResult) -> None:
    data = _json(content)
    for table in ("dependencies", "devDependencies", "optionalDependencies"):
        for name, version in (data.get(table) or {}).items():
            _npm_version(result, str(name), version)


def _package_lock(content: str, result: ParseResult) -> None:
    data = _json(content)
    packages = data.get("packages")
    if isinstance(packages, dict):  # lockfileVersion 2 and 3
        for path, entry in packages.items():
            if not path or not isinstance(entry, dict) or entry.get("link"):
                continue  # "" is the project itself; links point at workspace folders
            name = str(entry.get("name") or path.rsplit("node_modules/", 1)[-1])
            _npm_version(result, name, entry.get("version"))
        return

    def walk(dependencies: Any) -> None:  # lockfileVersion 1
        for name, entry in (dependencies or {}).items():
            if isinstance(entry, dict):
                _npm_version(result, str(name), entry.get("version"))
                walk(entry.get("dependencies"))

    walk(data.get("dependencies"))
