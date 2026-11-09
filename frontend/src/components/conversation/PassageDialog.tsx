import { OriginLink } from "@/components/common/OriginLink";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { CitationNumber } from "@/components/conversation/CitedText";
import { Markdown } from "@/components/conversation/Markdown";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CitationContext } from "@/hooks/useCitations";
import { usePassage } from "@/hooks/useKnowledge";
import { ApiError } from "@/lib/api";
import { sourceTypeLabel } from "@/lib/labels";
import type { CitationOut } from "@/lib/types";

interface PassageDialogProps {
  /** The Citation to show; null keeps the dialog closed. */
  citation: CitationOut | null;
  onClose: () => void;
}

/** The full passage behind a Citation, with its origin, license and provenance. */
export function PassageDialog({ citation, onClose }: PassageDialogProps) {
  return (
    <Dialog
      open={citation !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {citation ? <PassageDetails citation={citation} /> : null}
    </Dialog>
  );
}

function PassageDetails({ citation }: { citation: CitationOut }) {
  const passage = usePassage(citation.passage_id);
  const data = passage.data;
  const provenance = data?.provenance ?? citation.provenance;
  const sourceType = data?.source_type ?? citation.source_type;
  const gone = passage.error instanceof ApiError && passage.error.status === 404;

  return (
    <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-2xl">
      <DialogHeader className="pr-8">
        <DialogTitle className="flex items-start gap-2 leading-snug">
          <CitationNumber n={citation.n} className="mt-0.5" />
          <span className="min-w-0">{data?.source_title ?? citation.source_title}</span>
        </DialogTitle>
        <DialogDescription>
          {citation.heading ?? (data ? `Passage ${data.ordinal + 1} of this Source` : "Passage")}
        </DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Origin</dt>
        <dd className="min-w-0">
          <OriginLink origin={data?.origin ?? citation.origin} />
        </dd>
        <dt className="text-muted-foreground">License</dt>
        <dd className="min-w-0 wrap-anywhere">
          {data ? (data.license_note ?? "Not recorded") : passage.isPending ? "Loading…" : "Unknown"}
        </dd>
        <dt className="text-muted-foreground">Provenance</dt>
        <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {provenance === "upload" ? (
            <>
              <Badge variant="secondary" className="font-normal">
                Your upload
              </Badge>
              <span className="text-muted-foreground">private to you</span>
            </>
          ) : (
            <span>Shared Source · {sourceTypeLabel(sourceType)}</span>
          )}
        </dd>
      </dl>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/30 px-3.5 py-3">
        {passage.isPending ? (
          <LoadingRows rows={4} label="Loading the passage" />
        ) : passage.isError ? (
          <div className="space-y-3 text-sm">
            {gone ? (
              <p role="alert" className="text-destructive">
                This passage is no longer available. Its Source may have been deleted.
              </p>
            ) : (
              <LoadError error={passage.error} onRetry={() => void passage.refetch()} />
            )}
            <p className="whitespace-pre-wrap text-muted-foreground">{citation.snippet}</p>
          </div>
        ) : (
          // The passage is Source text, not this answer: its own [n] stay plain.
          <CitationContext value={null}>
            <Markdown content={passage.data.text} />
          </CitationContext>
        )}
      </div>
    </DialogContent>
  );
}
