// The turn that is streaming right now, per Conversation. Kept outside React so
// a stream survives navigating between "/" and "/c/:id" and between
// Conversations. Components subscribe with useLiveTurn().
//
// Two kinds of stream feed it: a new turn (POST /messages) and (M3) a resumed
// turn after an Approval decision, which continues the stored assistant
// message: its text and Tool calls grow, and it ends with `done`, `error` or
// another `approval_required`.

import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  errorMessage,
  streamApprovalContinue,
  streamApprovalDecision,
  streamTurn,
  toTurnEvent,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { SSEEvent } from "@/lib/sse";
import { mergeToolCall, toolCallUpdate } from "@/lib/tools";
import type {
  ApprovalDecision,
  ApprovalOut,
  CitationOut,
  ConversationDetailOut,
  GuardEventOut,
  MessageOut,
  ToolCallOut,
  TurnEvent,
  TurnNoticeData,
  TurnRetrievalData,
  TurnUsageData,
} from "@/lib/types";

export interface LiveTurn {
  conversationId: string;
  /** "turn" for a new message; "resume" continues a stored answer after an Approval decision. */
  mode: "turn" | "resume";
  /** Optimistic until the `start` event replaces it with the server copy; null when resuming. */
  userMessage: MessageOut | null;
  assistantMessageId: string | null;
  modelId: string | null;
  /** The `retrieval` events so far, oldest first; empty when the turn did not search. */
  retrieval: TurnRetrievalData[];
  /** The answer so far; a resumed turn starts from the stored text. */
  text: string;
  /** From the `citations` event; `done` brings the same list on the stored answer. */
  citations: CitationOut[];
  /** Merged by call id from `tool_call` and `tool_result`; a resumed turn starts from the stored calls. */
  toolCalls: ToolCallOut[];
  guardEvents: GuardEventOut[];
  /** Why Rampart stopped the turn early (`notice` events). */
  notices: TurnNoticeData[];
  /** The Approval being resumed, or the one the turn now waits for. */
  approval: ApprovalOut | null;
  usage: TurnUsageData | null;
  status: "streaming" | "error" | "awaiting_approval";
  error: string | null;
  startedAt: number;
  /** The server copy of the answer is in the cache; the stored message shows from now on. */
  settled: boolean;
  /** Tells streams apart, so a finished stream never touches the one after it. */
  generation: number;
}

type Listener = () => void;

/** Exactly one of these ends a stream; nothing after it counts. */
const FINAL_EVENTS: ReadonlySet<TurnEvent["event"]> = new Set(["done", "error", "approval_required"]);

let turns: ReadonlyMap<string, LiveTurn> = new Map();
const controllers = new Map<string, AbortController>();
const listeners = new Set<Listener>();
let generations = 0;

// The `notice` events of finished turns by assistant message id. MessageOut
// has no field for them, so they last for this page load; the stored text
// still carries the server's explanation.
const noticesByMessage = new Map<string, readonly TurnNoticeData[]>();
const NO_NOTICES: readonly TurnNoticeData[] = [];

function notify(): void {
  listeners.forEach((listener) => listener());
}

function put(turn: LiveTurn): void {
  const next = new Map(turns);
  next.set(turn.conversationId, turn);
  turns = next;
  notify();
}

/** The live turn of the Conversation when it still belongs to stream `generation`. */
function own(conversationId: string, generation: number): LiveTurn | null {
  const current = turns.get(conversationId);
  return current && current.generation === generation ? current : null;
}

function patch(conversationId: string, generation: number, changes: Partial<LiveTurn>): void {
  const current = own(conversationId, generation);
  if (current) put({ ...current, ...changes });
}

