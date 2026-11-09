import { ChevronRightIcon } from "lucide-react";

import { CitationNumber } from "@/components/conversation/CitedText";
import { Badge } from "@/components/ui/badge";
import type { CitationOut } from "@/lib/types";

/** The numbered Sources under an answer; each item opens its passage. */
export function SourcesList({ citations, onOpen }: { citations: CitationOut[]; onOpen: (n: number) => void }) {
  return (
    <section aria-label="Sources" className="space-y-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">Sources</h3>
      <ol className="space-y-1.5">
        {citations.map((citation) => (
          <li key={citation.n}>
            <button
              type="button"
              onClick={() => onOpen(citation.n)}
              className="flex w-full items-start gap-2.5 rounded-lg border bg-card px-3 py-2 text-left transition-colors outline-none hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <CitationNumber n={citation.n} className="mt-px" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm leading-snug font-medium">{citation.source_title}</span>
                  {citation.provenance === "upload" ? (
                    <Badge variant="secondary" className="font-normal">
                      Your upload
                    </Badge>
                  ) : null}
                </span>
                {citation.heading ? (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{citation.heading}</span>
                ) : null}
                <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{citation.snippet}</span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="mt-px size-4 shrink-0 text-muted-foreground/60" />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
