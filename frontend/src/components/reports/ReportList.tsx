import { DownloadIcon, FileTextIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { useDeleteReport } from "@/hooks/useReports";
import { errorMessage, reportDownloadUrl } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import type { ReportOut } from "@/lib/types";

function ReportRow({ report }: { report: ReportOut }) {
  const remove = useDeleteReport();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = report.title || "Untitled report";

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <FileTextIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <Link
          to={`/reports/${encodeURIComponent(report.id)}`}
          className="block truncate rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          title={title}
        >
          {title}
        </Link>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span>{formatDateTime(report.created_at)}</span>
          <span>{formatBytes(report.size)}</span>
          {report.conversation_id ? (
            <Link to={`/c/${encodeURIComponent(report.conversation_id)}`} className="hover:text-foreground hover:underline">
              From a conversation
            </Link>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button asChild variant="ghost" size="icon-sm" className="text-muted-foreground">
          <a href={reportDownloadUrl(report.id)} download aria-label={`Download ${title}`} title="Download as Markdown">
            <DownloadIcon />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${title}`}
          title="Delete"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <Trash2Icon />
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${title}?`}
        description="The report is removed for good; the conversation it came from stays. Download it first if you want to keep a copy."
        error={error}
        confirmLabel="Delete report"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(report, {
            onSuccess: () => setConfirming(false),
            onError: (err) => setError(errorMessage(err)),
          })
        }
      />
    </li>
  );
}

/** The caller's Reports, newest first: open, download, delete. */
export function ReportList({ reports }: { reports: ReportOut[] }) {
  if (reports.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No reports yet</p>
        <p className="mt-1">Ask the assistant in a conversation to write a report, for example of a vulnerability lookup.</p>
      </div>
    );
  }
  return (
    <ul aria-label="Your reports" className="divide-y rounded-xl border bg-card">
      {reports.map((report) => (
        <ReportRow key={report.id} report={report} />
      ))}
    </ul>
  );
}
