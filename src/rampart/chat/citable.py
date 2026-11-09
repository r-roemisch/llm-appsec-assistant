"""The passages a turn may cite, numbered once: retrieval fills 1..n, search_knowledge adds more."""

from __future__ import annotations

from collections.abc import Iterable

from rampart.knowledge.retrieval import PassageRecord


class CitableRegistry:
    def __init__(self, passages: Iterable[PassageRecord] = ()) -> None:
        self._passages: list[PassageRecord] = []
        self.add(passages)

    def add(self, passages: Iterable[PassageRecord]) -> list[int]:
        """Number new passages after the existing ones; a passage seen before keeps its number."""
        index = {p.id: i for i, p in enumerate(self._passages)}
        numbers: list[int] = []
        for passage in passages:
            if passage.id not in index:
                index[passage.id] = len(self._passages)
                self._passages.append(passage)
            numbers.append(index[passage.id] + 1)
        return numbers

    @property
    def passages(self) -> list[PassageRecord]:
        return list(self._passages)

    def ids(self) -> list[str]:
        return [p.id for p in self._passages]
