// The turn that is streaming right now, per Conversation. Kept outside React so
// a stream survives navigating between "/" and "/c/:id" and between
// Conversations. Components subscribe with useLiveTurn().

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage, streamTurn, toTurnEvent } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ConversationDetailOut, MessageOut, TurnUsageData } from "@/lib/types";

export interface LiveTurn {
  conversationId: string;
  /** Optimistic until the `start` event replaces it with the server copy. */
  userMessage: MessageOut;
  assistantMessageId: string | null;
  modelId: string | null;
  text: string;
  usage: TurnUsageData | null;
  status: "streaming" | "error";
  error: string | null;
  startedAt: number;
}

type Listener = () => void;

let turns: ReadonlyMap<string, LiveTurn> = new Map();
const controllers = new Map<string, AbortController>();
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function put(turn: LiveTurn): void {
  const next = new Map(turns);
  next.set(turn.conversationId, turn);
  turns = next;
  notify();
}

function patch(conversationId: string, changes: Partial<LiveTurn>): void {
  const current = turns.get(conversationId);
  if (!current) return;
  put({ ...current, ...changes });
}

function remove(conversationId: string): void {
  if (!turns.has(conversationId)) return;
  const next = new Map(turns);
  next.delete(conversationId);
  turns = next;
  notify();
}

export function getLiveTurn(conversationId: string | undefined): LiveTurn | null {
  return conversationId ? (turns.get(conversationId) ?? null) : null;
}

export function subscribeLiveTurns(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isStreaming(conversationId: string | undefined): boolean {
  return conversationId ? controllers.has(conversationId) : false;
}

/** Aborts the request; the server keeps what was received so far. */
export function stopTurn(conversationId: string): void {
  controllers.get(conversationId)?.abort();
}

/** Drops a finished or failed turn from the store (for example after a delete). */
export function discardTurn(conversationId: string): void {
  stopTurn(conversationId);
  remove(conversationId);
}

function appendToCache(queryClient: QueryClient, conversationId: string, messages: MessageOut[]): void {
  const ids = new Set(messages.map((message) => message.id));
  queryClient.setQueryData<ConversationDetailOut>(queryKeys.conversation(conversationId), (old) =>
    old
      ? { ...old, messages: [...old.messages.filter((message) => !ids.has(message.id)), ...messages] }
      : old,
  );
}

function optimisticUserMessage(conversationId: string, content: string): MessageOut {
  return {
    id: `pending-${Date.now()}`,
    conversation_id: conversationId,
    role: "user",
    content,
    created_at: new Date().toISOString(),
    model_id: null,
    provider: null,
    input_tokens: null,
    output_tokens: null,
    cost_usd: null,
    latency_ms: null,
    trace_id: null,
    status: "complete",
    error: null,
  };
}

/**
 * Sends `content` and follows the stream until it ends. Resolves when the
 * Conversation cache has been reconciled with the server.
 */
export async function startTurn(queryClient: QueryClient, conversationId: string, content: string): Promise<void> {
  if (controllers.has(conversationId)) return;
  const controller = new AbortController();
  controllers.set(conversationId, controller);

  put({
    conversationId,
    userMessage: optimisticUserMessage(conversationId, content),
    assistantMessageId: null,
    modelId: null,
    text: "",
    usage: null,
    status: "streaming",
    error: null,
    startedAt: Date.now(),
  });

  let started = false;
  let stored = false; // the server copy of the answer is in the cache

  try {
    for await (const raw of streamTurn(conversationId, content, controller.signal)) {
      const event = toTurnEvent(raw);
      if (!event) continue; // later milestones add event names; ignore them
      switch (event.event) {
        case "start":
          started = true;
          patch(conversationId, {
            userMessage: event.data.user_message,
            assistantMessageId: event.data.assistant_message_id,
            modelId: event.data.model_id,
          });
          break;
        case "delta": {
          const current = turns.get(conversationId);
          if (current) patch(conversationId, { text: current.text + event.data.text });
          break;
        }
        case "usage":
          patch(conversationId, { usage: event.data });
          break;
        case "done": {
          const current = turns.get(conversationId);
          appendToCache(queryClient, conversationId, [
            ...(current ? [current.userMessage] : []),
            event.data.assistant_message,
          ]);
          stored = true;
          break;
        }
        case "error": {
          toast.error(event.data.message);
          const current = turns.get(conversationId);
          if (event.data.assistant_message) {
            appendToCache(queryClient, conversationId, [
              ...(current ? [current.userMessage] : []),
              event.data.assistant_message,
            ]);
            stored = true;
          } else {
            patch(conversationId, { status: "error", error: event.data.message });
          }
          break;
        }
      }
    }
    if (!stored && !controller.signal.aborted && turns.get(conversationId)?.status === "streaming") {
      patch(conversationId, { status: "error", error: "The stream ended before the answer completed" });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      patch(conversationId, { status: "error", error: "Stopped" });
    } else {
      const message = errorMessage(error);
      patch(conversationId, { status: "error", error: message });
      toast.error(message);
    }
  } finally {
    controllers.delete(conversationId);
  }

  if (controller.signal.aborted) {
    patch(conversationId, { status: "error", error: "Stopped" });
  }

  // Title and total cost change on the server; refresh the list.
  void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });

  if (stored || started || controller.signal.aborted) {
    // The server stored the messages (fully, or partially after a stop):
    // fetch its copy, then drop the live turn so nothing shows twice.
    await queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
    remove(conversationId);
  }
  // Otherwise the request failed before anything was stored; keep the turn
  // visible with its error until the next send replaces it.
}
