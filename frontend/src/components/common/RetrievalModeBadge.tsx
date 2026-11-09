import { LayersIcon, TextSearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { retrievalModeLabel } from "@/lib/labels";
import type { RetrievalMode } from "@/lib/types";

const EXPLANATIONS: Record<RetrievalMode, string> = {
  hybrid: "Retrieval combined embedding similarity with keyword search (BM25).",
  bm25: "No embedding Model was available, so retrieval used keyword search (BM25) alone.",
};

/** "Hybrid search" or "Keyword search only"; with `explain`, a tooltip says why. */
export function RetrievalModeBadge({ mode, explain = false }: { mode: RetrievalMode; explain?: boolean }) {
  const Icon = mode === "hybrid" ? LayersIcon : TextSearchIcon;
  const badge = (
    <Badge
      variant={mode === "hybrid" ? "secondary" : "outline"}
      className="font-normal"
      tabIndex={explain ? 0 : undefined}
    >
      <Icon aria-hidden="true" />
      {retrievalModeLabel(mode)}
    </Badge>
  );
  if (!explain) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{EXPLANATIONS[mode]}</TooltipContent>
    </Tooltip>
  );
}
