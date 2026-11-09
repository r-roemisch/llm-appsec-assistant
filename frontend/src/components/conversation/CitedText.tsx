import { Children, type ReactNode } from "react";

import { useCitations, type CitationContextValue } from "@/hooks/useCitations";
import { splitCitationMarkers } from "@/lib/citations";
import type { CitationOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const CHIP =
  "inline-flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded px-1 text-[0.6875rem] leading-none font-semibold tabular-nums bg-primary/10 text-primary";

/** A Citation number as a small chip, as in the Sources list. */
export function CitationNumber({ n, className }: { n: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cn(CHIP, className)}>
      {n}
    </span>
  );
}

function CitationChip({ citation, onOpen }: { citation: CitationOut; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={citation.heading ? `${citation.source_title}: ${citation.heading}` : citation.source_title}
      aria-label={`Citation ${citation.n}: ${citation.source_title}`}
      className={cn(
        CHIP,
        "transition-colors outline-none hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/60",
      )}
    >
      {citation.n}
    </button>
  );
}

function linkMarkers(text: string, citations: CitationContextValue): ReactNode {
  const segments = splitCitationMarkers(text, (n) => citations.byNumber.get(n));
  if (segments.every((segment) => typeof segment === "string")) return text;
  return segments.map((segment, index) =>
    typeof segment === "string" ? (
      segment
    ) : (
      <sup key={index} className="relative -top-[0.4em] ml-0.5 inline-flex gap-0.5 align-baseline leading-none">
        {segment.items.map((citation) => (
          <CitationChip key={citation.n} citation={citation} onOpen={() => citations.open(citation.n)} />
        ))}
      </sup>
    ),
  );
}

/**
 * The children of one Markdown text element. Inside an answer, [n] markers
 * that match a Citation become chips that open the passage; elsewhere, and for
 * numbers without a Citation, the text is left as it is.
 */
export function CitedText({ children }: { children?: ReactNode }) {
  const citations = useCitations();
  if (!citations || citations.byNumber.size === 0) return children;
  return Children.map(children, (child) => (typeof child === "string" ? linkMarkers(child, citations) : child));
}
