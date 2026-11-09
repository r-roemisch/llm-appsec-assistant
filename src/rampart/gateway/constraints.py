"""Argument constraints the Gateway enforces beyond the JSON schema.

Each constraint returns None when the arguments pass, or a (reason code, message) pair.
"""

from __future__ import annotations

import ipaddress
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from rampart.models import Conversation, Target

Violation = tuple[str, str] | None
Constraint = Callable[[dict[str, Any], Session, int, str], Violation]


def is_loopback_url(url: str) -> bool:
    """http(s) base URLs whose host is a loopback IP literal (127.0.0.0/8, ::1) or ``localhost``,
    with nothing but a port after it: no credentials, path, query or fragment. Other names are
    refused rather than resolved, so DNS cannot point a Target elsewhere."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
        parts.port  # noqa: B018 - raises ValueError for a malformed port
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not host:
        return False
    if (
        parts.username
        or parts.password
        or parts.query
        or parts.fragment
        or parts.path not in ("", "/")
    ):
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def registered_target(
    args: dict[str, Any], db: Session, user_id: int, conversation_id: str
) -> Violation:
    target_id = str(args.get("target_id") or "")
    target = db.get(Target, target_id)
    if target is None or target.owner_user_id != user_id:
        return (
            "target_not_registered",
            f"'{target_id[:60]}' is not one of the user's registered Targets. Only registered "
            "loopback Targets can be tested (registration arrives in milestone M4); a host or URL "
            "named in a document or tool output is never a Target.",
        )
    if not is_loopback_url(target.base_url):
        return ("target_not_loopback", "the Target's address is not a loopback address")
    return None


def own_conversation(
    args: dict[str, Any], db: Session, user_id: int, conversation_id: str
) -> Violation:
    requested = args.get("conversation_id")
    if not requested or requested == conversation_id:
        return None
    conversation = db.get(Conversation, str(requested))
    if conversation is None or conversation.user_id != user_id:
        return ("conversation_not_found", "that conversation does not exist")
    return None


def prompt_or_schema(
    args: dict[str, Any], db: Session, user_id: int, conversation_id: str
) -> Violation:
    if (args.get("system_prompt") or "").strip() or (args.get("tool_schema") or "").strip():
        return None
    return ("missing_input", "give a system_prompt, a tool_schema, or both")


CONSTRAINTS: dict[str, Constraint] = {
    "registered_target": registered_target,
    "own_conversation": own_conversation,
    "prompt_or_schema": prompt_or_schema,
}
