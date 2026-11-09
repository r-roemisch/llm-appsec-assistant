import { SearchCheckIcon, SearchIcon, SearchXIcon } from "lucide-react";

import type { RetrievalStatus } from "@/lib/retrieval";
import { cn } from "@/lib/utils";

const ICONS = { searching: SearchIcon, found: SearchCheckIcon, nothing: SearchXIcon } as const;

/** One quiet line while a turn searches the Knowledge Base, before the answer starts. */
export function RetrievalProgress({ status }: { status: RetrievalStatus }) {
  const Icon = ICONS[status.phase];
  return (
    <div role="status" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", status.phase === "searching" && "animate-pulse")} />
      <span className="shrink-0">{status.label}</span>
      {status.query ? <span className="min-w-0 truncate text-xs italic">“{status.query}”</span> : null}
      {status.phase !== "searching" ? <span aria-hidden="true" className="streaming-caret" /> : null}
    </div>
  );
}
