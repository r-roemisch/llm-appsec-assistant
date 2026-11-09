// Why Rampart stopped a turn early (`notice` events, docs/API.md M3): the
// Conversation's token budget, or the model calls one turn may make.

import type { TurnNoticeData } from "@/lib/types";

export function noticeTitle(kind: TurnNoticeData["kind"]): string {
  switch (kind) {
    case "budget":
      return "Stopped: this conversation used its token budget";
    case "model_calls":
      return "Stopped: the turn reached its limit of model calls";
    default:
      return "Rampart stopped this turn";
  }
}

/**
 * The explanation to show under the title: the last paragraph of the server's
 * message, or null when the answer text already says it (the server streams
 * the explanation as part of the answer).
 */
export function noticeDetail(message: string, answer: string): string | null {
  const paragraphs = message
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const last = paragraphs.at(-1);
  if (!last) return null;
  return answer.includes(last) ? null : last;
}
