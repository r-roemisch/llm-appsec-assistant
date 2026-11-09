"""The Knowledge Base service: status, Source listing, uploads, deletion, embedding, and the
per-turn search handle the chat graph uses."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Protocol

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, sessionmaker

from rampart.catalog.catalog import Catalog, ModelSpec
from rampart.catalog.providers import ProviderProbe, model_available
from rampart.catalog.service import CatalogService
from rampart.config import Settings
from rampart.db import session_scope, utcnow
from rampart.errors import Conflict, Forbidden, Invalid, NotFound, ServiceUnavailable
from rampart.guards.secrets import redact
from rampart.knowledge.chunking import Chunk
from rampart.knowledge.embeddings import Embedder, EmbedderFactory
from rampart.knowledge.parsers import UPLOAD_TYPES, parse_upload
from rampart.knowledge.retrieval import (
    SOURCE_TYPES,
    PassageRecord,
    Retriever,
    SearchResult,
    bump_version,
    index_text,
    load_passages,
    visible_to,
)
from rampart.knowledge.text import sha256_bytes, sha256_text
from rampart.knowledge.vectors import SHARED_OWNER, VectorStore
from rampart.models import Passage, Source

EMBED_BATCH = 64


@dataclass(frozen=True)
class DocumentInput:
    """A document ready to store: its identity, license, and Passages."""

    source_type: str
    origin: str
    title: str
    license_note: str | None
    chunks: list[Chunk]
    provenance: str = "source"
    owner_user_id: int | None = None
    synthetic: bool = False
    size_bytes: int | None = None
    digest: str | None = None


@dataclass(frozen=True)
class SourceView:
    id: str
    source_type: str
    title: str
    origin: str
    license_note: str | None
    mine: bool
    synthetic: bool
    fetched_at: datetime
    passage_count: int
    embedded_count: int
    size_bytes: int | None


@dataclass(frozen=True)
class KnowledgeStatus:
    retrieval_mode: str
    reason: str | None
    embedding_model_id: str
    embedding_available: bool
    sources: int
    passages: int
    embedded_passages: int
    uploads: int
    max_uploads: int
    max_upload_bytes: int
    upload_types: list[str]


@dataclass(frozen=True)
class UpsertResult:
    source_id: str
    status: str  # "new", "updated" or "unchanged"
    passages: int


@dataclass(frozen=True)
class EmbedReport:
    model_id: str | None
    embedded: int
    missing_before: int
    input_tokens: int | None
    cost_usd: float | None
    error: str | None = None


class EmbeddingUsageSink(Protocol):
    def record_embedding(
        self, spec: ModelSpec, input_tokens: int | None, cost_usd: float | None
    ) -> None: ...


class KnowledgeTurn:
    """What one chat turn may search: the caller's visible passages of some Source types."""

    def __init__(
        self,
        *,
        retriever: Retriever,
        user_id: int,
        source_types: Sequence[str],
        k: int,
        embedder: Embedder | None,
        usage: EmbeddingUsageSink | None,
    ) -> None:
        self.retriever = retriever
        self.user_id = user_id
        self.source_types = tuple(source_types)
        self.k = k
        self.embedder = embedder
        self.usage = usage
        self._seen: dict[str, PassageRecord] = {}

    async def search(self, query: str, source_types: Sequence[str] | None = None) -> SearchResult:
        types = (
            self.source_types
            if source_types is None
            else tuple(t for t in source_types if t in self.source_types)
        )
        result = await self.retriever.search(
            user_id=self.user_id,
            query=query,
            source_types=types,
            k=self.k,
            embedder=self.embedder,
        )
        if result.embedding is not None and self.embedder is not None and self.usage is not None:
            self.usage.record_embedding(
                self.embedder.spec, result.embedding.input_tokens, result.embedding.cost_usd
            )
        for passage in result.passages:
            self._seen[passage.id] = passage
        return result

    def passages(self, ids: Iterable[str]) -> list[PassageRecord]:
        """Passages by id in the given order, re-checked for visibility when not cached."""
        wanted = list(dict.fromkeys(ids))
        missing = [pid for pid in wanted if pid not in self._seen]
        if missing:
            self._seen.update(self.retriever.get(self.user_id, missing))
        return [self._seen[pid] for pid in wanted if pid in self._seen]


