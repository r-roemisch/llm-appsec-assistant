import { CircleCheckIcon, LoaderCircleIcon, OctagonXIcon } from "lucide-react";
import { Fragment } from "react";

import { metricSummary, runStatusLabel, runStatusTone, type RunTone } from "@/lib/eval";
import { formatCost } from "@/lib/format";
import type { EvalRunOut, EvalRunStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const TONES: Record<RunTone, string> = {
  progress: "border-primary/30 bg-primary/10 text-primary",
  success: "border-success/30 bg-success/10 text-success",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** A run's state as a word, an icon and a colour; queued and running spin. */
export function RunStatusBadge({ status, className }: { status: EvalRunStatus; className?: string }) {
  const tone = runStatusTone(status);
  const Icon = status === "done" ? CircleCheckIcon : status === "failed" ? OctagonXIcon : LoaderCircleIcon;
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("size-3", tone === "progress" && "animate-spin")} />
      {runStatusLabel(status)}
    </span>
  );
}

/** Estimated against actual cost; the actual cost is known once the run is done. */
export function RunCost({ run, className }: { run: EvalRunOut; className?: string }) {
  const actual =
    run.status === "done" ? (run.cost_usd === null ? "unknown" : formatCost(run.cost_usd)) : run.status === "failed" ? "not reported" : "when done";
  return (
    <span className={cn("tabular-nums", className)}>
      estimated {run.estimated_cost_usd === null ? "unknown" : formatCost(run.estimated_cost_usd)} · actual {actual}
    </span>
  );
}

/** The run's metrics in a few lines (see metricSummary); nothing while there are none. */
export function MetricSummary({ run, className }: { run: Pick<EvalRunOut, "suite" | "metrics">; className?: string }) {
  const lines = metricSummary(run);
  if (lines.length === 0) return null;
  return (
    <dl aria-label="Metrics" className={cn("grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs", className)}>
      {lines.map((line) => (
        <Fragment key={line.label}>
          <dt className="text-muted-foreground">{line.label}</dt>
          <dd className="min-w-0 wrap-anywhere">
            <span className="font-medium tabular-nums">{line.value}</span>
            {line.detail ? <span className="text-muted-foreground"> · {line.detail}</span> : null}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
