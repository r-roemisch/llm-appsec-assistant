// What the Guards did during a turn, in plain language (docs/API.md, M3).
// G1 (input) redacts secrets and blocks or flags attack-like messages; G2
// (provenance) flags instructions inside retrieved passages and Tool results;
// G4 (output) redacts secrets from answers and Tool results.

import { splitPluginToolName } from "@/lib/tools";
import type { GuardEventOut } from "@/lib/types";

export interface GuardNotice {
  /** One sentence for people. */
  text: string;
  /** "blocked" when the input guard answered instead of a Model; everything else informs. */
  tone: "info" | "blocked";
  /** The server's detail, shown on request. */
  detail: string;
}

/** Attack categories (G1 and G2 heuristics) as the noun phrase they read as. */
const CATEGORY_PHRASES: Record<string, string> = {
  instruction_override: "an attempt to override instructions",
  prompt_extraction: "a request for hidden instructions",
  role_override: "an attempt to change the assistant's role",
  jailbreak_persona: "a jailbreak persona",
  no_restrictions: "a request to drop restrictions",
  fake_role_tag: "a fake system or assistant tag",
  exfiltration: "an attempt to send data elsewhere",
  tool_abuse: "an attempt to misuse tools",
  encoded_payload: "an encoded payload to follow",
  authority_claim: "a false claim of authority",
  hidden_text: "hidden characters",
  ai_directed_instruction: "instructions aimed at AI assistants",
  injection: "a prompt injection",
};

/** One category, or several comma-separated, as a phrase. */
export function categoryPhrase(category: string): string {
  const phrases = category
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => CATEGORY_PHRASES[part] ?? `suspicious text (${part.replace(/_/g, " ")})`);
  if (phrases.length === 0) return "suspicious text";
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
}

/** Sums counts like "1 openai_key, 2 github_token" or "2 secret(s)" in a detail; null when there are none. */
export function countInDetail(detail: string): number | null {
  let total = 0;
  for (const match of detail.matchAll(/(\d+)\s+[A-Za-z][\w()-]*/g)) total += Number(match[1]);
  return total > 0 ? total : null;
}

function secrets(count: number | null): string {
  if (count === null) return "A secret";
  return `${count} ${count === 1 ? "secret" : "secrets"}`;
}

function removed(count: number | null): string {
  return count === null ? "was removed" : "removed";
}

/** The plain sentence for one Guard event. Unknown categories get a generic one. */
export function describeGuardEvent(event: GuardEventOut): GuardNotice {
  const detail = event.detail ?? "";
  const notice = (text: string, tone: GuardNotice["tone"] = "info"): GuardNotice => ({ text, tone, detail });
  const { guard, action, category } = event;

  if (guard === "input") {
    if (action === "redacted" && category === "secret_in_input") {
      const count = countInDetail(detail);
      const rotate = count !== null && count > 1 ? "rotate them if they are real" : "rotate it if it is real";
      return notice(`${secrets(count)} ${removed(count)} from your message before any model saw it; ${rotate}`);
    }
    if (action === "redacted" && category === "hidden_text") {
      return notice("Invisible characters were removed from your message");
    }
    if (action === "blocked") {
      if (category === "classifier") return notice("No model answered: the input classifier judged your message an attack", "blocked");
      return notice(`No model saw your message: it looked like ${categoryPhrase(category)}`, "blocked");
    }
    if (action === "flagged") {
      return notice("Attack-like text in your message was treated as data, since it was quoted or asked about");
    }
  }

  if (guard === "provenance" && action === "flagged") {
    const tool = /^([\w-]+) output:/.exec(detail)?.[1];
    // A Plugin Tool (M5) is named "<plugin_id>__<tool>"; built-in names never contain "__".
    const where = tool ? (splitPluginToolName(tool) ? "A Plugin's tool result" : "A tool result") : "A retrieved passage";
    return notice(`${where} contained ${categoryPhrase(category)}; it was treated as data`);
  }

  if (guard === "output" && action === "redacted") {
    const count = countInDetail(detail);
    if (category === "secret_in_answer") {
      return notice(count === null ? "Secret removed from the answer" : `${secrets(count)} removed from the answer`);
    }
    if (category === "secret_in_tool_output") {
      return notice(`${secrets(count)} ${removed(count)} from a tool result before the model saw it`);
    }
  }

  switch (action) {
    case "blocked":
      return notice("A guard blocked part of this turn", "blocked");
    case "redacted":
      return notice("A guard removed sensitive text from this turn");
    case "flagged":
      return notice("A guard flagged suspicious text in this turn; it was treated as data");
    default:
      return notice("A guard acted on this turn");
  }
}

/** True when the input guard answered with its fixed response instead of a Model. */
export function blockedByInputGuard(events: readonly GuardEventOut[]): boolean {
  return events.some((event) => event.guard === "input" && event.action === "blocked");
}

export interface GroupedGuardNotice extends GuardNotice {
  /** How many events read the same; shown as "2×". */
  count: number;
  /** The distinct details of those events. */
  details: string[];
}

/** One notice per distinct sentence, in first-seen order. */
export function guardNotices(events: readonly GuardEventOut[]): GroupedGuardNotice[] {
  const byText = new Map<string, GroupedGuardNotice>();
  for (const event of events) {
    const notice = describeGuardEvent(event);
    const existing = byText.get(notice.text);
    if (existing) {
      existing.count += 1;
      if (notice.detail && !existing.details.includes(notice.detail)) existing.details.push(notice.detail);
    } else {
      byText.set(notice.text, { ...notice, count: 1, details: notice.detail ? [notice.detail] : [] });
    }
  }
  return [...byText.values()];
}
