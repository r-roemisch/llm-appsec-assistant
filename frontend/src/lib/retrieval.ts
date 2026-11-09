// What a streaming turn shows from its `retrieval` events (docs/API.md, M2):
// "search" starts round 1, 2 or 3 (2 and 3 follow a query rewrite) and
// "graded" reports how many of the passages found the grader kept.

import { formatCount } from "@/lib/format";
import type { RetrievalMode, TurnRetrievalData, TurnRetrievalGradedData } from "@/lib/types";

export interface RetrievalStatus {
  /** "searching" while a search runs; "found" or "nothing" once it was graded. */
  phase: "searching" | "found" | "nothing";
  /** One short line, such as "Searching the Knowledge Base…". */
  label: string;
  /** The rewritten query, for rounds after the first. */
  query: string | null;
}

/** The latest retrieval step of a turn, or null before it searched. */
export function describeRetrieval(events: readonly TurnRetrievalData[], helpMode = false): RetrievalStatus | null {
  const last = events.at(-1);
  if (!last) return null;
  if (last.phase === "search") {
    if (last.round > 1) return { phase: "searching", label: "Rewriting the query…", query: last.query || null };
    return {
      phase: "searching",
      label: helpMode ? "Searching Rampart's guides…" : "Searching the Knowledge Base…",
      query: null,
    };
  }
  if (last.relevant > 0) {
    return { phase: "found", label: `${formatCount(last.relevant, "relevant passage")} found`, query: null };
  }
  return { phase: "nothing", label: "Nothing relevant found", query: null };
}

/** The mode of the latest graded search, or null before one. */
export function latestRetrievalMode(events: readonly TurnRetrievalData[]): RetrievalMode | null {
  const graded = events.findLast((event): event is TurnRetrievalGradedData => event.phase === "graded");
  return graded?.mode ?? null;
}
