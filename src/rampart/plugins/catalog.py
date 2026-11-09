"""``plugins/catalog.yaml``: the only place that says which MCP servers exist and how to start them.

The admin UI can enable a Plugin, list its Tools and accept their definitions; it can never add a
Plugin or change a command, and nothing a Model reads can either. The file is re-read when it
changes on disk, so editing it on the server takes effect without a restart.

Two placeholders are expanded in ``command`` and ``args``: ``{python}`` (the interpreter running
Rampart) and ``{plugins_dir}`` (the folder holding the catalog's fixture servers). Nothing else is
interpolated.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from rampart.guards.secrets import redact

# Lower-case words joined by single underscores, 30 characters at most. No leading, trailing or
# double underscore, so the first "__" in "<plugin>__<tool>" always ends the Plugin id.
PLUGIN_ID = re.compile(r"^(?=.{1,30}$)[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
ALLOWED_KEYS = frozenset({"title", "description", "command", "args", "timeout_seconds"})
MAX_ARGS = 20
MAX_ARG_CHARS = 500


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    title: str
    description: str = ""
    command: str = ""
    args: tuple[str, ...] = ()
    timeout_seconds: float = 20.0
    error: str | None = None  # why the entry cannot be used; None when it is valid

    @property
    def usable(self) -> bool:
        return self.error is None

    def display_command(self) -> str:
        """The command line as an admin sees it (read-only), with secret-like strings redacted."""
        return redact(" ".join([self.command, *self.args]).strip()).text


@dataclass(frozen=True)
class PluginCatalog:
    path: Path
    entries: dict[str, CatalogEntry] = field(default_factory=dict)
    error: str | None = None  # the whole file could not be read


def _expand(value: str, plugins_dir: Path) -> str:
    return value.replace("{python}", sys.executable).replace("{plugins_dir}", str(plugins_dir))


def _entry(key: Any, raw: Any, plugins_dir: Path, default_timeout: float) -> CatalogEntry:
    plugin_id = str(key)
    if not PLUGIN_ID.fullmatch(plugin_id):
        return CatalogEntry(
            id=plugin_id[:40],
            title=plugin_id[:80],
            error="the id must be lower-case words joined by single underscores (30 at most)",
        )
    if not isinstance(raw, dict):
        return CatalogEntry(id=plugin_id, title=plugin_id, error="the entry must be a mapping")
    unknown = sorted(str(k) for k in raw if k not in ALLOWED_KEYS)
    raw_title, raw_description = raw.get("title"), raw.get("description")
    title = raw_title[:80] if isinstance(raw_title, str) and raw_title.strip() else plugin_id
    description = raw_description[:500] if isinstance(raw_description, str) else ""
    command, args = raw.get("command"), raw.get("args", [])
    timeout = raw.get("timeout_seconds", default_timeout)
    problem: str | None = None
    if unknown:
        problem = f"unknown keys: {', '.join(unknown)}"
    elif not isinstance(command, str) or not command.strip() or len(command) > MAX_ARG_CHARS:
        problem = "command must be a non-empty string"
    elif (
        not isinstance(args, list)
        or len(args) > MAX_ARGS
        or not all(isinstance(a, str) and len(a) <= MAX_ARG_CHARS for a in args)
    ):
        problem = f"args must be a list of at most {MAX_ARGS} strings"
    elif (
        isinstance(timeout, bool) or not isinstance(timeout, int | float) or not 1 <= timeout <= 120
    ):
        problem = "timeout_seconds must be a number from 1 to 120"
    if problem is not None:
        return CatalogEntry(id=plugin_id, title=title, description=description, error=problem)
    assert isinstance(command, str) and isinstance(args, list)
    return CatalogEntry(
        id=plugin_id,
        title=title,
        description=description,
        command=_expand(command.strip(), plugins_dir),
        args=tuple(_expand(a, plugins_dir) for a in args),
        timeout_seconds=float(timeout),
    )


def load_catalog(path: Path, plugins_dir: Path, default_timeout: float = 20.0) -> PluginCatalog:
    """Read and validate the catalog. A missing file is an empty catalog, not an error; a file
    that cannot be parsed is reported, and so is each invalid entry, without failing the rest."""
    if not path.is_file():
        return PluginCatalog(path=path)
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
        return PluginCatalog(
            path=path, error=f"the catalog file could not be read: {type(exc).__name__}"
        )
    plugins = data.get("plugins", {}) if isinstance(data, dict) else None
    if not isinstance(plugins, dict):
        return PluginCatalog(path=path, error="the catalog must have a 'plugins' mapping")
    entries = {}
    for key, raw in plugins.items():
        entry = _entry(key, raw, plugins_dir.resolve(), default_timeout)
        entries[entry.id] = entry
    return PluginCatalog(path=path, entries=entries)


class CatalogFile:
    """The catalog, re-read only when the file's modification time or size changes."""

    def __init__(self, path: Path, plugins_dir: Path, default_timeout: float) -> None:
        self.path = path
        self.plugins_dir = plugins_dir
        self.default_timeout = default_timeout
        self._stamp: tuple[int, int] | None = None
        self._catalog: PluginCatalog | None = None

    def get(self) -> PluginCatalog:
        try:
            stat = self.path.stat()
            stamp: tuple[int, int] | None = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            stamp = None
        if self._catalog is None or stamp != self._stamp:
            self._catalog = load_catalog(self.path, self.plugins_dir, self.default_timeout)
            self._stamp = stamp
        return self._catalog
