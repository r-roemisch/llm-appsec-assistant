// Plugins as the admin page shows them (docs/API.md, M5): status badges and
// explanations, what an admin can do in each state, blocked Plugin Tools in
// words, and a small diff for reviewing changed Tool definitions. Everything a
// Plugin's server sends (titles, descriptions, schemas) is untrusted: callers
// render it as plain text or preformatted JSON, never as Markdown or HTML.

import { formatCount } from "@/lib/format";
import { humanize } from "@/lib/tools";
import type {
  PluginBlock,
  PluginDefinitionField,
  PluginDetailOut,
  PluginOut,
  PluginStatus,
  PluginToolOut,
} from "@/lib/types";

export type StatusTone = "success" | "warning" | "destructive" | "neutral";

const STATUSES: Record<PluginStatus, { label: string; tone: StatusTone }> = {
  ok: { label: "Accepted", tone: "success" },
  pending_review: { label: "Needs review", tone: "warning" },
  drifted: { label: "Drifted, blocked", tone: "destructive" },
  error: { label: "Listing failed", tone: "destructive" },
  new: { label: "Not listed yet", tone: "neutral" },
  missing: { label: "Not in catalog", tone: "neutral" },
  invalid: { label: "Invalid entry", tone: "neutral" },
};

export function pluginStatusLabel(status: PluginStatus): string {
  return STATUSES[status]?.label ?? humanize(status);
}

export function pluginStatusTone(status: PluginStatus): StatusTone {
  return STATUSES[status]?.tone ?? "neutral";
}

/** What the status means for the admin right now, in one or two sentences. */
export function pluginStatusExplanation(plugin: PluginOut): string {
  switch (plugin.status) {
    case "new":
      return "Not listed yet. Enable the Plugin, or refresh it, to start its server and list its Tools; nothing is offered to the Model until you accept them.";
    case "pending_review":
      return "Listed but never accepted, so none of its Tools is offered. Review the definitions and their warnings, then accept them.";
    case "ok":
      return plugin.enabled
        ? "The last listing matches the accepted definitions. Its Tools can be used once they are enabled on the Tools tab."
        : "The last listing matches the accepted definitions, but the Plugin is disabled, so its Tools are blocked.";
    case "drifted":
      return "The last listing differs from the definitions you accepted, so the Plugin's Tools are blocked. Review the changes and accept again to unblock them.";
    case "error":
      return "The last listing failed. Definitions accepted earlier stay as they were.";
    case "missing":
      return "No longer in plugins/catalog.yaml, so its Tools are blocked. Only the catalog file on the server can bring it back.";
    case "invalid":
      return "The catalog entry is invalid, so the Plugin cannot be started. Fix it in plugins/catalog.yaml on the server.";
    default:
      return "";
  }
}

/** Refreshing and enabling start the server, which needs a valid catalog entry. */
export function canStart(plugin: PluginOut): boolean {
  return plugin.in_catalog && plugin.status !== "missing" && plugin.status !== "invalid";
}

/**
 * Accepting makes sense only for a listing that differs from what is accepted:
 * a first review (pending_review) or drift.
 */
export function canAccept(plugin: PluginOut): boolean {
  return (
    (plugin.status === "pending_review" || plugin.status === "drifted") &&
    plugin.current_tools_digest !== null &&
    plugin.current_tools_digest !== plugin.accepted_tools_digest
  );
}

/** Plugins whose definitions wait for an admin: a first review or drift. */
export function needsReview(plugin: PluginOut): boolean {
  return plugin.status === "pending_review" || plugin.status === "drifted";
}

/** The accepted definitions are worth showing next to the listing only when they differ from it. */
export function acceptedDiffers(plugin: PluginOut): boolean {
  return plugin.accepted_tools_digest !== null && plugin.accepted_tools_digest !== plugin.current_tools_digest;
}

