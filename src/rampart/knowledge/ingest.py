"""`rampart ingest`: store the official Sources (or the offline fixtures), Rampart's primers and
guides, then embed every passage that has no vector for the current embedding Model."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from rampart.knowledge.service import DocumentInput, EmbedReport, KnowledgeService, UpsertResult
from rampart.knowledge.sources import (
    REMOTE_GROUPS,
    Fetcher,
    HttpFetcher,
    fixture_documents,
    local_documents,
)


@dataclass
class IngestSummary:
    stored: list[tuple[DocumentInput, UpsertResult]] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    embedding: EmbedReport | None = None


async def run_ingest(
    service: KnowledgeService,
    *,
    fixtures: bool,
    embed: bool = True,
    fetcher: Fetcher | None = None,
    echo: Callable[[str], None] = print,
) -> IngestSummary:
    summary = IngestSummary()
    docs = local_documents(service.settings.docs_dir)
    if fixtures:
        docs += fixture_documents(service.settings.fixtures_dir)
    else:
        fetcher = fetcher or HttpFetcher(service.settings.fetch_timeout_seconds)
        for group in REMOTE_GROUPS:
            echo(f"Fetching {group.name} ...")
            try:
                docs += await group.load(fetcher)
            except Exception as exc:  # one failed source must not stop the others
                message = f"{group.name}: {type(exc).__name__}: {exc}"[:400]
                summary.failures.append(message)
                echo(f"  failed: {message}")
    for doc in docs:
        result, _ = await service.store_document(doc, embed=False)
        summary.stored.append((doc, result))
        echo(f"  {result.status:<9} {doc.source_type:<8} {doc.title} ({result.passages} passages)")
    if embed:
        report = await service.embed_missing()
        summary.embedding = report
        if report.missing_before == 0:
            echo(f"Embeddings: every passage already has a vector for {report.model_id}")
        elif report.error and report.embedded == 0:
            echo(f"Embeddings skipped ({report.error}); search will be keyword-only (BM25)")
        else:
            cost = "unknown" if report.cost_usd is None else f"${report.cost_usd:.6f}"
            echo(
                f"Embeddings: {report.embedded} of {report.missing_before} passages embedded "
                f"with {report.model_id}, cost {cost}"
                + (f"; stopped early: {report.error}" if report.error else "")
            )
    else:
        echo("Embeddings skipped (--no-embed); search will be keyword-only until you ingest again")
    return summary
