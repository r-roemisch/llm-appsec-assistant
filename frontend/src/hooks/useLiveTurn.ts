import { useCallback, useSyncExternalStore } from "react";

import { getLiveTurn, subscribeLiveTurns, type LiveTurn } from "@/lib/live-turn";

/** The streaming (or just-failed) turn of one Conversation, or null. */
export function useLiveTurn(conversationId: string | undefined): LiveTurn | null {
  const getSnapshot = useCallback(() => getLiveTurn(conversationId), [conversationId]);
  return useSyncExternalStore(subscribeLiveTurns, getSnapshot, getSnapshot);
}
