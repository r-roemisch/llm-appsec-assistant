// The injection test as the conversation view shows it (docs/API.md, M4). The
// per-case InjectionRunResult lives in the audit record and the Report, not in
// the tool_result event or (reliably) in MessageOut.tool_calls, so the client
// reads only the summary line the Gateway sends and the verdict word in it.

import type { TargetProfile } from "@/lib/types";

/** A run's verdict, read from the `run_injection_test` summary; null if absent. */
export function injectionVerdict(summary: string | null | undefined): TargetProfile | null {
  if (!summary) return null;
  const text = summary.toLowerCase();
  // "vulnerable" is checked first; it never contains "secure", nor the reverse.
  if (/\bvulnerable\b/.test(text)) return "vulnerable";
  if (/\bsecure\b/.test(text)) return "secure";
  return null;
}
