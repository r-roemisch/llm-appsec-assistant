"""Plugin Tool definitions: what a server lists, the digest an admin accepts, what changed since,
and the manifest a definition becomes in Rampart's registry.

A definition is every part of an MCP Tool that reaches the Model or decides how it is called:
name, title, description, input and output schema, annotations. The digest covers exactly that,
so any change to what the Model reads or may send is drift and blocks the Tool until accepted.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any

import mcp_types
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError

from rampart.guards.input_guard import scan_untrusted
from rampart.tools.registry import ToolManifest

TOOL_NAME = re.compile(r"^[A-Za-z0-9_-]{1,64}$")  # what OpenAI-style function calling accepts
MAX_TOOLS = 50
MAX_DESCRIPTION = 1024  # characters of a description the Model is offered
DEFINITION_FIELDS = ("name", "title", "description", "input_schema", "output_schema", "annotations")


def tool_definition(tool: mcp_types.Tool) -> dict[str, Any]:
    annotations = (
        tool.annotations.model_dump(mode="json", by_alias=True, exclude_none=True)
        if tool.annotations is not None
        else None
    )
    return {
        "name": tool.name,
        "title": tool.title,
        "description": tool.description or "",
        "input_schema": tool.input_schema,
        "output_schema": tool.output_schema,
        "annotations": annotations or None,
    }


def tools_digest(definitions: list[dict[str, Any]]) -> str:
    ordered = sorted(definitions, key=lambda d: str(d.get("name")))
    canonical = json.dumps(ordered, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def exposed_name(plugin_id: str, tool_name: str) -> str | None:
    """The name the Model and the Gateway use: ``<plugin_id>__<tool>``. Built-in names never
    contain ``__``, so a Plugin can never shadow a built-in Tool or another Plugin's Tool."""
    name = f"{plugin_id}__{tool_name}"
    return name if TOOL_NAME.fullmatch(tool_name) and len(name) <= 64 else None


def closed_schema(schema: Any) -> dict[str, Any] | None:
    """The input schema as the Gateway enforces it: an object that accepts declared properties
    only. None when it is not a valid JSON Schema object (the Tool then cannot be used)."""
    if not isinstance(schema, dict) or schema.get("type", "object") != "object":
        return None
    closed = copy.deepcopy(schema)
    closed["type"] = "object"
    closed.setdefault("properties", {})
    closed["additionalProperties"] = False
    try:
        Draft202012Validator.check_schema(closed)
    except SchemaError:
        return None
    return closed


# Directives to the Model about when or how to use Tools. An honest description says what a Tool
# does; one that tells the Model to call it first, for everything, instead of other Tools, or to
# keep something from the user is the classic shape of tool poisoning.
_TOOL_DIRECTIVES = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"\b(?:always|must|should always)\s+(?:call|use|invoke|run|choose|prefer)\b",
        r"\b(?:call|use|invoke|run)\s+(?:this|it|me)(?:\s+tool)?\s+(?:first|before|instead)\b",
        r"\b(?:for|on|with)\s+every\s+(?:question|request|message|prompt|task|turn|answer)\b",
        r"\bbefore\s+(?:answering|responding|replying|you\s+(?:answer|respond|reply))\b",
        r"\b(?:do\s+not|don't|never)\s+(?:tell|inform|mention|reveal|show|notify)\b[^.\n]{0,40}"
        r"\buser\b",
        r"\b(?:instead\s+of|rather\s+than)\s+(?:any|other|the|another)\b[^.\n]{0,30}\btools?\b",
    )
)


def _directive_sentence(text: str) -> str | None:
    """The sentence holding the first Tool-usage directive, or None. One warning per definition:
    a single poisoned sentence usually matches several patterns."""
    starts = [m.start() for p in _TOOL_DIRECTIVES if (m := p.search(text)) is not None]
    if not starts:
        return None
    at = min(starts)
    begin = max(text.rfind(". ", 0, at) + 2, text.rfind("\n\n", 0, at) + 2, 0)
    ends = [i for i in (text.find(".", at), text.find("\n\n", at)) if i != -1]
    end = min(ends) + 1 if ends else len(text)
    sentence = " ".join(text[begin:end].split())
    return sentence if len(sentence) <= 160 else sentence[:159] + "\u2026"


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []


def warnings_for(
    plugin_id: str, definition: dict[str, Any], builtin_names: frozenset[str]
) -> list[str]:
    """What an admin should look at before accepting a definition."""
    name = str(definition.get("name") or "")
    description = str(definition.get("description") or "")
    schema = definition.get("input_schema")
    exposed = exposed_name(plugin_id, name)
    found: list[str] = []
    if exposed is None:
        found.append(
            "the name cannot be offered to a Model (letters, digits, _ and - only, 64 characters "
            "with the Plugin id); this Tool will not be usable"
        )
    if closed_schema(schema) is None:
        found.append(
            "the input schema is not a valid JSON Schema object; this Tool will not be usable"
        )
    elif isinstance(schema, dict) and schema.get("additionalProperties") not in (None, False):
        # Only an explicit allowance: SDK-generated schemas simply leave the key out, and a
        # warning on every Tool would bury the ones that matter. Every schema is closed anyway.
        found.append(
            "the input schema explicitly accepts undeclared properties; Rampart passes declared "
            "ones only, which may limit this Tool"
        )
    if name in builtin_names:
        found.append(
            f"the name matches the built-in Tool {name}; it is offered as {exposed} and cannot "
            "replace the built-in"
        )
    if len(description) > MAX_DESCRIPTION:
        found.append(
            f"the description is long ({len(description)} characters); the Model is offered the "
            f"first {MAX_DESCRIPTION}"
        )
    # Tool poisoning hides in the description, the title or anywhere in the schema the Model reads.
    text = "\n".join([description, str(definition.get("title") or ""), *_strings(schema)])
    for category, snippet in scan_untrusted(text):
        found.append(f"instruction-like text ({category}): “{snippet}”")
    directive = _directive_sentence(text)
    if directive is not None:
        found.append(f"directs the Model how to use Tools: “{directive}”")
    return found


def manifest_for(
    plugin_id: str, definition: dict[str, Any], blocked: str | None
) -> ToolManifest | None:
    """An accepted definition under the registry's policy: off until an admin enables it, and
    every call needs the requester's Approval. None when the definition cannot be offered."""
    name = exposed_name(plugin_id, str(definition.get("name") or ""))
    schema = closed_schema(definition.get("input_schema"))
    if name is None or schema is None:
        return None
    text = str(definition.get("description") or definition.get("title") or definition["name"])
    return ToolManifest(
        name=name,
        description=f"(Plugin {plugin_id}) {text.strip()[:MAX_DESCRIPTION]}",
        json_schema=schema,
        requires_approval=True,
        approver="requester",
        cost_class="heavy",
        contributed_by=f"plugin:{plugin_id}",
        enabled=False,
        provenance="plugin",
        max_output_chars=8000,
        blocked=blocked,
    )


def changes(
    accepted: list[dict[str, Any]] | None, current: list[dict[str, Any]] | None
) -> dict[str, Any]:
    """What differs between the accepted definitions and the last listing."""
    before = {str(d.get("name")): d for d in accepted or []}
    after = {str(d.get("name")): d for d in current or []}
    changed = []
    for name in sorted(before.keys() & after.keys()):
        fields = [f for f in DEFINITION_FIELDS if before[name].get(f) != after[name].get(f)]
        if fields:
            changed.append({"name": name, "fields": fields})
    return {
        "added": sorted(after.keys() - before.keys()),
        "removed": sorted(before.keys() - after.keys()),
        "changed": changed,
    }
