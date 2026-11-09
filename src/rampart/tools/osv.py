"""`lookup_vulnerabilities`: known vulnerabilities of one package version from OSV.dev.

The request goes to one fixed URL with the package in the JSON body; nothing a user or a Model
writes can change the host. Answers are cached in SQLite for a few hours. When OSV.dev cannot be
reached the Tool returns a stale cached answer, marked as stale, or a clear error; it never
raises into the turn. OSV data is external (Provenance ``API``).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import httpx
from sqlalchemy.orm import Session, sessionmaker

from rampart import __version__
from rampart.db import session_scope, utcnow
from rampart.models import OsvCacheEntry

OSV_QUERY_URL = "https://api.osv.dev/v1/query"
MAX_VULNS = 20
SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MODERATE": 2, "MEDIUM": 2, "LOW": 3}


class OsvUnavailable(RuntimeError):
    pass


def _severity(vuln: dict[str, Any]) -> str | None:
    label = (vuln.get("database_specific") or {}).get("severity")
    if isinstance(label, str) and label:
        return label.upper()
    for entry in vuln.get("severity") or []:
        if isinstance(entry, dict) and entry.get("score"):
            return str(entry["score"])  # a CVSS vector when no label exists
    return None


def _fixed_versions(vuln: dict[str, Any], package: str) -> list[str]:
    fixed: list[str] = []
    for affected in vuln.get("affected") or []:
        name = ((affected.get("package") or {}).get("name") or "").lower()
        if name and name != package.lower():
            continue
        for rng in affected.get("ranges") or []:
            for event in rng.get("events") or []:
                if isinstance(event, dict) and event.get("fixed") and event["fixed"] not in fixed:
                    fixed.append(str(event["fixed"]))
    return fixed


def summarise(payload: dict[str, Any], package: str) -> list[dict[str, Any]]:
    vulns: list[dict[str, Any]] = []
    for vuln in payload.get("vulns") or []:
        if not isinstance(vuln, dict) or not vuln.get("id"):
            continue
        summary = vuln.get("summary") or (vuln.get("details") or "").split("\n")[0]
        vulns.append(
            {
                "id": str(vuln["id"]),
                "aliases": [str(a) for a in vuln.get("aliases") or []][:5],
                "summary": str(summary)[:240],
                "severity": _severity(vuln),
                "published": vuln.get("published"),
                "fixed_versions": _fixed_versions(vuln, package)[:5],
                "references": [
                    str(r.get("url"))
                    for r in vuln.get("references") or []
                    if isinstance(r, dict) and r.get("url")
                ][:3],
            }
        )
    vulns.sort(key=lambda v: (SEVERITY_RANK.get(str(v["severity"]), 4), v["id"]))
    return vulns


class OsvClient:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        *,
        ttl_hours: int,
        timeout: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.ttl = timedelta(hours=ttl_hours)
        self.timeout = timeout
        self.transport = transport  # tests replace it with a mock transport

    @staticmethod
    def cache_key(ecosystem: str, package: str, version: str | None) -> str:
        return f"{ecosystem}:{package}:{version or '*'}"

    async def _fetch(self, ecosystem: str, package: str, version: str | None) -> dict[str, Any]:
        body: dict[str, Any] = {"package": {"name": package, "ecosystem": ecosystem}}
        if version:
            body["version"] = version
        headers = {
            "User-Agent": f"rampart/{__version__} (+https://github.com/r-roemisch/llm-appsec-assistant)"
        }
        delay_attempts = 2
        last = "no response"
        async with httpx.AsyncClient(
            timeout=self.timeout, transport=self.transport, headers=headers
        ) as client:
            for attempt in range(delay_attempts):
                try:
                    response = await client.post(OSV_QUERY_URL, json=body)
                except httpx.HTTPError as exc:
                    last = f"{type(exc).__name__}: {exc}"
                    continue
                if response.status_code == 200:
                    try:
                        payload = response.json()
                    except ValueError as exc:
                        raise OsvUnavailable("OSV.dev returned something that is not JSON") from exc
                    return payload if isinstance(payload, dict) else {}
                last = f"status {response.status_code}"
                if response.status_code < 500 and response.status_code != 429:
                    break
                del attempt
        raise OsvUnavailable(f"OSV.dev could not be reached ({last})")

    async def lookup(self, ecosystem: str, package: str, version: str | None) -> dict[str, Any]:
        key = self.cache_key(ecosystem, package, version)
        with session_scope(self.session_factory) as db:
            cached = db.get(OsvCacheEntry, key)
            entry = (dict(cached.payload), cached.fetched_at) if cached is not None else None
        now = utcnow()
        if entry is not None and now - entry[1] < self.ttl:
            return {
                **entry[0],
                "cached": True,
                "stale": False,
                "fetched_at": entry[1].isoformat() + "Z",
            }
        try:
            payload = await self._fetch(ecosystem, package, version)
        except OsvUnavailable:
            if entry is not None:  # better an old answer, clearly marked, than none
                return {
                    **entry[0],
                    "cached": True,
                    "stale": True,
                    "fetched_at": entry[1].isoformat() + "Z",
                }
            raise
        result = {
            "ecosystem": ecosystem,
            "package": package,
            "version": version,
            "vulnerabilities": summarise(payload, package)[:MAX_VULNS],
            "total": len(payload.get("vulns") or []),
            "source": "OSV.dev",
        }
        with session_scope(self.session_factory) as db:
            row = db.get(OsvCacheEntry, key)
            if row is None:
                db.add(OsvCacheEntry(key=key, payload=result, fetched_at=now))
            else:
                row.payload, row.fetched_at = result, now
        return {**result, "cached": False, "stale": False, "fetched_at": now.isoformat() + "Z"}
