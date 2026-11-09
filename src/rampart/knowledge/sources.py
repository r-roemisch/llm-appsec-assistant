"""The Sources `rampart ingest` loads: official documents fetched from fixed, pinned
locations, Rampart's own primers and guides, and synthetic fixtures for offline use.

The fetch locations are constants: nothing at runtime (no user, model or document) can add
a URL. OWASP and MITRE ATLAS are pinned to a commit so that an ingest is reproducible; the
NIST publications are fixed documents. Each Source records its license.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

import httpx
import yaml

from rampart import __version__
from rampart.knowledge.chunking import Chunk, chunk_markdown, chunk_pages
from rampart.knowledge.parsers import pdf_pages
from rampart.knowledge.service import DocumentInput

USER_AGENT = f"rampart-ingest/{__version__} (+https://github.com/r-roemisch/llm-appsec-assistant)"
ALLOWED_HOSTS = frozenset({"raw.githubusercontent.com", "nvlpubs.nist.gov"})
MAX_FETCH_BYTES = 30 * 1024 * 1024
PRIMERS_DIR = Path(__file__).parent / "primers"

# --- OWASP Top 10 for LLM Applications 2025 -------------------------------------------

OWASP_REPO = "OWASP/www-project-top-10-for-large-language-model-applications"
OWASP_COMMIT = "eb87ba80e0698de911dcdb8af60830e97723e3fc"  # latest change to 2_0_vulns, 2025-11-18
OWASP_ENTRIES = (
    "LLM01_PromptInjection.md",
    "LLM02_SensitiveInformationDisclosure.md",
    "LLM03_SupplyChain.md",
    "LLM04_DataModelPoisoning.md",
    "LLM05_ImproperOutputHandling.md",
    "LLM06_ExcessiveAgency.md",
    "LLM07_SystemPromptLeakage.md",
    "LLM08_VectorAndEmbeddingWeaknesses.md",
    "LLM09_Misinformation.md",
    "LLM10_UnboundedConsumption.md",
)
OWASP_LICENSE = (
    "OWASP Top 10 for LLM Applications 2025, © OWASP Foundation, licensed under CC BY-SA 4.0 "
    "(https://creativecommons.org/licenses/by-sa/4.0/). Fetched unchanged from the project's "
    f"repository at commit {OWASP_COMMIT[:7]} and split into passages for retrieval."
)

# --- MITRE ATLAS ----------------------------------------------------------------------

ATLAS_RELEASE = "v2026.10"
ATLAS_COMMIT = "f56c1468731d6428e5bf875263b4643b46d67437"  # tag v2026.10 (ATLAS 5.6.0)
ATLAS_RAW_URL = (
    f"https://raw.githubusercontent.com/mitre-atlas/atlas-data/{ATLAS_COMMIT}/dist/ATLAS.yaml"
)
ATLAS_PAGE_URL = f"https://github.com/mitre-atlas/atlas-data/blob/{ATLAS_COMMIT}/dist/ATLAS.yaml"
ATLAS_SITE = "https://atlas.mitre.org"
ATLAS_LICENSE = (
    "MITRE ATLAS data © 2021-2026 The MITRE Corporation, licensed under the Apache License 2.0 "
    f"(https://www.apache.org/licenses/LICENSE-2.0). Converted from ATLAS.yaml (release "
    f"{ATLAS_RELEASE}) to text for retrieval."
)

# --- NIST AI RMF ----------------------------------------------------------------------

NIST_DOCUMENTS = (
    (
        "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf",
        "https://doi.org/10.6028/NIST.AI.100-1",
        "NIST AI 100-1: AI Risk Management Framework (AI RMF 1.0)",
    ),
    (
        "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf",
        "https://doi.org/10.6028/NIST.AI.600-1",
        "NIST AI 600-1: AI RMF Generative Artificial Intelligence Profile",
    ),
)
NIST_LICENSE = (
    "A publication of the U.S. National Institute of Standards and Technology; works of the "
    "U.S. Government are not subject to copyright protection in the United States "
    "(17 U.S.C. 105). Text extracted from the PDF for retrieval."
)

PRIMER_LICENSE = "Written for Rampart; MIT License (see LICENSE in the repository)."
APP_DOCS_LICENSE = "Rampart documentation; MIT License (see LICENSE in the repository)."
FIXTURE_LICENSE = "Synthetic fixture written for Rampart's offline tests and demo; MIT License."
APP_DOCS = (("user_guide.md", "everyone"), ("admin_guide.md", "admin"))

_H1 = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
_FIRST_HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.MULTILINE)
_ATLAS_LINK = re.compile(
    r"\[([^\]]+)\]\(/(?:techniques|tactics|mitigations|studies)/([A-Za-z0-9.]+)\)"
)
_ANY_LINK = re.compile(r"\[([^\]]+)\]\((?:https?://)[^)\s]+\)")


class Fetcher(Protocol):
    async def fetch(self, url: str) -> bytes: ...


class HttpFetcher:
    """GET with an honest user agent, a size cap, and an allowlist of hosts (redirects too)."""

    def __init__(self, timeout: float = 60.0) -> None:
        self.timeout = timeout

    async def fetch(self, url: str) -> bytes:
        _check_host(url)
        async with (
            httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                max_redirects=3,
                headers={"User-Agent": USER_AGENT},
            ) as client,
            client.stream("GET", url) as response,
        ):
            _check_host(str(response.url))
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > MAX_FETCH_BYTES:
                    raise ValueError(f"{url} is larger than {MAX_FETCH_BYTES} bytes")
            return bytes(data)


def _check_host(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"refusing to fetch {url}: not an allowed https host")


def _strip_title(chunks: list[Chunk], title: str) -> list[Chunk]:
    """Drop the document title from the front of heading paths (the Source title says it)."""
    out: list[Chunk] = []
    for chunk in chunks:
        heading = chunk.heading
        if heading == title:
            heading = None
        elif heading and heading.startswith(f"{title} > "):
            heading = heading[len(title) + 3 :]
        out.append(Chunk(heading=heading, text=chunk.text, token_count=chunk.token_count))
    return out


# --- converters -------------------------------------------------------------------------


def owasp_document(entry: str, markdown: str) -> DocumentInput:
    match = _FIRST_HEADING.search(markdown)
    heading = match.group(1).strip() if match else entry.removesuffix(".md")
    chunks = chunk_markdown(markdown, split_level=3, skip_headings={"Reference Links"})
    return DocumentInput(
        source_type="curated",
        origin=f"https://github.com/{OWASP_REPO}/blob/{OWASP_COMMIT}/2_0_vulns/{entry}",
        title=f"OWASP {heading}",
        license_note=OWASP_LICENSE,
        chunks=_strip_title(chunks, heading),
    )


def _atlas_text(text: Any) -> str:
    value = str(text or "").strip()
    value = _ATLAS_LINK.sub(r"\1 (\2)", value)
    return _ANY_LINK.sub(r"\1", value)


def _names(items: list[dict[str, Any]]) -> dict[str, str]:
    return {str(item["id"]): str(item.get("name", "")) for item in items if "id" in item}


def atlas_documents(data: bytes) -> list[DocumentInput]:
    """Techniques, mitigations and case studies from ATLAS.yaml as three Sources."""
    root = yaml.safe_load(data)
    matrix = (root.get("matrices") or [{}])[0]
    tactics = _names(matrix.get("tactics") or [])
    techniques: list[dict[str, Any]] = matrix.get("techniques") or []
    mitigations: list[dict[str, Any]] = matrix.get("mitigations") or []
    technique_names = _names(techniques)
    by_technique: dict[str, list[str]] = {}
    for mitigation in mitigations:
        for use in mitigation.get("techniques") or []:
            tid = str(use.get("id", "")) if isinstance(use, dict) else str(use)
            by_technique.setdefault(tid, []).append(
                f"{mitigation['id']} {mitigation.get('name', '')}"
            )

    def label(tid: str) -> str:
        return f"{tid} {technique_names.get(tid, '')}".strip()

    parts: list[str] = []
    for technique in techniques:
        tid = str(technique["id"])
        # The description comes first so that snippets and vectors centre on it.
        lines = [
            f"## {tid}: {technique.get('name', '')}",
            _atlas_text(technique.get("description")),
        ]
        facts: list[str] = []
        parent = technique.get("specializes")
        if parent:
            facts.append(f"Sub-technique of {label(str(parent))}.")
        own_tactics = technique.get("tactics") or []
        if own_tactics:
            facts.append(
                "Tactics: " + ", ".join(f"{tactics.get(t, t)} ({t})" for t in own_tactics) + "."
            )
        facts.append(f"Maturity: {technique.get('maturity', 'unknown')}.")
        if by_technique.get(tid):
            facts.append("Mitigations: " + "; ".join(by_technique[tid]) + ".")
        facts.append(f"URL: {ATLAS_SITE}/techniques/{tid}")
        lines += ["", " ".join(facts)]
        parts.append("\n".join(lines))
    technique_doc = DocumentInput(
        source_type="curated",
        origin=f"{ATLAS_PAGE_URL}#techniques",
        title="MITRE ATLAS techniques",
        license_note=ATLAS_LICENSE,
        chunks=chunk_markdown("\n\n".join(parts), split_level=2),
    )

    parts = []
    for mitigation in mitigations:
        mid = str(mitigation["id"])
        lines = [
            f"## {mid}: {mitigation.get('name', '')}",
            _atlas_text(mitigation.get("description")),
        ]
        category = ", ".join(map(str, mitigation.get("category") or []))
        lifecycle = ", ".join(map(str, mitigation.get("ml-lifecycle") or []))
        meta = [
            f"Category: {category}." if category else "",
            f"Lifecycle: {lifecycle}." if lifecycle else "",
        ]
        lines += ["", " ".join(m for m in meta if m) + f" URL: {ATLAS_SITE}/mitigations/{mid}"]
        uses = [u for u in mitigation.get("techniques") or [] if isinstance(u, dict)]
        if uses:
            lines += ["", "How it addresses techniques:"]
            lines += [f"- {label(str(u.get('id')))}: {_atlas_text(u.get('use'))}" for u in uses]
        parts.append("\n".join(lines))
    mitigation_doc = DocumentInput(
        source_type="curated",
        origin=f"{ATLAS_PAGE_URL}#mitigations",
        title="MITRE ATLAS mitigations",
        license_note=ATLAS_LICENSE,
        chunks=chunk_markdown("\n\n".join(parts), split_level=2),
    )

    parts = []
    for study in root.get("case-studies") or []:
        sid = str(study["id"])
        lines = [f"## {sid}: {study.get('name', '')}", _atlas_text(study.get("summary"))]
        facts = [
            f"Type: {study.get('case-study-type')}." if study.get("case-study-type") else "",
            f"Incident date: {study.get('incident-date')}." if study.get("incident-date") else "",
            f"Target: {study.get('target')}." if study.get("target") else "",
            f"Actor: {study.get('actor')}." if study.get("actor") else "",
        ]
        lines += ["", " ".join(f for f in facts if f) + f" URL: {ATLAS_SITE}/studies/{sid}"]
        steps = study.get("procedure") or []
        if steps:
            lines += ["", "Procedure:"]
            for number, step in enumerate(steps, start=1):
                tactic = tactics.get(str(step.get("tactic")), str(step.get("tactic", "")))
                technique = label(str(step.get("technique", "")))
                lines.append(
                    f"{number}. {tactic}, {technique}: {_atlas_text(step.get('description'))}"
                )
        parts.append("\n".join(lines))
    study_doc = DocumentInput(
        source_type="curated",
        origin=f"{ATLAS_PAGE_URL}#case-studies",
        title="MITRE ATLAS case studies",
        license_note=ATLAS_LICENSE,
        chunks=chunk_markdown("\n\n".join(parts), split_level=2),
    )
    return [technique_doc, mitigation_doc, study_doc]


def nist_document(data: bytes, origin: str, title: str) -> DocumentInput:
    return DocumentInput(
        source_type="curated",
        origin=origin,
        title=title,
        license_note=NIST_LICENSE,
        chunks=chunk_pages(pdf_pages(data, max_pages=400)),
    )


def markdown_document(
    path: Path,
    *,
    source_type: str,
    origin: str,
    license_note: str,
    synthetic: bool = False,
) -> DocumentInput:
    text = path.read_text(encoding="utf-8")
    match = _H1.search(text)
    title = match.group(1).strip() if match else path.stem.replace("_", " ")
    return DocumentInput(
        source_type=source_type,
        origin=origin,
        title=title,
        license_note=license_note,
        chunks=_strip_title(chunk_markdown(text, split_level=3), title),
        synthetic=synthetic,
    )


def local_documents(docs_dir: Path) -> list[DocumentInput]:
    """Rampart's primers (curated) and its user and admin guides (app_docs)."""
    docs = [
        markdown_document(
            path,
            source_type="curated",
            origin=f"rampart:primers/{path.name}",
            license_note=PRIMER_LICENSE,
        )
        for path in sorted(PRIMERS_DIR.glob("*.md"))
    ]
    for name, _audience in APP_DOCS:
        path = docs_dir / name
        if path.is_file():
            docs.append(
                markdown_document(
                    path,
                    source_type="app_docs",
                    origin=f"docs/{name}",
                    license_note=APP_DOCS_LICENSE,
                )
            )
    return docs