/** Why the Accept button is (not) offered, under it. */
export function acceptHint(plugin: PluginOut): string {
  if (canAccept(plugin)) {
    return plugin.status === "drifted"
      ? "Accept only after reviewing the changes and the definitions above."
      : "Accept only after reviewing every definition and warning above.";
  }
  switch (plugin.status) {
    case "ok":
      return "Nothing to accept: the last listing matches the accepted definitions.";
    case "new":
      return "Nothing to accept yet: list the Tools first.";
    case "error":
      return plugin.current_tools_digest
        ? "Nothing new to accept: the last listing failed."
        : "Nothing to accept yet: no listing has succeeded.";
    case "missing":
      return "Nothing can be accepted while the Plugin is not in the catalog.";
    case "invalid":
      return "Nothing can be accepted while the catalog entry is invalid.";
    default:
      return "Nothing to accept.";
  }
}

export interface PluginMessage {
  tone: "success" | "info" | "warning" | "error";
  text: string;
}

/** What a fresh listing (after enabling or refreshing) found, for a toast. */
export function listingMessage(plugin: PluginOut): PluginMessage {
  const tools = formatCount(plugin.tool_count, "Tool");
  switch (plugin.status) {
    case "error":
      return { tone: "error", text: `Listing its Tools failed${plugin.last_error ? `: ${plugin.last_error}` : "."}` };
    case "pending_review":
      return { tone: "info", text: `Listed ${tools}. None is offered until you review and accept the definitions.` };
    case "drifted":
      return {
        tone: "warning",
        text: "Its Tool definitions changed since they were accepted, so its Tools are blocked until you review and accept again.",
      };
    case "ok":
      return { tone: "success", text: `Listed ${tools}, matching the accepted definitions.` };
    default:
      return { tone: "info", text: pluginStatusExplanation(plugin) };
  }
}

/** The catalog entry of a detail, for the list. */
export function summaryOf(detail: PluginDetailOut): PluginOut {
  const { current_tools, accepted_tools, changes, ...plugin } = detail;
  return plugin;
}

/** "3f9a1c0be41d…" for a sha256; the full digest goes in a title. */
export function shortDigest(digest: string | null): string {
  if (!digest) return "—";
  return digest.length > 12 ? `${digest.slice(0, 12)}…` : digest;
}

export function warningCount(tools: readonly PluginToolOut[]): number {
  return tools.reduce((total, tool) => total + tool.warnings.length, 0);
}

/** Definitions that cannot be offered to a Model (bad name or schema). */
export function unusableTools(tools: readonly PluginToolOut[]): PluginToolOut[] {
  return tools.filter((tool) => tool.exposed_name === null);
}

const BLOCKS: Record<PluginBlock, { label: string; hint: string }> = {
  plugin_disabled: {
    label: "Blocked: Plugin disabled",
    hint: "Enable the Plugin on the Plugins tab; this switch alone does not unblock it.",
  },
  plugin_drift: {
    label: "Blocked: definitions changed",
    hint: "Review and accept the Plugin's changed definitions on the Plugins tab; this switch alone does not unblock it.",
  },
  plugin_missing: {
    label: "Blocked: not in catalog",
    hint: "The Plugin is no longer in plugins/catalog.yaml (or its entry is invalid); this switch alone does not unblock it.",
  },
};

/** Why a Plugin Tool cannot be used, and that its own switch does not change that. */
export function blockedText(block: string): { label: string; hint: string } {
  return (
    BLOCKS[block as PluginBlock] ?? {
      label: `Blocked: ${humanize(block).toLowerCase()}`,
      hint: "Check the Plugin on the Plugins tab; this switch alone does not unblock it.",
    }
  );
}

const FIELD_LABELS: Record<PluginDefinitionField, string> = {
  name: "Name",
  title: "Title",
  description: "Description",
  input_schema: "Input schema",
  output_schema: "Output schema",
  annotations: "Annotations",
};

export function definitionFieldLabel(field: string): string {
  return FIELD_LABELS[field as PluginDefinitionField] ?? humanize(field);
}

