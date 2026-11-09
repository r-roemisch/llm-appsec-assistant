import { OctagonXIcon } from "lucide-react";

import { MetricSummary, RunCost, RunStatusBadge } from "@/components/admin/EvalRunParts";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Markdown } from "@/components/conversation/Markdown";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEvalRun } from "@/hooks/useEvaluation";
import { ApiError } from "@/lib/api";
import { EVAL_POLL_MS, isActiveRun, runCasesText, runDuration, runStatusLabel, suiteLabel } from "@/lib/eval";
import { formatDateTime } from "@/lib/format";
import type { EvalRunDetailOut, EvalRunOut } from "@/lib/types";

interface EvalRunDetailDialogProps {
  /** The run to show; null keeps the dialog closed. */
  runId: string | null;
  /** Its row from the list, shown while the detail loads. */
  summary: EvalRunOut | null;
  onClose: () => void;
}

/** One evaluation run: every field, its metrics and the Markdown report. */
export function EvalRunDetailDialog({ runId, summary, onClose }: EvalRunDetailDialogProps) {
  return (
    <Dialog
      open={runId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {runId ? <RunDetails key={runId} runId={runId} summary={summary} /> : null}
    </Dialog>
  );
}

function Facts({ run }: { run: EvalRunOut }) {
  const duration = runDuration(run);
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">Status</dt>
      <dd>{runStatusLabel(run.status)}</dd>
      <dt className="text-muted-foreground">Kind</dt>
      <dd className="font-mono text-xs leading-5">{run.kind}</dd>
      <dt className="text-muted-foreground">Started</dt>
      <dd>
        {formatDateTime(run.created_at)}
        <span className="text-muted-foreground">
          {run.started_by ? ` by ${run.started_by}` : ", from the command line"}
        </span>
      </dd>
      <dt className="text-muted-foreground">Finished</dt>
      <dd>
        {run.finished_at ? (
          <>
            {formatDateTime(run.finished_at)}
            {duration ? <span className="text-muted-foreground"> after {duration}</span> : null}
          </>
        ) : (
          <span className="text-muted-foreground">Not yet</span>
        )}
      </dd>
      <dt className="text-muted-foreground">Judge Model</dt>
      <dd className="wrap-anywhere">
        {run.judge_model ? (
          <span className="font-mono text-xs leading-5">{run.judge_model}</span>
        ) : (
          <span className="text-muted-foreground">None (deterministic)</span>
        )}
      </dd>
      <dt className="text-muted-foreground">Cost</dt>
      <dd>
        <RunCost run={run} />
      </dd>
      <dt className="text-muted-foreground">Cases</dt>
      <dd>{runCasesText(run)}</dd>
      <dt className="text-muted-foreground">Report file</dt>
      <dd className="wrap-anywhere">
        {run.report_name ? (
          <span className="font-mono text-xs leading-5">{run.report_name}</span>
        ) : (
          <span className="text-muted-foreground">None yet</span>
        )}
      </dd>
    </dl>
  );
}

function Report({ run, detail }: { run: EvalRunOut; detail: EvalRunDetailOut | undefined }) {
  if (detail?.report_markdown) {
    return (
      <article
        aria-label="Evaluation report"
        className="rounded-xl border bg-card px-4 py-4 md:px-5 [&_.prose-rampart>:first-child]:mt-0"
      >
        <Markdown content={detail.report_markdown} />
      </article>
    );
  }
  const text = isActiveRun(run)
    ? `The report appears when the run is done; this page checks every ${EVAL_POLL_MS / 1000} seconds.`
    : run.status === "failed"
      ? "A failed run has no report."
      : detail
        ? "The report file is not available on the server."
        : "Loading the report…";
  return <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">{text}</p>;
}

function RunDetails({ runId, summary }: { runId: string; summary: EvalRunOut | null }) {
  const detail = useEvalRun(runId);
  const run: EvalRunOut | null = detail.data ?? summary;
  const notFound = detail.error instanceof ApiError && detail.error.status === 404;

  return (
    <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
      <DialogHeader className="gap-1.5 border-b px-4 pt-4 pr-12 pb-3">
        <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-snug">
          <span className="min-w-0 break-words">{run ? `${suiteLabel(run.suite)} run` : "Evaluation run"}</span>
          {run ? <RunStatusBadge status={run.status} /> : null}
        </DialogTitle>
        <DialogDescription className="font-mono text-xs wrap-anywhere">{runId}</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {notFound ? (
          <p role="alert" className="text-sm text-destructive">
            There is no evaluation run {runId}.
          </p>
        ) : !run ? (
          detail.isError ? (
            <LoadError error={detail.error} onRetry={() => void detail.refetch()} />
          ) : (
            <LoadingRows rows={4} label="Loading the run" />
          )
        ) : (
          <>
            <Facts run={run} />
            {run.status === "failed" && run.error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
              >
                <OctagonXIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                <p className="min-w-0 text-destructive wrap-anywhere">{run.error}</p>
              </div>
            ) : null}
            {run.metrics ? (
              <section aria-label="Metrics summary" className="space-y-2">
                <h3 className="text-sm font-medium">Metrics</h3>
                <MetricSummary run={run} className="text-sm" />
              </section>
            ) : null}
            <section aria-label="Report" className="space-y-2">
              <h3 className="text-sm font-medium">Report</h3>
              {detail.isError ? (
                <LoadError error={detail.error} onRetry={() => void detail.refetch()} />
              ) : (
                <Report run={run} detail={detail.data} />
              )}
            </section>
          </>
        )}
      </div>
    </DialogContent>
  );
}