def fixture_documents(fixtures_dir: Path) -> list[DocumentInput]:
    return [
        markdown_document(
            path,
            source_type="curated",
            origin=f"fixtures/sources/{path.name}",
            license_note=FIXTURE_LICENSE,
            synthetic=True,
        )
        for path in sorted((fixtures_dir / "sources").glob("*.md"))
    ]


@dataclass(frozen=True)
class RemoteGroup:
    name: str
    load: Callable[[Fetcher], Any]  # async callable returning list[DocumentInput]


async def _owasp(fetcher: Fetcher) -> list[DocumentInput]:
    docs = []
    for entry in OWASP_ENTRIES:
        url = f"https://raw.githubusercontent.com/{OWASP_REPO}/{OWASP_COMMIT}/2_0_vulns/{entry}"
        docs.append(owasp_document(entry, (await fetcher.fetch(url)).decode("utf-8")))
    return docs


async def _atlas(fetcher: Fetcher) -> list[DocumentInput]:
    return atlas_documents(await fetcher.fetch(ATLAS_RAW_URL))


async def _nist(fetcher: Fetcher) -> list[DocumentInput]:
    return [
        nist_document(await fetcher.fetch(url), origin, title)
        for url, origin, title in NIST_DOCUMENTS
    ]


REMOTE_GROUPS = (
    RemoteGroup("OWASP Top 10 for LLM Applications 2025", _owasp),
    RemoteGroup(f"MITRE ATLAS ({ATLAS_RELEASE})", _atlas),
    RemoteGroup("NIST AI RMF", _nist),
)
