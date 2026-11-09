"""Domain errors raised by services and translated to HTTP responses by the app."""

from __future__ import annotations


class RampartError(Exception):
    status_code = 500

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class BadRequest(RampartError):
    status_code = 400


class Forbidden(RampartError):
    status_code = 403


class NotFound(RampartError):
    status_code = 404


class Conflict(RampartError):
    status_code = 409


class Invalid(RampartError):
    status_code = 422


class ServiceUnavailable(RampartError):
    status_code = 503
