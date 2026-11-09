import {
  BanIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FileTextIcon,
  FlaskConicalIcon,
  HourglassIcon,
  LoaderCircleIcon,
  PackageSearchIcon,
  PuzzleIcon,
  ScanTextIcon,
  SearchIcon,
  ShieldXIcon,
  TriangleAlertIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import { JsonBlock } from "@/components/common/JsonBlock";
import { PluginBadge } from "@/components/common/PluginBadge";
import { InjectionResult } from "@/components/conversation/InjectionResult";
import {
  argumentSummary,
  reasonLabel,
  resultSourceLabel,
  toolCallState,
  toolLabel,
  toolPluginId,
  toolShortLabel,
  type ToolCallState,
} from "@/lib/tools";
import type { ToolCallOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<string, LucideIcon> = {
  search_knowledge: SearchIcon,
  analyze_prompt: ScanTextIcon,
  lookup_vulnerabilities: PackageSearchIcon,
  generate_report: FileTextIcon,
  run_injection_test: FlaskConicalIcon,
};

const STATES: Record<ToolCallState, { label: string; Icon: LucideIcon; className: string }> = {
  running: { label: "Running", Icon: LoaderCircleIcon, className: "border-primary/30 bg-primary/10 text-primary" },
  allowed: { label: "Allowed", Icon: CircleCheckIcon, className: "border-success/30 bg-success/10 text-success" },
  denied: { label: "Denied", Icon: ShieldXIcon, className: "border-destructive/30 bg-destructive/10 text-destructive" },
  waiting: { label: "Waiting for approval", Icon: HourglassIcon, className: "border-warning/40 bg-warning/10 text-warning" },
  rejected: { label: "Rejected", Icon: BanIcon, className: "border-border bg-muted text-muted-foreground" },
  error: { label: "Error", Icon: TriangleAlertIcon, className: "border-destructive/30 bg-destructive/10 text-destructive" },
  unfinished: { label: "No result", Icon: CircleDashedIcon, className: "border-border bg-muted text-muted-foreground" },
};

export function ToolStateBadge({ state }: { state: ToolCallState }) {
  const { label, Icon, className } = STATES[state];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn("size-3", state === "running" && "animate-spin")} />
      {label}
    </span>
  );
}

/** What the Gateway said, for the states where it matters: "Rate limit reached: ...". */
function GatewayLine({ call }: { call: ToolCallOut }) {
  const reason = call.reason_code ? reasonLabel(call.reason_code) : null;
  const message = call.message ?? call.summary;
  if (!reason && !message) return null;
  return (
    <p className="text-sm">
      {reason ? <span className="font-medium">{reason}</span> : null}
      {reason && message ? ": " : null}
      {message ? <span className="text-muted-foreground">{message}</span> : null}
    </p>
  );
}

/**
 * One Tool call of an answer: name, key arguments, the Gateway's decision and
 * the result. A Plugin Tool (M5) shows its Plugin, and its result reads as
 * untrusted Plugin output.
 */
export function ToolCallCard({ call, live = false }: { call: ToolCallOut; live?: boolean }) {
  const state = toolCallState(call, live);
  const pluginId = toolPluginId(call.tool, call.contributed_by);
  const label = toolLabel(call.tool, call.contributed_by);
  const Icon = pluginId ? PuzzleIcon : (TOOL_ICONS[call.tool] ?? WrenchIcon);
  const args = call.arguments ?? {};
  const summaryLine = argumentSummary(args);
  const hasArguments = Object.keys(args).length > 0;

  return (
    <article
      aria-label={`Tool call: ${label}`}
      className="space-y-2 rounded-lg border bg-card px-3 py-2.5 text-sm"
      data-state={state}
    >
      <header className="flex min-w-0 items-start gap-2.5">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 font-medium wrap-anywhere">{pluginId ? toolShortLabel(call.tool) : label}</h3>
            {pluginId ? <PluginBadge pluginId={pluginId} /> : null}
            <ToolStateBadge state={state} />
          </div>
          {summaryLine ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{summaryLine}</p> : null}
        </div>
      </header>

      <div className="space-y-1 pl-6.5">
        {state === "denied" || state === "rejected" ? <GatewayLine call={call} /> : null}
        {state === "waiting" ? (
          <p className="text-sm text-muted-foreground">Runs only once it is approved.</p>
        ) : null}
        {state === "allowed" && call.reason_code === "approved" ? (
          <p className="text-xs text-muted-foreground">Ran after approval.</p>
        ) : null}
        {(state === "allowed" || state === "error") && call.tool === "run_injection_test" ? (
          <InjectionResult call={call} error={state === "error"} />
        ) : (state === "allowed" || state === "error") && call.summary ? (
          <p className={cn("text-sm wrap-anywhere", state === "error" && "text-destructive")}>{call.summary}</p>
        ) : null}
        {state === "allowed" && call.provenance ? (
          <p className="text-xs text-muted-foreground">Result from: {resultSourceLabel(call.provenance, pluginId)}</p>
        ) : null}
        {call.report_id ? (
          <p>
            <Link
              to={`/reports/${encodeURIComponent(call.report_id)}`}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary underline decoration-primary/40 underline-offset-3 hover:decoration-primary"
            >
              <FileTextIcon aria-hidden="true" className="size-3.5" />
              Open the report
            </Link>
          </p>
        ) : null}
        {hasArguments ? (
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon aria-hidden="true" className="size-3 transition-transform group-open:rotate-90" />
              Arguments
            </summary>
            <JsonBlock value={args} label={`Arguments of ${label}`} className="mt-1.5" />
          </details>
        ) : null}
      </div>
    </article>
  );
}

/** The Tool calls of an answer, in order. */
export function ToolCallList({ calls, live = false }: { calls: readonly ToolCallOut[]; live?: boolean }) {
  if (calls.length === 0) return null;
  return (
    <div className="space-y-2">
      {calls.map((call) => (
        <ToolCallCard key={call.id} call={call} live={live} />
      ))}
    </div>
  );
}
