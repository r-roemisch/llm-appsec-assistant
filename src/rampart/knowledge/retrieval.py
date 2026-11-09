"""Hybrid retrieval: BM25 over the passages a user may see, plus vector search when an
embedding Model is available, fused by reciprocal rank.

Access control is applied twice: the candidate sets are built only from shared Sources and
the caller's own uploads, and every returned passage is loaded again from SQL with the same
visibility rule, so nothing from another user's upload can be returned even if an index is
stale or wrong.
"""

from __future__ import annotations

import asyncio
import re
from collections import OrderedDict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from rank_bm25 import BM25Plus
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from rampart.db import session_scope
from rampart.knowledge.embeddings import Embedder, EmbeddingBatch
from rampart.knowledge.text import keyword_tokens
from rampart.knowledge.vectors import SHARED_OWNER, VectorStore
from rampart.models import KnowledgeState, Passage, Source

SOURCE_TYPES = ("curated", "upload", "app_docs")
CANDIDATES_PER_LIST = 20
RRF_K = 60
BM25_CACHE_SIZE = 32


@dataclass(frozen=True)
class PassageRecord:
    id: str
    source_id: str
    source_title: str
    source_type: str
    origin: str
    license_note: str | None
    ordinal: int
    heading: str | None
    text: str
    provenance: str
    owner_user_id: int | None


@dataclass(frozen=True)
class SearchResult:
    passages: list[PassageRecord]
    mode: str  # "hybrid" or "bm25"
    embedding: EmbeddingBatch | None  # usage of the query embedding, when one was made
    embedding_error: str | None = None  # why vector search was skipped for this query


def visible_to(user_id: int):  # noqa: ANN201 (a SQL expression)
    return or_(Source.owner_user_id.is_(None), Source.owner_user_id == user_id)


def index_text(title: str, heading: str | None, text: str) -> str:
    """What keyword search and embeddings see: Source title, heading path and passage text."""
    return "\n".join(part for part in (title, heading or "", text) if part)


def knowledge_version(db: Session) -> int:
    row = db.get(KnowledgeState, 1)
    return row.version if row is not None else 0


def bump_version(db: Session) -> None:
    row = db.get(KnowledgeState, 1)
    if row is None:
        db.add(KnowledgeState(id=1, version=1))
    else:
        row.version += 1
    db.flush()


def load_passages(db: Session, user_id: int, ids: Iterable[str]) -> dict[str, PassageRecord]:
    wanted = list(dict.fromkeys(ids))
    if not wanted:
        return {}
    rows = db.execute(
        select(Passage, Source)
        .join(Source, Source.id == Passage.source_id)
        .where(Passage.id.in_(wanted), visible_to(user_id))
    )
    found: dict[str, PassageRecord] = {}
    for passage, source in rows:
        found[passage.id] = PassageRecord(
            id=passage.id,
            source_id=source.id,
            source_title=source.title,
            source_type=source.source_type,
            origin=source.origin,
            license_note=source.license_note,
            ordinal=passage.ordinal,
            heading=passage.heading,
            text=passage.text,
            provenance=passage.provenance,
            owner_user_id=source.owner_user_id,
        )
    return found


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = RRF_K) -> list[str]:
    scores: dict[str, float] = {}
    first_seen: dict[str, int] = {}
    order = 0
    for ranking in rankings:
        for rank, pid in enumerate(ranking):
            scores[pid] = scores.get(pid, 0.0) + 1.0 / (k + rank + 1)
            if pid not in first_seen:
                first_seen[pid] = order
                order += 1
    return sorted(scores, key=lambda pid: (-scores[pid], first_seen[pid]))


# (M7) Framework identifiers a user may name exactly: MITRE ATLAS techniques, sub-techniques,
# mitigations and case studies, and OWASP Top 10 for LLM Applications items.
IDENTIFIER = re.compile(r"\b(AML\.(?:T\d{4}(?:\.\d{3})?|M\d{4}|CS\d{4})|LLM\d{2})\b", re.IGNORECASE)


def named_identifiers(query: str) -> list[str]:
    return list(dict.fromkeys(m.upper() for m in IDENTIFIER.findall(query)))


@dataclass
class _KeywordIndex:
    ids: list[str]
    token_sets: list[frozenset[str]]
    bm25: BM25Plus | None
    # (M7) the identifier a passage's heading starts with ("AML.T0054", "LLM01"), by passage id
    heading_ids: dict[str, str] = field(default_factory=dict)


