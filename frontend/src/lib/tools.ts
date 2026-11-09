// Tool calls as the conversation view shows them (docs/API.md, M3): readable
// names, the Gateway's reason codes in words, the visual state of one call,
// and merging the `tool_call` and `tool_result` events of a stream by call id.
// From M5 a Tool can come from a Plugin: its name is "<plugin_id>__<tool>".

import type {
  ApprovalStatus,
  Approver,
  CostClass,
  ToolCallOut,
  ToolDecision,
  TurnToolCallData,
  TurnToolResultData,
} from "@/lib/types";

const TOOL_LABELS: Record<string, string> = {
  search_knowledge: "Search the Knowledge Base",
  analyze_prompt: "Analyze a prompt",
  lookup_vulnerabilities: "Look up known vulnerabilities",
  check_dependencies: "Check all Profile packages",
  generate_report: "Generate a report",
  run_injection_test: "Run an injection test",
};

/** "lookup_vulnerabilities" -> "Lookup vulnerabilities", for names without a label. */
export function humanize(identifier: string): string {
  const words = identifier.replace(/[_\-.:]+/g, " ").trim();
  if (!words) return identifier;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A Plugin Tool's name in its parts (M5): "fixture_docs__read_doc" ->
 * { pluginId: "fixture_docs", tool: "read_doc" }. Built-in names never contain
 * "__", and a Plugin id never does, so the first "__" ends the id. Null for
 * any other name.
 */
export function splitPluginToolName(name: string): { pluginId: string; tool: string } | null {
  const at = name.indexOf("__");
  if (at <= 0 || at + 2 >= name.length) return null;
  return { pluginId: name.slice(0, at), tool: name.slice(at + 2) };
}

/** "plugin:<id>" -> "<id>"; null for "builtin", null and anything else. */
export function pluginIdOf(contributedBy: string | null | undefined): string | null {
  if (typeof contributedBy !== "string" || !contributedBy.startsWith("plugin:")) return null;
  return contributedBy.slice("plugin:".length) || null;
}

/**
 * The Plugin a Tool comes from, or null for a built-in Tool: `contributed_by`
 * when the server sent one, otherwise read from the "<plugin_id>__<tool>" name.
 */
export function toolPluginId(name: string, contributedBy?: string | null): string | null {
  if (contributedBy === "builtin") return null;
  return pluginIdOf(contributedBy) ?? splitPluginToolName(name)?.pluginId ?? null;
}

/** The readable name of a Tool without its Plugin: "fixture_docs__read_doc" -> "Read doc". */
export function toolShortLabel(name: string): string {
  const plugin = splitPluginToolName(name);
  if (plugin) return humanize(plugin.tool);
  return TOOL_LABELS[name] ?? humanize(name);
}

/** The readable name of a Tool; a Plugin Tool names its Plugin: "Read doc (Plugin fixture_docs)". */
export function toolLabel(name: string, contributedBy?: string | null): string {
  const pluginId = toolPluginId(name, contributedBy);
  const label = toolShortLabel(name);
  return pluginId ? `${label} (Plugin ${pluginId})` : label;
}

/** The Tool as a sentence names it: “Run an injection test”, or “Read doc” from Plugin fixture_docs. */
export function toolPhrase(name: string, contributedBy?: string | null): string {
  const pluginId = toolPluginId(name, contributedBy);
  const label = toolShortLabel(name);
  return pluginId ? `“${label}” from Plugin ${pluginId}` : `“${label}”`;
}

const REASON_LABELS: Record<string, string> = {
  allowed: "Allowed by policy",
  approved: "Approved",
  approval_pending: "Waiting for approval",
  unknown_tool: "Unknown tool",
  tool_disabled: "Tool disabled",
  role_forbidden: "Not allowed for this role",
  invalid_arguments: "Invalid arguments",
  turn_limit: "Tool call limit of the turn reached",
  rate_limited: "Rate limit reached",
  conversation_budget: "Conversation budget used up",
  target_not_registered: "Target not registered",
  approval_rejected: "Approval rejected",
  approval_expired: "Approval expired",
  approval_mismatch: "Arguments differ from the approved ones",
  approval_consumed: "Approval already used",
  approval_invalid: "Approval not valid",
  plugin_disabled: "Plugin disabled",
  plugin_drift: "Plugin changed since it was accepted",
  plugin_missing: "Plugin not in the catalog",
};

/** A Gateway reason code in words; unknown codes are humanized. */
export function reasonLabel(code: string): string {
  return REASON_LABELS[code] ?? humanize(code);
}

export function decisionLabel(decision: ToolDecision): string {
  switch (decision) {
    case "allow":
      return "Allowed";
    case "deny":
      return "Denied";
    case "approval_required":
      return "Approval required";
  }
}

export function costClassLabel(costClass: CostClass): string {
  switch (costClass) {
    case "free":
      return "Free";
    case "api":
      return "External API";
    case "model":
      return "Model calls";
    case "heavy":
      return "Heavy";
  }
}

export function approverLabel(approver: Approver): string {
  return approver === "admin" ? "An administrator" : "The requester";
}

export function approvalStatusLabel(status: ApprovalStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "consumed":
      return "Used";
  }
}

