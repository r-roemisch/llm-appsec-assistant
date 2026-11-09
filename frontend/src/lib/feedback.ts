// Feedback as the conversation view and the admin page show it (docs/API.md,
// M6). Feedback is capture only: it is stored with the answer's trace id, sent
// to the trace as a score and shown to administrators with the question and the
// answer. Nothing in Rampart reads it to change how it answers; an admin can
// turn an answer into an Evaluation Case, a reviewed test case that the next
// evaluation run includes (human in the loop, never automatic learning).

import { formatNumber } from "@/lib/format";
import { countCharacters } from "@/lib/profile";
import type {
  EvaluationCaseIn,
  EvaluationCaseKind,
  FeedbackIn,
  FeedbackOut,
  FeedbackRecordOut,
  FeedbackValue,
  MessageOut,
} from "@/lib/types";

/** The limits from docs/API.md; the server checks them too. The expected answer's cap is the server's (8000). */
export const FEEDBACK_LIMITS = { comment: 1000 } as const;
export const CASE_LIMITS = { question: 4000, expectedAnswer: 8000, expectedTools: 10 } as const;

/** Shown every time someone rates an answer: who sees it, and that it changes nothing by itself. */
export const FEEDBACK_NOTE =
  "Administrators see your rating and comment together with your question and this answer, to help improve Rampart. Feedback alone never changes how Rampart answers.";

export function feedbackLabel(value: FeedbackValue): string {
  return value === 1 ? "Helpful" : "Not helpful";
}

/** A finished answer can be rated; not while it streams or waits for an Approval. */
export function canRate(message: Pick<MessageOut, "role" | "status">): boolean {
  return message.role === "assistant" && (message.status === "complete" || message.status === "error");
}

/** The PUT body for a rating; an empty comment is left out, which clears it. */
export function feedbackInput(value: FeedbackValue, comment?: string | null): FeedbackIn {
  const text = (comment ?? "").trim();
  return text ? { value, comment: text } : { value };
}

/**
 * What a click on a thumb sends: the pressed thumb again removes the Feedback
 * (null, a DELETE); the other thumb changes the value and keeps the comment.
 */
export function nextFeedback(current: FeedbackOut | null, clicked: FeedbackValue): FeedbackIn | null {
  if (current?.value === clicked) return null;
  return feedbackInput(clicked, current?.comment);
}

/** Why a comment cannot be saved, or null. */
export function commentProblem(comment: string): string | null {
  if (countCharacters(comment.trim()) > FEEDBACK_LIMITS.comment) {
    return `The comment is longer than ${formatNumber(FEEDBACK_LIMITS.comment)} characters.`;
  }
  return null;
}

/** Where the score of a Feedback went, in words. */
export function forwardedLabel(record: Pick<FeedbackRecordOut, "forwarded_to" | "trace_id">): string {
  switch (record.forwarded_to) {
    case "langfuse":
      return "Sent to Langfuse";
    case "jsonl":
      return "In the local trace log";
    default:
      return record.trace_id ? "Not forwarded" : "Not forwarded: the answer has no trace";
  }
}

/** The first eight characters, for ids shown in passing; the full id goes in a title. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** "feedback:<id>" -> "From Feedback 1a2b3c4d"; any other source as it is. */
export function caseSourceLabel(source: string): string {
  const id = source.startsWith("feedback:") ? source.slice("feedback:".length) : null;
  return id ? `From Feedback ${shortId(id)}` : source;
}

export function caseKindLabel(kind: EvaluationCaseKind): string {
  return kind === "qa" ? "Question and answer" : "Tool choice";
}

/** The conversion dialog's fields, as typed. */
export interface CaseDraft {
  kind: EvaluationCaseKind;
  question: string;
  expectedAnswer: string;
  expectedTools: string[];
}

/**
 * A starting point from the answer the user rated: the user's question, the
 * answer as the reference text (which the admin corrects) and the Tools the
 * answer used.
 */
export function caseDraftFrom(record: FeedbackRecordOut): CaseDraft {
  return {
    kind: "qa",
    question: record.question ?? "",
    expectedAnswer: record.answer,
    expectedTools: [...new Set(record.tools_used)],
  };
}

export type CaseInputResult = { ok: true; input: EvaluationCaseIn } | { ok: false; error: string };

/**
 * Checks the draft like the server and builds the POST body: the question
 * trimmed, then the expected answer for "qa" or the expected Tools for "tool".
 * When `knownTools` is given, Tools that are not in it are left out.
 */
export function buildCaseInput(draft: CaseDraft, knownTools?: ReadonlySet<string>): CaseInputResult {
  const question = draft.question.trim();
  if (!question) return { ok: false, error: "Write the question the case asks." };
  if (countCharacters(question) > CASE_LIMITS.question) {
    return { ok: false, error: `The question is longer than ${formatNumber(CASE_LIMITS.question)} characters.` };
  }
  if (draft.kind === "qa") {
    const expected = draft.expectedAnswer.trim();
    if (!expected) return { ok: false, error: "Write the expected answer: a qa case is scored against it." };
    if (countCharacters(expected) > CASE_LIMITS.expectedAnswer) {
      return {
        ok: false,
        error: `The expected answer is longer than ${formatNumber(CASE_LIMITS.expectedAnswer)} characters.`,
      };
    }
    return { ok: true, input: { kind: "qa", question, expected_answer: expected } };
  }
  const tools = [...new Set(draft.expectedTools)].filter((name) => !knownTools || knownTools.has(name));
  if (tools.length === 0) return { ok: false, error: "Choose at least one Tool the answer should call." };
  if (tools.length > CASE_LIMITS.expectedTools) {
    return { ok: false, error: `Choose at most ${CASE_LIMITS.expectedTools} Tools.` };
  }
  return { ok: true, input: { kind: "tool", question, expected_tools: tools } };
}
