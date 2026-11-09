import { useCallback, useSyncExternalStore } from "react";

import { getLiveTurn, getTurnNotices, subscribeLiveTurns, type LiveTurn } from "@/lib/live-turn";
import type { TurnNoticeData } from "@/lib/types";

/** The streaming (or just-failed) turn of one Conversation, or null. */
export function useLiveTurn(conversationId: string | undefined): LiveTurn | null {
  const getSnapshot = useCallback(() => getLiveTurn(conversationId), [conversationId]);
  return useSyncExternalStore(subscribeLiveTurns, getSnapshot, getSnapshot);
}

/** The `notice` events a finished turn received during this page load. */
export function useTurnNotices(messageId: string): readonly TurnNoticeData[] {
  const getSnapshot = useCallback(() => getTurnNotices(messageId), [messageId]);
  return useSyncExternalStore(subscribeLiveTurns, getSnapshot, getSnapshot);
}
