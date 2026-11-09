// Evaluation runs as the admin page shows them (docs/API.md, M6): suite names
// and what each costs, run states and polling, the confirm button after an
// estimate, and compact metric summaries. A qa run costs real money (Rampart
// answers every question and a judge Model scores every answer), tool costs a
// little (Rampart's own Model calls) and guard is free (deterministic).

import { formatCount, formatNumber } from "@/lib/format";
import { humanize } from "@/lib/tools";
import type {
  DeepEvalMetricSummary,
  EvalRunOut,
  EvalRunStatus,
  EvalSuite,
  EvalSuiteName,
  GuardRunMetrics,
  GuardSetMetrics,
} from "@/lib/types";

/** How often the runs are fetched again while one is queued or running. */
export const EVAL_POLL_MS = 3000;
/** The server's cap on "first N cases". */
export const EVAL_LIMIT_MAX = 500;

export const SUITES: readonly EvalSuiteName[] = ["qa", "tool", "guard"];

const SUITE_NAMES: Record<EvalSuiteName, string> = {
  qa: "Answer quality",
  tool: "Tool choice",
  guard: "Input Guard",
};

/** "Answer quality"; unknown suites are humanized. */
export function suiteName(suite: string): string {
  return SUITE_NAMES[suite as EvalSuiteName] ?? humanize(suite);
}

/** "Answer quality (qa)", or "All suites". */
export function suiteLabel(suite: EvalSuite | string): string {
  if (suite === "all") return "All suites";
  return `${suiteName(suite)} (${suite})`;
}

export type SuiteCost = "money" | "little" | "free";

/** What running each suite costs, in one sentence. */
export const SUITE_COSTS: Record<EvalSuiteName, { cost: SuiteCost; text: string }> = {
  qa: {
    cost: "money",
    text: "Costs real money: Rampart answers every question and a judge Model scores every answer.",
  },
  tool: { cost: "little", text: "Costs a little: Rampart's own Model calls. The Tool check itself needs no judge." },
  guard: { cost: "free", text: "Free: the input Guard's rules run locally and no Model is called." },
};

/** The suites a choice covers. */
export function suitesOf(suite: EvalSuite): readonly EvalSuiteName[] {
  return suite === "all" ? SUITES : [suite];
}

export function isActiveRun(run: Pick<EvalRunOut, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

/** Poll every few seconds while a run is queued or running; stop once all are done or failed. */
export function runsPollInterval(runs: readonly Pick<EvalRunOut, "status">[] | undefined): number | false {
  return runs?.some(isActiveRun) ? EVAL_POLL_MS : false;
}

export type RunTone = "progress" | "success" | "destructive";

const STATUSES: Record<EvalRunStatus, { label: string; tone: RunTone }> = {
  queued: { label: "Queued", tone: "progress" },
  running: { label: "Running", tone: "progress" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
};

export function runStatusLabel(status: EvalRunStatus): string {
  return STATUSES[status]?.label ?? humanize(status);
}

export function runStatusTone(status: EvalRunStatus): RunTone {
  return STATUSES[status]?.tone ?? "progress";
}

export type LimitResult = { ok: true; value: number | null } | { ok: false; error: string };

/** "first N cases": empty means every case; otherwise a whole number from 1 to 500. */
export function parseCaseLimit(text: string): LimitResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > EVAL_LIMIT_MAX) {
    return {
      ok: false,
      error: `Enter a whole number of cases from 1 to ${formatNumber(EVAL_LIMIT_MAX)}, or leave it empty for every case.`,
    };
  }
  return { ok: true, value: Number(trimmed) };
}

/** Money as a person reads an estimate: "$0.21", "$12.40", "less than $0.01", "$0". */
export function approxCost(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return "less than $0.01";
  return `$${usd.toFixed(2)}`;
}

/** The deliberate confirm button after an estimate. */
export function runButtonLabel(totalUsd: number | null): string {
  if (totalUsd === null) return "Run (cost unknown)";
  if (totalUsd <= 0) return "Run (free)";
  if (totalUsd < 0.01) return "Run for less than $0.01";
  return `Run for about ${approxCost(totalUsd)}`;
}

const METRIC_LABELS: Record<string, string> = {
  faithfulness: "Faithfulness",
  answer_relevancy: "Answer relevancy",
  contextual_precision: "Contextual precision",
  contextual_recall: "Contextual recall",
  tool_correctness: "Tool correctness",
  argument_correctness: "Argument correctness",
  decision_correctness: "Decision correctness",
  unnecessary_calls: "No unnecessary calls",
};
const METRIC_ORDER = Object.keys(METRIC_LABELS);