function remove(conversationId: string, generation?: number): void {
  const current = turns.get(conversationId);
  if (!current || (generation !== undefined && current.generation !== generation)) return;
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

/** Aborts the request; the server keeps what was received so far. */
export function stopTurn(conversationId: string): void {
  controllers.get(conversationId)?.abort();
}

/** Drops a finished or failed turn from the store (for example after a delete). */
export function discardTurn(conversationId: string): void {
  stopTurn(conversationId);
  remove(conversationId);
}

/** The `notice` events a finished turn received, for its stored message. */
export function getTurnNotices(messageId: string): readonly TurnNoticeData[] {
  return noticesByMessage.get(messageId) ?? NO_NOTICES;
}

/**
 * The live turn to show beside the stored `messages`, or null once the stored
 * copy has taken over. A new turn shows below the messages; a resumed turn
 * shows in place of the message it continues.
 */
export function visibleLiveTurn(live: LiveTurn | null, messages: readonly MessageOut[] | undefined): LiveTurn | null {
  if (!live || live.settled) return null;
  if (
    live.mode === "turn" &&
    live.assistantMessageId &&
    messages?.some((message) => message.id === live.assistantMessageId)
  ) {
    return null;
  }
  return live;
}

function isMessage(value: unknown): value is MessageOut {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

function isApproval(value: unknown): value is ApprovalOut {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

/** Replaces cached messages by id, in place, and appends new ones. */
function upsertMessages(queryClient: QueryClient, conversationId: string, messages: MessageOut[]): void {
  queryClient.setQueryData<ConversationDetailOut>(queryKeys.conversation(conversationId), (old) => {
    if (!old) return old;
    const next = [...old.messages];
    for (const message of messages) {
      const index = next.findIndex((item) => item.id === message.id);
      if (index === -1) next.push(message);
      else next[index] = message;
    }
    return { ...old, messages: next };
  });
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
    citations: [],
    retrieval_mode: null,
    tool_calls: [],
    guard_events: [],
    pending_approval: null,
    feedback: null,
  };
}

/**
 * Puts the server copy of the answer (and, for a new turn, the user message)
 * in the cache, so the stored message shows from now on. False when the
 * payload holds no message.
 */
function settle(
  queryClient: QueryClient,
  conversationId: string,
  generation: number,
  assistant: unknown,
  changes: Partial<LiveTurn> = {},
): boolean {
  const current = own(conversationId, generation);
  if (!current || !isMessage(assistant)) return false;
  if (current.notices.length > 0) noticesByMessage.set(assistant.id, current.notices);
  const userMessage = current.mode === "turn" ? current.userMessage : null;
  upsertMessages(queryClient, conversationId, userMessage ? [userMessage, assistant] : [assistant]);
  patch(conversationId, generation, { ...changes, settled: true });
  return true;
}

/** Applies one event to the live turn. True when the server copy of the answer is now cached. */
function apply(queryClient: QueryClient, conversationId: string, generation: number, event: TurnEvent): boolean {
  const current = own(conversationId, generation);
  if (!current) return false;
  const update = (changes: Partial<LiveTurn>) => patch(conversationId, generation, changes);

  switch (event.event) {
    case "start":
      update({
        userMessage: event.data.user_message,
        assistantMessageId: event.data.assistant_message_id,
        modelId: event.data.model_id,
      });
      return false;
    case "resume":
      update({
        assistantMessageId: event.data.assistant_message_id || current.assistantMessageId,
        approval: isApproval(event.data.approval) ? event.data.approval : current.approval,
      });
      return false;
    case "retrieval":
      update({ retrieval: [...current.retrieval, event.data] });
      return false;
    case "guard": {
      const { guard, action, category, detail } = event.data;
      if (typeof guard === "string" && typeof action === "string") {
        const entry: GuardEventOut = {
          guard,
          action,
          category: typeof category === "string" ? category : "",
          detail: typeof detail === "string" ? detail : "",
        };
        update({ guardEvents: [...current.guardEvents, entry] });
      }
      return false;
    }
    case "tool_call":
    case "tool_result": {
      const change = toolCallUpdate(event.event, event.data);
      if (change) update({ toolCalls: mergeToolCall(current.toolCalls, change) });
      if (event.event === "tool_result" && event.data.report_id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.reports });
      }
      return false;
    }
    case "delta":
      if (typeof event.data.text === "string") update({ text: current.text + event.data.text });
      return false;
    case "notice":
      if (typeof event.data.message === "string") {
        const notice: TurnNoticeData = { kind: String(event.data.kind ?? ""), message: event.data.message };
        update({ notices: [...current.notices, notice] });
      }
      return false;
    case "citations":
      if (Array.isArray(event.data.citations)) update({ citations: event.data.citations });
      return false;
    case "usage":
      update({ usage: event.data });
      return false;
    case "done":
      return settle(queryClient, conversationId, generation, event.data.assistant_message);
    case "error": {
      const message = typeof event.data.message === "string" && event.data.message ? event.data.message : "The answer failed";
      toast.error(message);
      const changes: Partial<LiveTurn> = { status: "error", error: message };
      if (settle(queryClient, conversationId, generation, event.data.assistant_message, changes)) return true;
      update(changes);
      return false;
    }
    case "approval_required": {
      // A final event, like `done`: the stored answer waits for the Approval.
      const approval = isApproval(event.data.approval) ? event.data.approval : current.approval;
      const changes: Partial<LiveTurn> = { status: "awaiting_approval", approval };
      if (settle(queryClient, conversationId, generation, event.data.assistant_message, changes)) return true;
      update(changes);
      return false;
    }
  }
}

