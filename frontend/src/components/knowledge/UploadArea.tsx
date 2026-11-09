import { FileUpIcon, Loader2Icon } from "lucide-react";
import { useState, type ChangeEvent, type DragEvent } from "react";

import { buttonVariants } from "@/components/ui/button";
import { useUploadSource } from "@/hooks/useKnowledge";
import { errorMessage } from "@/lib/api";
import { formatBytes, formatNumber } from "@/lib/format";
import type { KnowledgeStatusOut } from "@/lib/types";
import { checkUpload } from "@/lib/uploads";
import { cn } from "@/lib/utils";

const INPUT_ID = "knowledge-upload";

/**
 * A drop zone plus a file picker for one file at a time. Type, size and the
 * upload count are checked here first; the server checks again, and its 422
 * or 409 detail is shown when it refuses.
 */
export function UploadArea({ status }: { status: KnowledgeStatusOut | undefined }) {
  const upload = useUploadSource();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = status ? status.uploads >= status.max_uploads : false;
  const disabled = upload.isPending || full;

  function submit(file: File) {
    const problem = status ? checkUpload(file, status) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    upload.mutate(file, { onError: (err) => setError(errorMessage(err)) });
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so that choosing the same file again fires a change
    if (file) submit(file);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDragging(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    if (files.length > 1) {
      setError("Drop one file at a time.");
      return;
    }
    submit(files[0]);
  }

  const limits = status
    ? `${status.upload_types.join(", ")} up to ${formatBytes(status.max_upload_bytes)}. ` +
      `${formatNumber(status.uploads)} of ${formatNumber(status.max_uploads)} uploads used.`
    : "PDF, Markdown or text.";

  return (
    <div className="space-y-2">
      <div
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        role="group"
        aria-label="Upload a file"
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-4 py-7 text-center transition-colors",
          dragging && "border-primary bg-primary/5",
        )}
      >
        {upload.isPending ? (
          <Loader2Icon aria-hidden="true" className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <FileUpIcon aria-hidden="true" className="size-6 text-muted-foreground" />
        )}
        <div className="space-y-1">
          <p className="text-sm font-medium" aria-live="polite">
            {upload.isPending
              ? `Adding ${upload.variables.name}…`
              : full
                ? "You have reached the upload limit"
                : "Drop a file here, or choose one"}
          </p>
          <p className="text-xs text-muted-foreground">{limits}</p>
        </div>
        <input
          id={INPUT_ID}
          type="file"
          accept={status?.upload_types.join(",")}
          onChange={onChange}
          disabled={disabled}
          className="peer sr-only"
        />
        <label
          htmlFor={INPUT_ID}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
            disabled && "pointer-events-none opacity-50",
          )}
        >
          Choose a file
        </label>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
