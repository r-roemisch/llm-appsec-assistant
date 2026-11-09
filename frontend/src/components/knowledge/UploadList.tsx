import { FileTextIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useDeleteSource } from "@/hooks/useKnowledge";
import { errorMessage } from "@/lib/api";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import type { SourceOut } from "@/lib/types";

function UploadRow({ source }: { source: SourceOut }) {
  const remove = useDeleteSource();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={source.title}>
          {source.title}
        </p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span>{formatCount(source.passage_count, "passage")}</span>
          <span>{formatBytes(source.size_bytes)}</span>
          <span>Uploaded {formatDate(source.fetched_at)}</span>
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${source.title}`}
        className="text-muted-foreground hover:text-destructive"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
      >
        <Trash2Icon />
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${source.title}?`}
        description="Its passages leave your Knowledge Base, and answers that cited them can no longer open them. This cannot be undone."
        error={error}
        confirmLabel="Delete upload"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(source, {
            onSuccess: () => setConfirming(false),
            onError: (err) => setError(errorMessage(err)),
          })
        }
      />
    </li>
  );
}

/** The caller's own uploads, newest first, each with a delete button. */
export function UploadList({ uploads }: { uploads: SourceOut[] }) {
  if (uploads.length === 0) {
    return <p className="text-sm text-muted-foreground">No uploads yet.</p>;
  }
  return (
    <ul aria-label="Your uploads" className="divide-y rounded-xl border bg-card">
      {uploads.map((source) => (
        <UploadRow key={source.id} source={source} />
      ))}
    </ul>
  );
}
