"""A size limit on request bodies, enforced before anything reads them.

FastAPI reads a JSON body into memory before it checks the session, so without a limit an
anonymous client could make the server hold any amount of data (POST /api/auth/login with a few
gigabytes). This ASGI wrapper refuses a body whose declared length is over the limit before a byte
of it is read, and stops a body sent without a declared length (chunked) as soon as it passes the
limit. Responses, including streamed ones, pass through untouched.
"""

from __future__ import annotations

import json
from collections.abc import Callable

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MIB = 1024 * 1024


def too_large(limit: int) -> str:
    return f"the request body is larger than the limit of {limit / MIB:g} MB for this address"


class BodyLimit:
    def __init__(self, app: ASGIApp, limit_for: Callable[[str], int]) -> None:
        self.app = app
        self.limit_for = limit_for  # request path -> largest body allowed, in bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.limit_for(scope["path"])
        declared = _declared_length(scope)
        if declared is not None and declared > limit:
            await _refuse(send, limit)
            return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # FastAPI and Starlette pass an HTTPException raised while the body is read
                    # through to the exception handler, which answers 413.
                    raise HTTPException(status_code=413, detail=too_large(limit))
            return message

        await self.app(scope, limited_receive, send)


def _declared_length(scope: Scope) -> int | None:
    for name, value in scope.get("headers") or []:
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None  # the server rejects a malformed length itself
    return None


async def _refuse(send: Send, limit: int) -> None:
    body = json.dumps({"detail": too_large(limit)}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),  # the unread body is not drained
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