class KnowledgeService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        catalog: Catalog,
        probe: ProviderProbe,
        settings: Settings,
        embedder_factory: EmbedderFactory,
        vector_store_factory: Callable[[], VectorStore],
    ) -> None:
        self.session_factory = session_factory
        self.catalog = catalog
        self.probe = probe
        self.settings = settings
        self.embedder_factory = embedder_factory
        self._vector_store_factory = vector_store_factory
        self._vector_store: VectorStore | None = None
        self.retriever = Retriever(session_factory, self.vector_store)

    # --- components -------------------------------------------------------------------

    def vector_store(self) -> VectorStore:
        if self._vector_store is None:
            self._vector_store = self._vector_store_factory()
        return self._vector_store

    def _vectors_may_exist(self) -> bool:
        return self._vector_store is not None or self.settings.chroma_dir.exists()

    def embedding_spec(self, db: Session) -> ModelSpec:
        return CatalogService(db, self.catalog, self.probe).slot_config("embedding").model

    def embedder(self, db: Session) -> tuple[Embedder | None, str | None]:
        """The embedding Slot's embedder, or None and the reason search is keyword-only."""
        spec = self.embedding_spec(db)
        if not model_available(spec.provider, spec.provider_model_name, self.probe):
            if spec.provider == "ollama":
                return (
                    None,
                    f"{spec.display_name} is not available in Ollama (not pulled or offline)",
                )
            return None, f"{spec.display_name} is not available (OpenRouter is not configured)"
        try:
            return self.embedder_factory.build(spec), None
        except ServiceUnavailable as exc:
            return None, exc.detail

    # --- reading ------------------------------------------------------------------------

    def _counts(
        self, db: Session, user_id: int, model_id: str, types: Sequence[str]
    ) -> tuple[int, int]:
        embedded = case((Passage.embedding_ref == model_id, 1), else_=0)
        row = db.execute(
            select(func.count(Passage.id), func.coalesce(func.sum(embedded), 0))
            .join(Source, Source.id == Passage.source_id)
            .where(visible_to(user_id), Source.source_type.in_(list(types)))
        ).one()
        return int(row[0] or 0), int(row[1] or 0)

    def status(self, db: Session, user_id: int) -> KnowledgeStatus:
        spec = self.embedding_spec(db)
        embedder, reason = self.embedder(db)
        passages, embedded = self._counts(db, user_id, spec.id, SOURCE_TYPES)
        sources = db.scalar(select(func.count(Source.id)).where(visible_to(user_id))) or 0
        uploads = self.upload_count(db, user_id)
        mode = "hybrid"
        if embedder is None:
            mode = "bm25"
        elif passages == 0:
            mode, reason = "bm25", "the Knowledge Base is empty: run `rampart ingest`"
        elif embedded == 0:
            mode = "bm25"
            reason = f"no passage has a vector for {spec.id} yet: run `rampart ingest`"
        if mode == "hybrid" and embedded < passages:
            reason = (
                f"{passages - embedded} of {passages} passages have no vector for {spec.id} "
                "and are found by keyword search only: run `rampart ingest`"
            )
        return KnowledgeStatus(
            retrieval_mode=mode,
            reason=reason if mode == "bm25" or embedded < passages else None,
            embedding_model_id=spec.id,
            embedding_available=embedder is not None,
            sources=int(sources),
            passages=passages,
            embedded_passages=embedded,
            uploads=uploads,
            max_uploads=self.settings.max_uploads_per_user,
            max_upload_bytes=self.settings.max_upload_bytes,
            upload_types=list(UPLOAD_TYPES),
        )

    def upload_count(self, db: Session, user_id: int) -> int:
        return int(
            db.scalar(
                select(func.count(Source.id)).where(
                    Source.source_type == "upload", Source.owner_user_id == user_id
                )
            )
            or 0
        )

    def list_sources(self, db: Session, user_id: int) -> list[SourceView]:
        model_id = self.embedding_spec(db).id
        embedded = func.coalesce(func.sum(case((Passage.embedding_ref == model_id, 1), else_=0)), 0)
        rows = db.execute(
            select(Source, func.count(Passage.id), embedded)
            .outerjoin(Passage, Passage.source_id == Source.id)
            .where(visible_to(user_id))
            .group_by(Source.id)
        ).all()
        views = [
            SourceView(
                id=source.id,
                source_type=source.source_type,
                title=source.title,
                origin=source.origin,
                license_note=source.license_note,
                mine=source.owner_user_id == user_id,
                synthetic=source.synthetic,
                fetched_at=source.fetched_at,
                passage_count=int(count or 0),
                embedded_count=int(done or 0),
                size_bytes=source.size_bytes,
            )
            for source, count, done in rows
        ]
        type_order = {"upload": 0, "curated": 1, "app_docs": 2}
        uploads = sorted((v for v in views if v.mine), key=lambda v: v.fetched_at, reverse=True)
        shared = sorted(
            (v for v in views if not v.mine),
            key=lambda v: (type_order.get(v.source_type, 9), v.title.lower()),
        )
        return uploads + shared

    def get_passage(self, db: Session, user_id: int, passage_id: str) -> PassageRecord:
        found = load_passages(db, user_id, [passage_id]).get(passage_id)
        if found is None:
            raise NotFound("passage not found")
        return found

    def turn_search(
        self, db: Session, *, user_id: int, source_types: Sequence[str], usage: EmbeddingUsageSink
    ) -> KnowledgeTurn | None:
        """A search handle for one turn, or None when the caller can see nothing to search."""
        spec = self.embedding_spec(db)
        passages, embedded = self._counts(db, user_id, spec.id, source_types)
        if passages == 0:
            return None
        embedder, _reason = self.embedder(db)
        if embedded == 0:
            embedder = None  # vector search would find nothing; do not pay for the query vector
        return KnowledgeTurn(
            retriever=self.retriever,
            user_id=user_id,
            source_types=source_types,
            k=self.settings.retrieval_k,
            embedder=embedder,
            usage=usage,
        )

    # --- writing ------------------------------------------------------------------------

    async def store_document(
        self, doc: DocumentInput, *, embed: bool = True, replace: bool = True
    ) -> tuple[UpsertResult, EmbedReport | None]:
        """Store a document as a Source with Passages.

        With ``replace`` (ingested Sources), a Source with the same type, origin and owner is
        updated in place when its content changed and left alone when it did not. Without it
        (uploads), a new Source is always created.
        """
        digest = doc.digest or sha256_text(
            [doc.title, *(f"{c.heading or ''}\n{c.text}" for c in doc.chunks)]
        )
        stale_ids: list[str] = []
        with session_scope(self.session_factory) as db:
            source = None
            if replace:
                owner = (
                    Source.owner_user_id.is_(None)
                    if doc.owner_user_id is None
                    else Source.owner_user_id == doc.owner_user_id
                )
                source = db.scalar(
                    select(Source).where(
                        Source.source_type == doc.source_type, Source.origin == doc.origin, owner
                    )
                )
            if source is not None and source.digest == digest:
                result = UpsertResult(source.id, "unchanged", len(source.passages))
                if source.title != doc.title or source.license_note != doc.license_note:
                    source.title, source.license_note = doc.title, doc.license_note
            else:
                status = "new"
                if source is None:
                    source = Source(
                        source_type=doc.source_type,
                        owner_user_id=doc.owner_user_id,
                        origin=doc.origin,
                    )
                    db.add(source)
                else:
                    status = "updated"
                    stale_ids = [p.id for p in source.passages]
                    for passage in list(source.passages):
                        db.delete(passage)
                source.title = doc.title[:300]
                source.license_note = doc.license_note
                source.synthetic = doc.synthetic
                source.digest = digest
                source.size_bytes = doc.size_bytes
                source.fetched_at = utcnow()
                source.status = "ready"
                db.flush()
                for ordinal, chunk in enumerate(doc.chunks):
                    db.add(
                        Passage(
                            source_id=source.id,
                            ordinal=ordinal,
                            heading=chunk.heading[:500] if chunk.heading else None,
                            text=chunk.text,
                            token_count=chunk.token_count,
                            provenance=doc.provenance,
                        )
                    )
                bump_version(db)
                result = UpsertResult(source.id, status, len(doc.chunks))
        if stale_ids and self._vectors_may_exist():
            await asyncio.to_thread(self.vector_store().delete, stale_ids)
        report = await self.embed_missing([result.source_id]) if embed else None
        return result, report

    async def embed_missing(self, source_ids: list[str] | None = None) -> EmbedReport:
        """Embed every passage (of the given Sources, or all) that lacks a vector for the
        current embedding Model. Failures leave the passages keyword-searchable."""
        with session_scope(self.session_factory) as db:
            spec = self.embedding_spec(db)
            embedder, reason = self.embedder(db)
            query = (
                select(
                    Passage.id,
                    Source.title,
                    Passage.heading,
                    Passage.text,
                    Source.owner_user_id,
                    Source.source_type,
                    Source.id,
                )
                .join(Source, Source.id == Passage.source_id)
                .where((Passage.embedding_ref.is_(None)) | (Passage.embedding_ref != spec.id))
                .order_by(Source.id, Passage.ordinal)
            )
            if source_ids is not None:
                query = query.where(Source.id.in_(source_ids))
            rows = db.execute(query).all()
        if not rows:
            return EmbedReport(spec.id, 0, 0, 0, 0.0)
        if embedder is None:
            return EmbedReport(spec.id, 0, len(rows), None, None, error=reason)
        embedded = 0
        tokens: int | None = 0
        cost: float | None = 0.0
        try:
            for start in range(0, len(rows), EMBED_BATCH):
                part = rows[start : start + EMBED_BATCH]
                batch = await embedder.embed([index_text(r[1], r[2], r[3]) for r in part])
                ids = [r[0] for r in part]
                metadatas = [
                    {
                        "owner": r[4] if r[4] is not None else SHARED_OWNER,
                        "source_type": r[5],
                        "source_id": r[6],
                    }
                    for r in part
                ]
                await asyncio.to_thread(
                    self.vector_store().add, spec.id, ids, batch.vectors, metadatas
                )
                with session_scope(self.session_factory) as db:
                    for passage in db.scalars(select(Passage).where(Passage.id.in_(ids))):
                        passage.embedding_ref = spec.id
                    bump_version(db)
                embedded += len(part)
                tokens = (
                    None
                    if tokens is None or batch.input_tokens is None
                    else tokens + batch.input_tokens
                )
                cost = None if cost is None or batch.cost_usd is None else cost + batch.cost_usd
        except Exception as exc:
            return EmbedReport(
                spec.id,
                embedded,
                len(rows),
                tokens,
                cost,
                error=f"{type(exc).__name__}: {exc}"[:300],
            )
        return EmbedReport(spec.id, embedded, len(rows), tokens, cost)

    async def upload(self, user_id: int, filename: str, data: bytes) -> SourceView:
        if len(data) > self.settings.max_upload_bytes:
            limit_mb = self.settings.max_upload_bytes / (1024 * 1024)
            raise Invalid(f"the file is larger than the {limit_mb:g} MB upload limit")
        digest = sha256_bytes(data)
        with session_scope(self.session_factory) as db:
            if self.upload_count(db, user_id) >= self.settings.max_uploads_per_user:
                limit = self.settings.max_uploads_per_user
                raise Invalid(f"you already have {limit} uploads; delete one first")
            duplicate = db.scalar(
                select(Source).where(
                    Source.source_type == "upload",
                    Source.owner_user_id == user_id,
                    Source.digest == digest,
                )
            )
            if duplicate is not None:
                raise Conflict(f"you already uploaded this file as '{duplicate.title}'")
        parsed = await asyncio.to_thread(
            parse_upload, filename, data, max_pages=self.settings.max_upload_pages
        )
        result, _report = await self.store_document(
            DocumentInput(
                source_type="upload",
                origin=parsed.title,
                title=parsed.title,
                license_note=None,
                # Credential-like strings never reach the index, a prompt or an embedding call.
                chunks=[replace(c, text=redact(c.text).text) for c in parsed.chunks],
                provenance="upload",
                owner_user_id=user_id,
                size_bytes=len(data),
                digest=digest,
            ),
            replace=False,
        )
        with session_scope(self.session_factory) as db:
            return next(v for v in self.list_sources(db, user_id) if v.id == result.source_id)

    async def delete_source(self, user_id: int, source_id: str) -> None:
        with session_scope(self.session_factory) as db:
            source = db.get(Source, source_id)
            if source is None or (
                source.owner_user_id is not None and source.owner_user_id != user_id
            ):
                raise NotFound("source not found")
            if source.owner_user_id is None:
                raise Forbidden("shared Sources are managed with `rampart ingest`")
            ids = [p.id for p in source.passages]
            db.delete(source)
            bump_version(db)
        if ids and self._vectors_may_exist():
            await asyncio.to_thread(self.vector_store().delete, ids)

    def delete_user_vectors(self, user_id: int) -> None:
        """Remove the vectors of a user's uploads (before the account and its rows go)."""
        if not self._vectors_may_exist():
            return
        with session_scope(self.session_factory) as db:
            ids = list(
                db.scalars(
                    select(Passage.id)
                    .join(Source, Source.id == Passage.source_id)
                    .where(Source.owner_user_id == user_id)
                )
            )
        if ids:
            self.vector_store().delete(ids)
