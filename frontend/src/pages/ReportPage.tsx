import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { Link, useParams } from "react-router";

import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Markdown } from "@/components/conversation/Markdown";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/button";
import { useReport } from "@/hooks/useReports";
import { ApiError, reportDownloadUrl } from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";

/** One Report rendered as Markdown (no raw HTML, like answers), with a download button. */
export function ReportPage() {
  const { id = "" } = useParams<{ id: string }>();
  const report = useReport(id);
  const notFound = report.error instanceof ApiError && report.error.status === 404;
  const title = report.data?.title || (report.isPending ? "" : "Report");

  return (
    <>
      <PageHeader title={title}>
        {report.data ? (
          <Button asChild variant="outline" size="sm">
            <a href={reportDownloadUrl(report.data.id)} download>
              <DownloadIcon />
              Download
            </a>
          </Button>
        ) : null}
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 md:px-6 md:py-8">
          <Link
            to="/reports"
            className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4" />
            All reports
          </Link>
          {report.isPending ? (
            <LoadingRows rows={6} label="Loading the report" />
          ) : report.isError ? (
            notFound ? (
              <div className="space-y-1 text-sm">
                <p className="font-medium">This report does not exist.</p>
                <p className="text-muted-foreground">It may have been deleted, or the link is not yours.</p>
              </div>
            ) : (
              <LoadError error={report.error} onRetry={() => void report.refetch()} />
            )
          ) : (
            <>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
                <span>Created {formatDateTime(report.data.created_at)}</span>
                <span>{formatBytes(report.data.size)}</span>
                {report.data.conversation_id ? (
                  <Link
                    to={`/c/${encodeURIComponent(report.data.conversation_id)}`}
                    className="hover:text-foreground hover:underline"
                  >
                    Open the conversation
                  </Link>
                ) : null}
              </p>
              <article aria-label="Report" className="rounded-xl border bg-card px-4 py-5 md:px-6">
                <Markdown content={report.data.markdown} />
              </article>
            </>
          )}
        </div>
      </div>
    </>
  );
}