const PROVENANCE_LABELS: Record<string, string> = {
  source: "Knowledge Base",
  upload: "Your upload",
  user: "Your input",
  API: "External API",
  system: "Rampart",
  target: "Your target",
  plugin: "Plugin (untrusted output)",
};

/** Where a Tool result came from, in words. */
export function provenanceLabel(provenance: string): string {
  return PROVENANCE_LABELS[provenance] ?? humanize(provenance);
}

/**
 * Where one call's result came from; Plugin output (M5) names its Plugin and
 * reads as untrusted: "Plugin fixture_docs (untrusted output)".
 */
export function resultSourceLabel(provenance: string, pluginId: string | null): string {
  if (provenance === "plugin" && pluginId) return `Plugin ${pluginId} (untrusted output)`;
  return provenanceLabel(provenance);
}

/**
 * The visual state of one call. A call without a result is "running" while
 * its turn streams and "unfinished" afterwards (the turn stopped or failed).
 */
export type ToolCallState = "running" | "allowed" | "denied" | "waiting" | "rejected" | "error" | "unfinished";

export function toolCallState(call: ToolCallOut, live: boolean): ToolCallState {
  switch (call.status) {
    case "ok":
      return "allowed";
    case "error":
      return "error";
    case "denied":
      return "denied";
    case "rejected":
      return "rejected";
    default:
      break;
  }
  if (call.decision === "deny") return "denied";
  if (call.decision === "approval_required") return "waiting";
  // Allowed (or approved after a pause) and no result yet.
  return live ? "running" : "unfinished";
}

export type ToolCallUpdate = Partial<ToolCallOut> & { id: string };

/**
 * The fields one stream event sets on its call, as the server stores them:
 * `tool_call` sets the decision (and "pending" or "denied"), `tool_result` the
 * outcome. Null for data without a call id.
 */
export function toolCallUpdate(
  event: "tool_call" | "tool_result",
  data: Partial<TurnToolCallData> | Partial<TurnToolResultData>,
): ToolCallUpdate | null {
  if (typeof data.id !== "string" || data.id === "") return null;
  if (event === "tool_call") {
    const call = data as Partial<TurnToolCallData>;
    return {
      id: call.id!,
      tool: call.tool,
      arguments: call.arguments,
      decision: call.decision,
      reason_code: call.reason_code,
      message: call.message,
      approval_id: call.approval_id,
      contributed_by: call.contributed_by,
      status: call.decision === "approval_required" ? "pending" : call.decision === "deny" ? "denied" : null,
    };
  }
  const result = data as Partial<TurnToolResultData>;
  return {
    id: result.id!,
    tool: result.tool,
    status: result.status,
    summary: result.summary,
    provenance: result.provenance,
    report_id: result.report_id,
  };
}

const EMPTY_CALL: Omit<ToolCallOut, "id"> = {
  tool: "",
  arguments: {},
  decision: null,
  reason_code: null,
  message: null,
  status: null,
  summary: null,
  provenance: null,
  report_id: null,
  approval_id: null,
  contributed_by: null,
};

/**
 * Merges one update into the calls by id, keeping their order; a new id is
 * appended. Like the server, null and missing values never overwrite.
 */
export function mergeToolCall(calls: readonly ToolCallOut[], update: ToolCallUpdate): ToolCallOut[] {
  const defined = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== null && value !== undefined),
  ) as Partial<ToolCallOut>;
  const index = calls.findIndex((call) => call.id === update.id);
  if (index === -1) return [...calls, { ...EMPTY_CALL, ...defined, id: update.id }];
  const next = [...calls];
  next[index] = { ...calls[index], ...defined };
  return next;
}

/** Up to three short scalar arguments as "key: value", for the line under a Tool name. */
export function argumentSummary(args: Record<string, unknown>, max = 3): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (parts.length >= max) break;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const text = String(value).replace(/\s+/g, " ").trim();
      parts.push(`${key}: ${text.length > 48 ? `${text.slice(0, 47)}…` : text}`);
    }
  }
  return parts.join(" · ");
}

/** Pretty JSON for arguments; values the server shortened stay as they came. */
export function formatArguments(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
