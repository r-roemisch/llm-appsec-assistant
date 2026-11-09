import { SecurityBadge } from "@/components/common/SecurityBadge";
import { injectionVerdict } from "@/lib/injection";
import type { ToolCallOut } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The readable result of a `run_injection_test` call. The contract only gives
 * the client the summary line ("verdict + N of M reached the sink") and the
 * status, so this shows a verdict badge parsed from the summary and the summary
 * itself; the per-case breakdown lives in the Report and the audit log.
 */
export function InjectionResult({ call, error }: { call: ToolCallOut; error: boolean }) {
  const verdict = injectionVerdict(call.summary);

  // An error (or a summary without a verdict word): just the summary line.
  if (!verdict) {
    return call.summary ? <p className={cn("text-sm", error && "text-destructive")}>{call.summary}</p> : null;
  }

  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border p-2.5",
        verdict === "secure" ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SecurityBadge value={verdict} />
        <span className="text-sm font-medium">
          {verdict === "secure" ? "The suite did not breach this Target." : "The suite breached this Target."}
        </span>
      </div>
      {call.summary ? <p className="text-sm text-muted-foreground">{call.summary}</p> : null}
      <p className="text-xs text-muted-foreground">
        The per-case breakdown is saved to the audit log and included in a report when one is generated.
      </p>
    </div>
  );
}