export function metricLabel(name: string): string {
  return METRIC_LABELS[name] ?? humanize(name);
}

/** A 0 to 1 score with two decimals: "0.92"; an em dash when there is none. */
export function formatScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

/** A ratio as a percentage with one decimal: "96.2%"; an em dash when there is none. */
export function formatRatio(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMetricSummary(value: unknown): value is DeepEvalMetricSummary {
  return isObject(value) && typeof value.passed === "number" && typeof value.total === "number";
}

function isGuardSet(value: unknown): value is GuardSetMetrics {
  return isObject(value) && typeof value.adversarial === "number" && typeof value.benign === "number";
}

/** A guard run's metrics: both labelled sets. */
export function isGuardMetrics(metrics: unknown): metrics is GuardRunMetrics {
  return isObject(metrics) && isGuardSet(metrics.cases) && isGuardSet(metrics.holdout);
}

export interface MetricLine {
  label: string;
  value: string;
  /** The denominators and anything that did not count. */
  detail: string | null;
}

function leftOut(metric: DeepEvalMetricSummary): string[] {
  const parts: string[] = [];
  if (metric.skipped > 0) parts.push(`${formatNumber(metric.skipped)} skipped`);
  if (metric.errors > 0) parts.push(formatCount(metric.errors, "judge error"));
  return parts;
}

/** The labelled sets of a guard run, in the order the report lists them. */
export const GUARD_SETS = [
  { key: "cases", label: "Written set", hint: "guard_cases.jsonl, written alongside the rules" },
  { key: "holdout", label: "Held-out set", hint: "guard_holdout.jsonl, never tuned against" },
] as const;

/**
 * A run's metrics in a few lines. qa: each metric's mean with passed/scored;
 * tool: tool correctness passed/total; guard: precision, recall and the
 * false-positive rate (FPR) of both sets. Empty while there are no metrics.
 */
export function metricSummary(run: Pick<EvalRunOut, "suite" | "metrics">): MetricLine[] {
  const metrics: unknown = run.metrics;
  if (!isObject(metrics)) return [];
  if (isGuardMetrics(metrics)) {
    return GUARD_SETS.map(({ key, label }) => {
      const set = metrics[key];
      return {
        label,
        value: `precision ${formatRatio(set.precision)} · recall ${formatRatio(set.recall)} · FPR ${formatRatio(set.false_positive_rate)}`,
        detail: `${formatNumber(set.adversarial)} adversarial, ${formatNumber(set.benign)} benign`,
      };
    });
  }
  const names = Object.keys(metrics)
    .filter((name) => isMetricSummary(metrics[name]))
    .sort((a, b) => {
      const rank = (name: string) => (METRIC_ORDER.includes(name) ? METRIC_ORDER.indexOf(name) : METRIC_ORDER.length);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  return names.map((name) => {
    const metric = metrics[name] as DeepEvalMetricSummary;
    if (run.suite === "tool") {
      const rest = leftOut(metric);
      return {
        label: metricLabel(name),
        value: `${formatNumber(metric.passed)}/${formatNumber(metric.total)} passed`,
        detail: rest.length > 0 ? rest.join(", ") : null,
      };
    }
    return {
      label: metricLabel(name),
      value: formatScore(metric.mean),
      detail: [`${formatNumber(metric.passed)}/${formatNumber(metric.scored)} passed`, ...leftOut(metric)].join(", "),
    };
  });
}

/** A run's length: "45 s", "2 min 13 s", "1 h 5 min". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "3 cases (the first 3)"; the limit applies to qa and tool runs. */
export function runCasesText(run: Pick<EvalRunOut, "case_count" | "case_limit">): string {
  const count = run.case_count === null ? "Cases not counted yet" : formatCount(run.case_count, "case");
  return run.case_limit === null ? count : `${count} (the first ${formatNumber(run.case_limit)})`;
}

/** How long a finished run took; null while it has not finished. */
export function runDuration(run: Pick<EvalRunOut, "created_at" | "finished_at">): string | null {
  if (!run.finished_at) return null;
  const ms = Date.parse(run.finished_at) - Date.parse(run.created_at);
  return Number.isNaN(ms) ? null : formatElapsed(ms);
}
