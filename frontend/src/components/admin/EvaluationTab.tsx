import { CalculatorIcon, CircleCheckIcon, CoinsIcon, OctagonXIcon, PlayIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { EvalRunDetailDialog } from "@/components/admin/EvalRunDetailDialog";
import { MetricSummary, RunCost, RunStatusBadge } from "@/components/admin/EvalRunParts";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useDeleteEvaluationCase,
  useEvalDatasets,
  useEvalEstimate,
  useEvalRuns,
  useEvaluationCases,
  useStartEvalRuns,
} from "@/hooks/useEvaluation";
import { useNow } from "@/hooks/useNow";
import { ApiError, errorMessage } from "@/lib/api";
import {
  approxCost,
  EVAL_LIMIT_MAX,
  EVAL_POLL_MS,
  isActiveRun,
  parseCaseLimit,
  runButtonLabel,
  runCasesText,
  runDuration,
  runStatusLabel,
  SUITE_COSTS,
  suiteLabel,
  SUITES,
  suitesOf,
  type SuiteCost,
} from "@/lib/eval";
import { caseKindLabel, caseSourceLabel, shortId } from "@/lib/feedback";
import { formatCost, formatCount, formatDateTime, formatNumber, formatRelativeTime } from "@/lib/format";
import { toolLabel } from "@/lib/tools";
import type {
  EvalEstimateIn,
  EvalEstimateOut,
  EvalRunOut,
  EvalSuite,
  EvaluationCaseOut,
  SuiteEstimateOut,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const COST_STYLES: Record<SuiteCost, { icon: typeof CoinsIcon; className: string; label: string }> = {
  money: { icon: CoinsIcon, className: "text-warning", label: "Costs real money" },
  little: { icon: CoinsIcon, className: "text-muted-foreground", label: "Costs a little" },
  free: { icon: CircleCheckIcon, className: "text-success", label: "Free" },
};

/** What running the chosen suites costs, one line per suite. */
function SuiteCosts({ suite, label }: { suite: EvalSuite; label?: string }) {
  return (
    <ul aria-label={label} className="space-y-1 text-xs">
      {suitesOf(suite).map((name) => {
        const { cost, text } = SUITE_COSTS[name];
        const style = COST_STYLES[cost];
        const Icon = style.icon;
        return (
          <li key={name} className="flex gap-1.5">
            <Icon aria-hidden="true" className={cn("mt-px size-3.5 shrink-0", style.className)} />
            <span className="min-w-0">
              <span className={cn("font-medium", cost === "money" ? "text-foreground" : "text-foreground/80")}>
                {suiteLabel(name)}
              </span>{" "}
              <span className="text-muted-foreground">{text}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DatasetsSection() {
  const datasets = useEvalDatasets();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h3 id={headingId} className="text-sm font-semibold">
          Datasets
        </h3>
        <p className="text-sm text-muted-foreground">
          Authored cases live in <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">eval/</code> on the
          server, where the assistant cannot read them; cases added from Feedback join their suite.
        </p>
      </div>
      {datasets.isPending ? (
        <LoadingRows rows={1} label="Loading the datasets" />
      ) : datasets.isError ? (
        <LoadError error={datasets.error} onRetry={() => void datasets.refetch()} />
      ) : (
        <dl className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
          {[
            {
              suite: "qa",
              total: datasets.data.qa.authored + datasets.data.qa.added,
              detail: `${formatNumber(datasets.data.qa.authored)} authored, ${formatNumber(datasets.data.qa.added)} added from Feedback`,
            },
            {
              suite: "tool",
              total: datasets.data.tool.authored + datasets.data.tool.added,
              detail: `${formatNumber(datasets.data.tool.authored)} authored, ${formatNumber(datasets.data.tool.added)} added from Feedback`,
            },
            {
              suite: "guard",
              total: datasets.data.guard.cases + datasets.data.guard.holdout,
              detail: `${formatNumber(datasets.data.guard.cases)} written with the rules, ${formatNumber(datasets.data.guard.holdout)} held out`,
            },
          ].map((item) => (
            <div key={item.suite} className="bg-card px-4 py-3">
              <dt className="text-xs text-muted-foreground">{suiteLabel(item.suite)}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">{formatCount(item.total, "case")}</dd>
              <dd className="text-xs text-muted-foreground">{item.detail}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** The loud part of a qa estimate: real money, the judge, how many calls. */
function JudgeCost({ estimate }: { estimate: SuiteEstimateOut }) {
  if (estimate.cost_usd === 0) {
    return (
      <p className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        {suiteLabel("qa")}: the Models have no listed price (local Models), so the estimate is $0.
      </p>
    );
  }
  return (
    <div
      role="note"
      aria-label="Judge cost"
      className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm"
    >
      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">
          {suiteLabel("qa")} spends real money
          {estimate.cost_usd === null ? ": the amount is unknown" : `: about ${approxCost(estimate.cost_usd)}`}
        </p>
        <p className="text-muted-foreground">
          Rampart answers {formatCount(estimate.cases, "question")} ({formatCount(estimate.model_calls, "Model call")}
          ), and the judge{" "}
          {estimate.judge_model ? <span className="font-mono text-xs text-foreground wrap-anywhere">{estimate.judge_model}</span> : "Model"}{" "}
          scores every answer ({formatCount(estimate.judge_calls, "judge call")}), charged to the OpenRouter key.
          {estimate.cost_usd === null ? " A price is not listed (see the notes), so the total cannot be estimated." : ""}
        </p>
      </div>
    </div>
  );
}

interface ShownEstimate {
  /** Exactly what was estimated; the run is started with the same suite and limit. */
  request: EvalEstimateIn;
  result: EvalEstimateOut;
}

function EstimatePanel({
  shown,
  active,
  disabled,
  error,
  onRun,
}: {
  shown: ShownEstimate;
  active: boolean;
  disabled: boolean;
  error: string | null;
  onRun: () => void;
}) {
  const { estimates, total_usd: total } = shown.result;
  const qa = estimates.find((item) => item.suite === "qa");
  const notes = estimates.flatMap((item) => item.notes.map((note) => ({ suite: item.suite, note })));
  const sum = (pick: (item: SuiteEstimateOut) => number) => estimates.reduce((acc, item) => acc + pick(item), 0);

  return (
    <section aria-label="Estimate" className="space-y-4 rounded-xl border bg-card p-4">
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
        >
          <OctagonXIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium text-destructive wrap-anywhere">Nothing was started: {error}</p>
            <p className="text-muted-foreground">The estimate below was fetched again. Review it, then confirm again.</p>
          </div>
        </div>
      ) : null}

      {qa ? <JudgeCost estimate={qa} /> : null}

      <Table className="text-xs sm:text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-normal">Suite</TableHead>
            <TableHead className="text-right whitespace-normal">Cases</TableHead>
            <TableHead className="text-right whitespace-normal">Model calls</TableHead>
            <TableHead className="text-right whitespace-normal">Judge calls</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {estimates.map((item) => (
            <TableRow key={item.suite}>
              <TableCell className="min-w-28 whitespace-normal">
                <div className="font-medium">{suiteLabel(item.suite)}</div>
                {item.judge_model ? (
                  <div className="text-xs text-muted-foreground wrap-anywhere">
                    judge <span className="font-mono">{item.judge_model}</span>
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(item.cases)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(item.model_calls)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(item.judge_calls)}</TableCell>
              <TableCell
                className={cn(
                  "text-right font-medium tabular-nums",
                  item.suite === "qa" && item.cost_usd !== 0 && "text-warning",
                )}
              >
                {item.cost_usd === null ? "unknown" : formatCost(item.cost_usd)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {estimates.length > 1 ? (
          <TableFooter>
            <TableRow>
              <TableCell>Total</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(sum((item) => item.cases))}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(sum((item) => item.model_calls))}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(sum((item) => item.judge_calls))}</TableCell>
              <TableCell className="text-right tabular-nums">{total === null ? "unknown" : formatCost(total)}</TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>

      {notes.length > 0 ? (
        <ul aria-label="Notes" className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {notes.map(({ suite, note }, index) => (
            <li key={`${suite}:${index}`} className="wrap-anywhere">
              <span className="font-medium text-foreground/80">{suiteLabel(suite)}:</span> {note}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm">
            Total:{" "}
            <strong className="text-base tabular-nums">{total === null ? "unknown" : formatCost(total)}</strong>
          </p>
          <p className="max-w-prose text-xs text-muted-foreground">
            At OpenRouter's listed prices; local Models cost nothing. If the estimate moves by more than 10 % (or
            $0.01) before the run starts, nothing runs and you review it again.
          </p>
        </div>
        <Button onClick={onRun} disabled={disabled} className="shrink-0">
          <PlayIcon aria-hidden="true" />
          {runButtonLabel(total)}
        </Button>
      </div>
      {active ? (
        <p className="text-xs text-muted-foreground">A run is queued or running; start the next one when it has finished.</p>
      ) : null}
    </section>
  );
}

function NewRunSection({ active }: { active: boolean }) {
  const [suite, setSuite] = useState<EvalSuite>("all");
  const [limit, setLimit] = useState("");
  const [limitError, setLimitError] = useState<string | null>(null);
  const [shown, setShown] = useState<ShownEstimate | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const estimate = useEvalEstimate();
  const start = useStartEvalRuns();
  // Counts estimate requests, so an answer to an older one never replaces a newer state.
  const latest = useRef(0);
  const id = useId();

  /** The form changed: what was shown no longer matches it. */
  function forget() {
    latest.current += 1;
    setShown(null);
    setRunError(null);
    estimate.reset();
  }

  function requestEstimate(request: EvalEstimateIn) {
    latest.current += 1;
    const ticket = latest.current;
    estimate.mutate(request, {
      onSuccess: (result) => {
        if (ticket === latest.current) setShown({ request, result });
      },
    });
  }

  function onEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCaseLimit(limit);
    if (!parsed.ok) {
      setLimitError(parsed.error);
      return;
    }
    setLimitError(null);
    setRunError(null);
    requestEstimate(parsed.value === null ? { suite } : { suite, limit: parsed.value });
  }

  function onRun() {
    if (!shown) return;
    const { request, result } = shown;
    setRunError(null);
    start.mutate(
      { ...request, confirm_cost_usd: result.total_usd },
      {
        onSuccess: (runs) => {
          latest.current += 1;
          setShown(null);
          toast.success(
            runs.length === 1
              ? `The ${suiteLabel(runs[0].suite)} run is queued.`
              : `${runs.length} runs are queued: ${runs.map((run) => run.suite).join(", ")}.`,
          );
        },
        onError: (err) => {
          setRunError(errorMessage(err));
          // The estimate changed, or another run started: show what is current before anything runs.
          if (err instanceof ApiError && err.status === 409) requestEstimate(request);
        },
      },
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div>
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          New run
        </h3>
        <p className="text-sm text-muted-foreground">
          Estimate first: nothing runs until you confirm the cost. A run takes minutes; the list below follows it.
        </p>
      </div>
      <form onSubmit={onEstimate} noValidate className="space-y-3 rounded-xl border bg-card p-4">
        {/* Fields are flex columns: inside a form, Radix Select adds a hidden native select after the
            trigger, and space-y would give the trigger a bottom margin that misaligns the row. */}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,11rem)_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-suite`}>Suite</Label>
            <Select
              value={suite}
              onValueChange={(value) => {
                setSuite(value as EvalSuite);
                forget();
              }}
            >
              <SelectTrigger id={`${id}-suite`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="all">{suiteLabel("all")}</SelectItem>
                {SUITES.map((name) => (
                  <SelectItem key={name} value={name}>
                    {suiteLabel(name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-limit`}>
              First N cases <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`${id}-limit`}
              type="number"
              inputMode="numeric"
              min={1}
              max={EVAL_LIMIT_MAX}
              step={1}
              placeholder="Every case"
              value={limit}
              onChange={(event) => {
                setLimit(event.target.value);
                setLimitError(null);
                forget();
              }}
              aria-describedby={`${id}-limit-hint`}
              aria-invalid={limitError ? true : undefined}
            />
          </div>
          <Button type="submit" variant="outline" disabled={estimate.isPending} className="sm:justify-self-start">
            <CalculatorIcon aria-hidden="true" />
            {estimate.isPending ? "Estimating…" : "Estimate"}
          </Button>
        </div>
        <p id={`${id}-limit-hint`} className="text-xs text-muted-foreground">
          The limit applies to qa and tool; guard always runs every case.
        </p>
        {limitError ? (
          <p role="alert" className="text-sm text-destructive">
            {limitError}
          </p>
        ) : null}
        <SuiteCosts suite={suite} label="What the chosen suites cost" />
        {estimate.isError ? (
          <p role="alert" className="text-sm text-destructive">
            The estimate failed: {errorMessage(estimate.error)}
          </p>
        ) : null}
      </form>

      {shown ? (
        <EstimatePanel
          shown={shown}
          active={active}
          disabled={active || start.isPending || estimate.isPending}
          error={runError}
          onRun={onRun}
        />
      ) : runError ? (
        <p role="alert" className="text-sm text-destructive">
          Nothing was started: {runError}
        </p>
      ) : null}
    </section>
  );
}

function RunRow({ run, now, onOpen }: { run: EvalRunOut; now: number; onOpen: (id: string) => void }) {
  const duration = runDuration(run);
  return (
    <li
      aria-label={`${suiteLabel(run.suite)} run, ${runStatusLabel(run.status)}`}
      className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="font-medium">{suiteLabel(run.suite)}</h4>
          <RunStatusBadge status={run.status} />
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span title={formatDateTime(run.created_at)}>
            {run.started_by ? `Started by ${run.started_by}` : "Started from the command line"}{" "}
            {formatRelativeTime(run.created_at, now)}
          </span>
          {duration ? <span>took {duration}</span> : null}
          <span>{runCasesText(run)}</span>
          {run.judge_model ? (
            <span className="wrap-anywhere">
              judge <span className="font-mono">{run.judge_model}</span>
            </span>
          ) : null}
        </p>
        <p className="text-xs">
          <span className="text-muted-foreground">Cost </span>
          <RunCost run={run} />
        </p>
        <MetricSummary run={run} />
        {run.status === "failed" && run.error ? (
          <p className="text-xs text-destructive wrap-anywhere">{run.error}</p>
        ) : null}
      </div>
      <Button variant="outline" size="sm" className="shrink-0 self-start" onClick={() => onOpen(run.id)}>
        {run.status === "done" ? "Report" : "Details"}
      </Button>
    </li>
  );
}

function RunsSection({
  runs,
  onOpen,
}: {
  runs: ReturnType<typeof useEvalRuns>;
  onOpen: (id: string) => void;
}) {
  const now = useNow(30_000);
  const headingId = useId();
  const active = runs.data?.some(isActiveRun) ?? false;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-sm font-semibold">
          Runs
        </h3>
        {active ? (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Checking every {EVAL_POLL_MS / 1000} seconds while a run is queued or running
          </span>
        ) : null}
      </div>
      {runs.isPending ? (
        <LoadingRows label="Loading the runs" />
      ) : runs.isError ? (
        <LoadError error={runs.error} onRetry={() => void runs.refetch()} />
      ) : runs.data.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No runs yet. Estimate one above, or run <code className="font-mono text-xs">rampart eval</code> on the server.
        </p>
      ) : (
        <ul aria-label="Evaluation runs" className="divide-y rounded-xl border bg-card">
          {runs.data.map((run) => (
            <RunRow key={run.id} run={run} now={now} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CaseRow({
  item,
  now,
  onDelete,
}: {
  item: EvaluationCaseOut;
  now: number;
  onDelete: (item: EvaluationCaseOut) => void;
}) {
  return (
    <li
      aria-label={`Evaluation Case ${shortId(item.id)}`}
      className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="outline" className="font-mono font-normal">
            {item.kind}
          </Badge>
          <span className="text-xs font-medium">{caseKindLabel(item.kind)}</span>
          <span className="font-mono text-xs text-muted-foreground" title={item.id}>
            Case {shortId(item.id)}
          </span>
        </div>
        <p className="line-clamp-3 text-sm whitespace-pre-wrap wrap-anywhere">{item.question}</p>
        {item.kind === "qa" ? (
          <p className="line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground wrap-anywhere">
            <span className="font-medium text-foreground/80">Expected answer: </span>
            {item.expected_answer ?? "—"}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground wrap-anywhere">
            <span className="font-medium text-foreground/80">Expected Tools: </span>
            {(item.expected_tools ?? []).map((name) => toolLabel(name)).join(", ") || "—"}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          <span title={item.source}>{caseSourceLabel(item.source)}</span>
          {" · "}
          <span title={formatDateTime(item.created_at)}>
            added {item.created_by ? `by ${item.created_by} ` : ""}
            {formatRelativeTime(item.created_at, now)}
          </span>
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 self-start text-destructive hover:text-destructive"
        aria-label={`Delete Evaluation Case ${shortId(item.id)}`}
        onClick={() => onDelete(item)}
      >
        <Trash2Icon aria-hidden="true" />
        Delete
      </Button>
    </li>
  );
}

function CasesSection() {
  const cases = useEvaluationCases();
  const remove = useDeleteEvaluationCase();
  const [confirming, setConfirming] = useState<EvaluationCaseOut | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const headingId = useId();

  function confirmDelete() {
    if (!confirming) return;
    const target = confirming;
    remove.mutate(target.id, {
      onSuccess: () => {
        setConfirming(null);
        toast.success(`Evaluation Case ${shortId(target.id)} deleted. Its Feedback stays.`);
      },
      onError: (err) => setError(errorMessage(err)),
    });
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div>
        <h3 id={headingId} className="text-sm font-semibold">
          Added Evaluation Cases
        </h3>
        <p className="text-sm text-muted-foreground">
          Cases admins made from answers on the Feedback tab. Each joins the next run of its suite; reports name them
          by id only.
        </p>
      </div>
      {cases.isPending ? (
        <LoadingRows rows={2} label="Loading the added cases" />
      ) : cases.isError ? (
        <LoadError error={cases.error} onRetry={() => void cases.refetch()} />
      ) : cases.data.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No cases added yet. Make one from an answer on the Feedback tab.
        </p>
      ) : (
        <ul aria-label="Added Evaluation Cases" className="divide-y rounded-xl border bg-card">
          {cases.data.map((item) => (
            <CaseRow
              key={item.id}
              item={item}
              now={now}
              onDelete={(target) => {
                setError(null);
                setConfirming(target);
              }}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Delete this Evaluation Case?"
        description="It leaves the next evaluation runs. The Feedback it came from stays, and can be made into a case again."
        error={error}
        confirmLabel="Delete the case"
        destructive
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
    </section>
  );
}

/**
 * The evaluation (M6): dataset sizes, a run that starts only after its cost
 * estimate is confirmed, the runs with their metrics and reports (polled while
 * one is active), and the cases added from Feedback. The open run is kept in
 * the URL (`?run=<id>`).
 */
export function EvaluationTab() {
  const runs = useEvalRuns();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("run");
  const selected = runs.data?.find((run) => run.id === selectedId) ?? null;
  const active = runs.data?.some(isActiveRun) ?? false;

  function select(id: string | null) {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id) next.set("run", id);
        else next.delete("run");
        return next;
      },
      { replace: true },
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Evaluation</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Rampart's evaluation suites run on a snapshot of the database and the vector store, in a separate process on
          the server, so they never add Conversations or usage to the real data. Each run writes a Markdown and a JSON
          report. Answer quality (qa) costs real money, Tool choice (tool) a little, Input Guard (guard) nothing.
        </p>
      </section>
      <DatasetsSection />
      <NewRunSection active={active} />
      <RunsSection runs={runs} onOpen={select} />
      <CasesSection />
      <EvalRunDetailDialog runId={selectedId} summary={selected} onClose={() => select(null)} />
    </div>
  );
}