class Retriever:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        vector_store: Callable[[], VectorStore],
    ) -> None:
        self.session_factory = session_factory
        self._vector_store = vector_store
        self._cache: OrderedDict[tuple[int, int, tuple[str, ...]], _KeywordIndex] = OrderedDict()

    # --- keyword search -------------------------------------------------------------

    def _keyword_index(self, db: Session, user_id: int, types: tuple[str, ...]) -> _KeywordIndex:
        key = (knowledge_version(db), user_id, types)
        cached = self._cache.get(key)
        if cached is not None:
            self._cache.move_to_end(key)
            return cached
        rows = db.execute(
            select(Passage.id, Source.title, Passage.heading, Passage.text)
            .join(Source, Source.id == Passage.source_id)
            .where(visible_to(user_id), Source.source_type.in_(types))
            .order_by(Source.id, Passage.ordinal)
        ).all()
        ids = [row[0] for row in rows]
        tokens = [keyword_tokens(index_text(row[1], row[2], row[3])) for row in rows]
        heading_ids: dict[str, str] = {}
        for row in rows:
            # The heading ("AML.T0054: LLM Jailbreak"), else the Source title, where an OWASP
            # prefix is skipped ("OWASP LLM01:2025 Prompt Injection").
            for label in (row[2] or "", (row[1] or "").removeprefix("OWASP ")):
                found = IDENTIFIER.match(label.strip())
                if found:
                    heading_ids[row[0]] = found.group(1).upper()
                    break
        index = _KeywordIndex(
            ids=ids,
            token_sets=[frozenset(t) for t in tokens],
            bm25=BM25Plus(tokens) if ids and any(tokens) else None,
            heading_ids=heading_ids,
        )
        self._cache[key] = index
        while len(self._cache) > BM25_CACHE_SIZE:
            self._cache.popitem(last=False)
        return index

    def keyword_ranking(
        self, db: Session, user_id: int, query: str, types: tuple[str, ...], limit: int
    ) -> list[str]:
        index = self._keyword_index(db, user_id, types)
        query_tokens = keyword_tokens(query)
        if index.bm25 is None or not query_tokens:
            return []
        wanted = set(query_tokens)
        scores = index.bm25.get_scores(query_tokens)
        # BM25+ gives every document a floor score; rank only documents sharing a query term.
        candidates = [i for i, tokens in enumerate(index.token_sets) if tokens & wanted]
        candidates.sort(key=lambda i: (-float(scores[i]), i))
        return [index.ids[i] for i in candidates[:limit]]

    def named_passages(
        self, db: Session, user_id: int, query: str, types: tuple[str, ...], per_id: int = 2
    ) -> list[str]:
        """(M7) Passages whose heading (or Source title) starts with an identifier the query
        names exactly, in document order, at most ``per_id`` for each identifier. Keyword
        search alone ranks them below passages that merely mention the identifier."""
        wanted = named_identifiers(query)
        if not wanted:
            return []
        index = self._keyword_index(db, user_id, types)
        out: list[str] = []
        for identifier in wanted:
            out += [pid for pid in index.ids if index.heading_ids.get(pid) == identifier][:per_id]
        return out

    # --- hybrid search ----------------------------------------------------------------

    async def search(
        self,
        *,
        user_id: int,
        query: str,
        source_types: Iterable[str],
        k: int,
        embedder: Embedder | None,
    ) -> SearchResult:
        types = tuple(sorted(set(source_types) & set(SOURCE_TYPES)))
        with session_scope(self.session_factory) as db:
            keyword = self.keyword_ranking(db, user_id, query, types, CANDIDATES_PER_LIST)
            named = self.named_passages(db, user_id, query, types)
        dense: list[str] = []
        usage: EmbeddingBatch | None = None
        error: str | None = None
        mode = "bm25"
        if embedder is not None:
            try:
                usage = await embedder.embed([query])
                store = self._vector_store()
                hits = await asyncio.to_thread(
                    store.query,
                    embedder.spec.id,
                    usage.vectors[0],
                    CANDIDATES_PER_LIST,
                    [SHARED_OWNER, user_id],
                    list(types),
                )
                dense = [pid for pid, _distance in hits]
                mode = "hybrid"
            except Exception as exc:  # degrade to keyword search, never fail the turn
                error = f"{type(exc).__name__}: {exc}"[:300]
        ranked = reciprocal_rank_fusion([dense, keyword]) if dense else keyword
        if named:  # a passage about exactly the identifier the user named comes first
            ranked = named + [pid for pid in ranked if pid not in set(named)]
        with session_scope(self.session_factory) as db:
            visible = load_passages(db, user_id, ranked[: k * 2])
        passages = [visible[pid] for pid in ranked if pid in visible][:k]
        return SearchResult(passages=passages, mode=mode, embedding=usage, embedding_error=error)

    def get(self, user_id: int, ids: Iterable[str]) -> dict[str, PassageRecord]:
        with session_scope(self.session_factory) as db:
            return load_passages(db, user_id, ids)
