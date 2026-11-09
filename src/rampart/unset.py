"""The sentinel for an argument that was not given in a partial update, where ``None`` means
"clear it": routers pass ``UNSET`` for every field the request body left out."""

from __future__ import annotations

from typing import Final


class Unset:
    """Only ``UNSET`` is ever made; test with ``isinstance(value, Unset)``."""

    __slots__ = ()

    def __repr__(self) -> str:
        return "UNSET"


UNSET: Final = Unset()
