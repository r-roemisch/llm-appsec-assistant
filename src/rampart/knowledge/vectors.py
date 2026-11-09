"""Passage vectors in Chroma, one collection per embedding Model.

Vectors from different embedding Models cannot be compared, so each Model gets its own
collection; switching the embedding Slot leaves search keyword-only until the passages are
embedded again (``rampart ingest`` embeds whatever is missing). Every vector carries the
owner (0 for shared Sources) and the Source type, and every query filters on both. The
caller still re-checks visibility in SQL: the database is the authority, Chroma an index.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Protocol

SHARED_OWNER = 0


class VectorStore(Protocol):
    def add(
        self,
        model_id: str,
        ids: list[str],
        vectors: list[list[float]],
        metadatas: list[dict[str, Any]],
    ) -> None: ...

    def delete(self, ids: list[str]) -> None:
        """Remove these passage ids from every collection."""
        ...

    def query(
        self,
        model_id: str,
        vector: list[float],
        k: int,
        owners: list[int],
        source_types: list[str],
    ) -> list[tuple[str, float]]:
        """(passage id, cosine distance) pairs, nearest first, among the allowed owners/types."""
        ...


def collection_name(model_id: str) -> str:
    return "passages-" + hashlib.sha256(model_id.encode("utf-8")).hexdigest()[:24]


def _where(owners: list[int], source_types: list[str]) -> dict[str, Any]:
    clauses: list[dict[str, Any]] = [{"owner": {"$in": owners}}]
    if source_types:
        clauses.append({"source_type": {"$in": source_types}})
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


class ChromaVectorStore:
    """A persistent Chroma client under the data directory. Telemetry is switched off."""

    def __init__(self, path: Path) -> None:
        import chromadb
        from chromadb.config import Settings as ChromaSettings

        path.mkdir(parents=True, exist_ok=True)
        self._client = chromadb.PersistentClient(
            path=str(path), settings=ChromaSettings(anonymized_telemetry=False)
        )

    def _collection(self, model_id: str) -> Any:
        return self._client.get_or_create_collection(
            collection_name(model_id),
            metadata={"hnsw:space": "cosine", "model_id": model_id},
            embedding_function=None,
        )

    def add(
        self,
        model_id: str,
        ids: list[str],
        vectors: list[list[float]],
        metadatas: list[dict[str, Any]],
    ) -> None:
        if ids:
            self._collection(model_id).upsert(ids=ids, embeddings=vectors, metadatas=metadatas)

    def delete(self, ids: list[str]) -> None:
        if not ids:
            return
        for collection in self._client.list_collections():
            name = getattr(collection, "name", collection)
            if isinstance(name, str) and name.startswith("passages-"):
                self._client.get_collection(name, embedding_function=None).delete(ids=ids)

    def query(
        self,
        model_id: str,
        vector: list[float],
        k: int,
        owners: list[int],
        source_types: list[str],
    ) -> list[tuple[str, float]]:
        collection = self._collection(model_id)
        if collection.count() == 0:
            return []
        result = collection.query(
            query_embeddings=[vector],
            n_results=k,
            where=_where(owners, source_types),
            include=["distances"],
        )
        ids = (result.get("ids") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        return [(str(i), float(d)) for i, d in zip(ids, distances, strict=False)]