/** Schemas and annotations compare as JSON, line by line; the rest as text, word by word. */
export function isJsonField(field: string): boolean {
  return field === "input_schema" || field === "output_schema" || field === "annotations";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** Pretty JSON with sorted keys, so two versions differ only where their content does. */
export function stableJson(value: unknown): string {
  try {
    return JSON.stringify(sortKeys(value), null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One field of a definition as the diff compares it; "" when the field is empty or the Tool is absent. */
export function definitionFieldText(tool: PluginToolOut | undefined, field: string): string {
  if (!tool) return "";
  switch (field) {
    case "name":
      return tool.name;
    case "title":
      return tool.title ?? "";
    case "description":
      return tool.description;
    case "input_schema":
      return stableJson(tool.input_schema);
    case "output_schema":
      return tool.output_schema === null ? "" : stableJson(tool.output_schema);
    case "annotations":
      return tool.annotations === null ? "" : stableJson(tool.annotations);
    default:
      return "";
  }
}

export function findTool(tools: readonly PluginToolOut[], name: string): PluginToolOut | undefined {
  return tools.find((tool) => tool.name === name);
}

/** A run of text that is the same on both sides, or only on this side. */
export interface DiffPart {
  text: string;
  changed: boolean;
}

export interface Diff {
  before: DiffPart[];
  after: DiffPart[];
}

/** Past this many comparisons the middle is marked changed as a whole instead of compared token by token. */
const MAX_CELLS = 250_000;

function push(parts: DiffPart[], text: string, changed: boolean) {
  if (!text) return;
  const last = parts.at(-1);
  if (last && last.changed === changed) last.text += text;
  else parts.push({ text, changed });
}

/** Whitespace kept between two changes reads as part of the change, not as a match. */
function coalesce(parts: DiffPart[]): DiffPart[] {
  const result: DiffPart[] = [];
  parts.forEach((part, index) => {
    const between = !part.changed && /^\s+$/.test(part.text) && parts[index - 1]?.changed && parts[index + 1]?.changed;
    push(result, part.text, part.changed || Boolean(between));
  });
  return result;
}

/** A longest-common-subsequence diff of two token lists. */
export function diffTokens(before: readonly string[], after: readonly string[]): Diff {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  const prefix = before.slice(0, start).join("");
  const suffix = before.slice(endBefore).join("");
  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  push(left, prefix, false);
  push(right, prefix, false);

  if (a.length * b.length > MAX_CELLS) {
    push(left, a.join(""), true);
    push(right, b.join(""), true);
  } else {
    // lengths[i][j]: the longest common subsequence of a[i..] and b[j..].
    const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        push(left, a[i], false);
        push(right, b[j], false);
        i += 1;
        j += 1;
      } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
        push(left, a[i], true);
        i += 1;
      } else {
        push(right, b[j], true);
        j += 1;
      }
    }
    for (; i < a.length; i += 1) push(left, a[i], true);
    for (; j < b.length; j += 1) push(right, b[j], true);
  }

  push(left, suffix, false);
  push(right, suffix, false);
  return { before: coalesce(left), after: coalesce(right) };
}

/** Words and the whitespace between them; joined they give the text back. */
function words(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/** Lines with their line breaks; joined they give the text back. */
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Text compared word by word. */
export function diffText(before: string, after: string): Diff {
  return diffTokens(words(before), words(after));
}

/** JSON (or any multi-line text) compared line by line. */
export function diffLines(before: string, after: string): Diff {
  return diffTokens(lines(before), lines(after));
}

/** The before/after of one changed field of a Tool definition. */
export function diffField(before: PluginToolOut | undefined, after: PluginToolOut | undefined, field: string): Diff {
  const left = definitionFieldText(before, field);
  const right = definitionFieldText(after, field);
  return isJsonField(field) ? diffLines(left, right) : diffText(left, right);
}
