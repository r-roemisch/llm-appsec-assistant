import { AvailabilityMark } from "@/components/common/ModelBadges";
import { RetrievalModeBadge } from "@/components/common/RetrievalModeBadge";
import { StatTiles } from "@/components/common/StatTiles";
import { modelDisplayName, useModels } from "@/hooks/useModels";
import { formatCompact, formatNumber } from "@/lib/format";
import type { KnowledgeStatusOut } from "@/lib/types";

/** How the next search will run, with which embedding Model, over how much. */
export function KnowledgeStatusPanel({ status }: { status: KnowledgeStatusOut }) {
  const models = useModels();
  const modelName = modelDisplayName(models.data?.models, status.embedding_model_id);

  return (
    <section aria-labelledby="retrieval-heading" className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="retrieval-heading" className="text-base font-semibold">
            Retrieval
          </h2>
          <RetrievalModeBadge mode={status.retrieval_mode} />
        </div>
        {status.retrieval_mode === "bm25" ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>No embedding Model is available, so searches use keyword matching (BM25) alone.</p>
            {status.reason ? <p className="wrap-anywhere">Reason: {status.reason}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Searches combine embedding similarity with keyword matching (BM25).
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">Embedding Model</span>
          <span className="font-medium">{modelName}</span>
          {modelName !== status.embedding_model_id ? (
            <span className="font-mono text-xs text-muted-foreground">{status.embedding_model_id}</span>
          ) : null}
          <AvailabilityMark available={status.embedding_available} />
        </p>
      </div>
      <StatTiles
        tiles={[
          { label: "Sources", value: formatCompact(status.sources), title: "Shared Sources plus your uploads" },
          { label: "Passages", value: formatCompact(status.passages) },
          {
            label: "Embedded passages",
            value: formatCompact(status.embedded_passages),
            title: "Passages with a vector for the current embedding Model",
          },
          { label: "Your uploads", value: `${formatNumber(status.uploads)} of ${formatNumber(status.max_uploads)}` },
        ]}
      />
    </section>
  );
}