/**
 * Follows one stream until it ends and reconciles the Conversation cache with
 * the server. Does nothing while the Conversation already streams.
 */
async function follow(
  queryClient: QueryClient,
  initial: Omit<LiveTurn, "generation">,
  open: (signal: AbortSignal) => AsyncGenerator<SSEEvent, void, undefined>,
): Promise<void> {
  const { conversationId } = initial;
  if (controllers.has(conversationId)) return;
  const controller = new AbortController();
  controllers.set(conversationId, controller);
  generations += 1;
  const generation = generations;
  put({ ...initial, generation });

  let started = false; // `start` or `resume` arrived: the server stored or claimed the answer
  let stored = false; // the server copy of the answer is in the cache

  try {
    for await (const raw of open(controller.signal)) {
      const event = toTurnEvent(raw);
      if (!event) continue; // event names this client does not know are ignored
      if (event.event === "start" || event.event === "resume") started = true;
      if (apply(queryClient, conversationId, generation, event)) stored = true;
      if (FINAL_EVENTS.has(event.event)) break;
    }
    if (!stored && !controller.signal.aborted && own(conversationId, generation)?.status === "streaming") {
      patch(conversationId, generation, { status: "error", error: "The stream ended before the answer completed" });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      patch(conversationId, generation, { status: "error", error: "Stopped" });
    } else {
      const message = errorMessage(error);
      patch(conversationId, generation, { status: "error", error: message });
      toast.error(message);
    }
  } finally {
    controllers.delete(conversationId);
  }

  if (controller.signal.aborted) {
    patch(conversationId, generation, { status: "error", error: "Stopped" });
  }

  // Title, total cost and update time change on the server; refresh the list.
  void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList });

  if (stored || started || controller.signal.aborted) {
    // The server stored the messages (fully, or partially after a stop):
    // fetch its copy, then drop the live turn so nothing shows twice.
    await queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
    remove(conversationId, generation);
  } else if (initial.mode === "resume") {
    // The decision was refused (for example 409: an admin decided first, or
    // it expired). Show the stored message again and refresh it.
    remove(conversationId, generation);
    await queryClient.invalidateQueries({ queryKey: queryKeys.conversation(conversationId) });
  }
  // Otherwise a new turn failed before anything was stored; keep it visible
  // with its error until the next send replaces it.
}

/**
 * Sends `content` and follows the stream until it ends. Resolves when the
 * Conversation cache has been reconciled with the server.
 */
export function startTurn(queryClient: QueryClient, conversationId: string, content: string): Promise<void> {
  return follow(
    queryClient,
    {
      conversationId,
      mode: "turn",
      userMessage: optimisticUserMessage(conversationId, content),
      assistantMessageId: null,
      modelId: null,
      retrieval: [],
      text: "",
      citations: [],
      toolCalls: [],
      guardEvents: [],
      notices: [],
      approval: null,
      usage: null,
      status: "streaming",
      error: null,
      startedAt: Date.now(),
      settled: false,
    },
    (signal) => streamTurn(conversationId, content, signal),
  );
}

/**
 * Approves or rejects the Approval that `message` waits for, or with a null
 * decision continues after an admin decided or the Approval expired, and
 * follows the stream that continues the same assistant message: its text and
 * Tool calls grow from the stored ones.
 */
export function resumeTurn(
  queryClient: QueryClient,
  message: MessageOut,
  approvalId: string,
  decision: ApprovalDecision | null,
): Promise<void> {
  const conversationId = message.conversation_id;
  const approval = message.pending_approval;
  return follow(
    queryClient,
    {
      conversationId,
      mode: "resume",
      userMessage: null,
      assistantMessageId: message.id,
      modelId: message.model_id,
      retrieval: [],
      text: message.content,
      citations: [],
      toolCalls: message.tool_calls ?? [],
      guardEvents: message.guard_events ?? [],
      notices: [],
      // Until `resume` brings the server's copy, show the decision just made.
      approval:
        approval && decision ? { ...approval, status: decision === "approve" ? "approved" : "rejected" } : approval,
      usage: null,
      status: "streaming",
      error: null,
      startedAt: Date.now(),
      settled: false,
    },
    (signal) =>
      decision
        ? streamApprovalDecision(conversationId, approvalId, decision, signal)
        : streamApprovalContinue(conversationId, approvalId, signal),
  );
}
