import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getLiveTurn,
  getTurnNotices,
  resumeTurn,
  startTurn,
  subscribeLiveTurns,
  visibleLiveTurn,
  type LiveTurn,
} from "@/lib/live-turn";
import { queryKeys } from "@/lib/query-keys";
import { describeRetrieval, latestRetrievalMode } from "@/lib/retrieval";
import { session } from "@/lib/session";
import type { ConversationDetailOut, MessageOut, TurnRetrievalData } from "@/lib/types";
import {
  aliceSession,
  approval,
  callsTo,
  citation,
  conversation,
  jsonResponse,
  message,
  mockFetch,
  sseEvent,
  sseResponse,
  toolCall,
} from "@/test/helpers";

function seededClient(messages: MessageOut[] = []): QueryClient {
  const queryClient = new QueryClient();
  queryClient.setQueryData<ConversationDetailOut>(queryKeys.conversation("c1"), {
    conversation: conversation({ id: "c1" }),
    messages,
  });
  return queryClient;
}

/** Runs `follow` and records every state of the live turn on the way. */
async function record(follow: () => Promise<void>): Promise<LiveTurn[]> {
  const snapshots: LiveTurn[] = [];
  const unsubscribe = subscribeLiveTurns(() => {
    const turn = getLiveTurn("c1");
    if (turn) snapshots.push(turn);
  });
  try {
    await follow();
  } finally {
    unsubscribe();
  }
  return snapshots;
}

/** Runs one turn and records every state of the live turn on the way. */
function runTurn(queryClient: QueryClient, content: string): Promise<LiveTurn[]> {
  return record(() => startTurn(queryClient, "c1", content));
}

function cachedMessages(queryClient: QueryClient): MessageOut[] {
  return queryClient.getQueryData<ConversationDetailOut>(queryKeys.conversation("c1"))?.messages ?? [];
}

describe("live turn store", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("follows retrieval and citations events, ignores unknown events, and stores the answer", async () => {
    const cited = citation({ n: 1 });
    const userMessage = message({ id: "u1", role: "user", content: "How do I stop indirect injection?" });
    const answer = message({
      id: "a1",
      role: "assistant",
      content: "Delimit untrusted text [1].",
      citations: [cited],
      retrieval_mode: "bm25",
    });
    const fetchMock = mockFetch(() =>
      sseResponse([
        sseEvent("start", { user_message: userMessage, assistant_message_id: "a1", model_id: "m" }),
        sseEvent("retrieval", { phase: "search", round: 1, query: "indirect injection" }),
        sseEvent("retrieval", { phase: "graded", round: 1, query: "indirect injection", mode: "bm25", found: 4, relevant: 0 }),
        sseEvent("retrieval", { phase: "search", round: 2, query: "indirect prompt injection mitigations" }),
        sseEvent("heartbeat", { at: 1 }),
        sseEvent("retrieval", {
          phase: "graded",
          round: 2,
          query: "indirect prompt injection mitigations",
          mode: "bm25",
          found: 6,
          relevant: 2,
        }),
        sseEvent("delta", { text: "Delimit untrusted text [1]." }),
        sseEvent("citations", { citations: [cited] }),
        sseEvent("usage", { input_tokens: 900, output_tokens: 40, cost_usd: 0.0002 }),
        sseEvent("done", { assistant_message: answer }),
      ]),
    );
    const queryClient = seededClient();

    const snapshots = await runTurn(queryClient, "How do I stop indirect injection?");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Retrieval progress comes before the first delta, step by step.
    const progress = snapshots
      .filter((turn) => turn.text === "")
      .map((turn) => describeRetrieval(turn.retrieval)?.label)
      .filter((label, index, labels) => label && label !== labels[index - 1]);
    expect(progress).toEqual([
      "Searching the Knowledge Base…",
      "Nothing relevant found",
      "Rewriting the query…",
      "2 relevant passages found",
    ]);
    // The citations event lands on the live turn before `done`.
    const withCitations = snapshots.find((turn) => turn.citations.length > 0);
    expect(withCitations?.citations).toEqual([cited]);
    expect(withCitations?.text).toBe("Delimit untrusted text [1].");
    expect(latestRetrievalMode(snapshots.at(-1)?.retrieval ?? [])).toBe("bm25");
    // The unknown `heartbeat` event was skipped; the stored answer carries its Citations.
    const stored = queryClient.getQueryData<ConversationDetailOut>(queryKeys.conversation("c1"));
    expect(stored?.messages.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(stored?.messages[1].citations).toEqual([cited]);
    expect(getLiveTurn("c1")).toBeNull();
  });

  it("starts a turn with an optimistic user message that has the M2 fields", async () => {
    mockFetch(() => sseResponse([]));
    const queryClient = seededClient();

    const snapshots = await runTurn(queryClient, "Hello");

    expect(snapshots[0].userMessage).toMatchObject({
      role: "user",
      content: "Hello",
      citations: [],
      retrieval_mode: null,
      tool_calls: [],
      guard_events: [],
      pending_approval: null,
    });
    expect(snapshots[0].retrieval).toEqual([]);
    expect(snapshots[0].citations).toEqual([]);
    // The stream ended without `done`: the turn stays visible with an error.
    expect(getLiveTurn("c1")?.error).toBe("The stream ended before the answer completed");
  });
});

describe("live turn store: Tools, Guards and Approvals (M3)", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  const userMessage = message({ id: "u1", role: "user", content: "Test my staging bot for prompt injection" });
  const lookupArgs = { ecosystem: "PyPI", name: "requests", version: "2.25.0" };
  const testArgs = { target_id: "t-staging", suite: "basic" };

  it("merges tool_call and tool_result by id and stops at approval_required, a final event", async () => {
    const pending = approval();
    const waiting = message({
      id: "a1",
      role: "assistant",
      content: "I'll check the dependency first.",
      status: "awaiting_approval",
      tool_calls: [
        toolCall({ id: "call_1", tool: "lookup_vulnerabilities", decision: "allow", status: "ok", summary: "8 known vulnerabilities" }),
        toolCall({ id: "call_2", tool: "run_injection_test", decision: "approval_required", status: "pending", approval_id: "ap1" }),
      ],
      guard_events: [{ guard: "input", action: "redacted", category: "secret_in_input", detail: "1 openai_key" }],
      pending_approval: pending,
    });
    mockFetch(() =>
      sseResponse([
        sseEvent("start", { user_message: userMessage, assistant_message_id: "a1", model_id: "m" }),
        sseEvent("guard", { guard: "input", action: "redacted", category: "secret_in_input", detail: "1 openai_key" }),
        sseEvent("delta", { text: "I'll check the dependency first." }),
        sseEvent("tool_call", {
          id: "call_1",
          tool: "lookup_vulnerabilities",
          arguments: lookupArgs,
          decision: "allow",
          reason_code: "allowed",
          message: "allowed by policy",
          approval_id: null,
        }),
        sseEvent("tool_result", {
          id: "call_1",
          tool: "lookup_vulnerabilities",
          status: "ok",
          summary: "8 known vulnerabilities in requests 2.25.0",
          provenance: "API",
          report_id: null,
        }),
        sseEvent("tool_call", {
          id: "call_2",
          tool: "run_injection_test",
          arguments: testArgs,
          decision: "approval_required",
          reason_code: "approval_pending",
          message: "waiting for approval by the user",
          approval_id: "ap1",
        }),
        sseEvent("approval_required", { approval: pending, assistant_message: waiting }),
        // Nothing after a final event counts.
        sseEvent("delta", { text: " ignored" }),
      ]),
    );
    const queryClient = seededClient();

    const snapshots = await runTurn(queryClient, "Test my staging bot for prompt injection");

    const running = snapshots.find((turn) => turn.toolCalls.length === 1 && turn.toolCalls[0].status === null);
    expect(running?.toolCalls[0]).toMatchObject({ id: "call_1", decision: "allow", arguments: lookupArgs, summary: null });
    const merged = snapshots.find((turn) => turn.toolCalls[0]?.status === "ok");
    // The result merged into the same call: one entry, the decision kept, the outcome added.
    expect(merged?.toolCalls).toHaveLength(1);
    expect(merged?.toolCalls[0]).toMatchObject({
      id: "call_1",
      decision: "allow",
      reason_code: "allowed",
      arguments: lookupArgs,
      status: "ok",
      summary: "8 known vulnerabilities in requests 2.25.0",
      provenance: "API",
    });
    const last = snapshots.at(-1)!;
    expect(last.toolCalls.map((call) => [call.id, call.decision, call.status])).toEqual([
      ["call_1", "allow", "ok"],
      ["call_2", "approval_required", "pending"],
    ]);
    expect(last.guardEvents).toEqual([
      { guard: "input", action: "redacted", category: "secret_in_input", detail: "1 openai_key" },
    ]);
    expect(last).toMatchObject({ status: "awaiting_approval", settled: true, text: "I'll check the dependency first." });
    expect(last.approval?.id).toBe("ap1");
    // The cache holds the stored, waiting answer; the live turn is gone.
    const stored = cachedMessages(queryClient);
    expect(stored.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(stored[1]).toMatchObject({ status: "awaiting_approval", pending_approval: { id: "ap1", status: "pending" } });
    expect(getLiveTurn("c1")).toBeNull();
  });

  it("resumes after an approval: appends to the stored text and Tool calls, then stores the answer in place", async () => {
    const waiting = message({
      id: "a1",
      role: "assistant",
      content: "I'll run the basic suite.",
      status: "awaiting_approval",
      tool_calls: [
        toolCall({
          id: "call_2",
          tool: "run_injection_test",
          arguments: testArgs,
          decision: "approval_required",
          reason_code: "approval_pending",
          status: "pending",
          approval_id: "ap1",
        }),
      ],
      pending_approval: approval(),
    });
    const later = message({ id: "u2", role: "user", content: "unrelated, after" });
    const final = message({
      id: "a1",
      role: "assistant",
      content: "I'll run the basic suite.\n\nNo injection succeeded.",
      tool_calls: [
        toolCall({ id: "call_2", tool: "run_injection_test", arguments: testArgs, decision: "allow", status: "ok", summary: "0 of 12 probes succeeded" }),
      ],
    });
    const fetchMock = mockFetch((url) => {
      if (url !== "/api/conversations/c1/approvals/ap1") throw new Error(`Unexpected request: ${url}`);
      return sseResponse([
        sseEvent("resume", { assistant_message_id: "a1", approval: approval({ status: "approved", decided_by: "alice" }) }),
        sseEvent("tool_call", {
          id: "call_2",
          tool: "run_injection_test",
          arguments: testArgs,
          decision: "allow",
          reason_code: "approved",
          message: "approved by the user",
          approval_id: "ap1",
        }),
        sseEvent("tool_result", {
          id: "call_2",
          tool: "run_injection_test",
          status: "ok",
          summary: "0 of 12 probes succeeded",
          provenance: "target",
          report_id: null,
        }),
        sseEvent("delta", { text: "\n\nNo injection " }),
        sseEvent("delta", { text: "succeeded." }),
        sseEvent("usage", { input_tokens: 1200, output_tokens: 80, cost_usd: 0.0004 }),
        sseEvent("done", { assistant_message: final }),
      ]);
    });
    const queryClient = seededClient([userMessage, waiting, later]);

    const snapshots = await record(() => resumeTurn(queryClient, waiting, "ap1", "approve"));

    const [request] = callsTo(fetchMock, "/api/conversations/c1/approvals/ap1", "POST");
    expect(JSON.parse(String(request.body))).toEqual({ decision: "approve" });
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(new Headers(request.headers).get("Accept")).toBe("text/event-stream");
    // It starts from the stored answer and shows the decision just made.
    expect(snapshots[0]).toMatchObject({
      mode: "resume",
      userMessage: null,
      assistantMessageId: "a1",
      text: "I'll run the basic suite.",
      status: "streaming",
    });
    expect(snapshots[0].approval?.status).toBe("approved");
    expect(snapshots[0].toolCalls[0].status).toBe("pending");
    const running = snapshots.find((turn) => turn.toolCalls[0].reason_code === "approved" && turn.toolCalls[0].summary === null);
    expect(running?.toolCalls[0]).toMatchObject({ decision: "allow", status: "pending", arguments: testArgs });
    const streamed = snapshots.findLast((turn) => !turn.settled)!;
    expect(streamed.text).toBe("I'll run the basic suite.\n\nNo injection succeeded.");
    expect(streamed.toolCalls).toHaveLength(1);
    expect(streamed.toolCalls[0]).toMatchObject({ status: "ok", summary: "0 of 12 probes succeeded", provenance: "target" });
    expect(streamed.approval).toMatchObject({ status: "approved", decided_by: "alice" });
    // The stored message was replaced where it was, not appended.
    expect(cachedMessages(queryClient).map((item) => [item.id, item.status])).toEqual([
      ["u1", "complete"],
      ["a1", "complete"],
      ["u2", "complete"],
    ]);
    expect(cachedMessages(queryClient)[1].content).toBe("I'll run the basic suite.\n\nNo injection succeeded.");
    expect(getLiveTurn("c1")).toBeNull();
  });

  it("continues after an admin decision through the continue endpoint and can stop at another approval", async () => {
    const decided = approval({ approver: "admin", status: "rejected", decided_by: "bob" });
    const waiting = message({ id: "a1", role: "assistant", content: "Waiting.", status: "awaiting_approval", pending_approval: decided });
    const next = approval({ id: "ap2", approver: "admin" });
    const waitingAgain = message({
      id: "a1",
      role: "assistant",
      content: "Waiting.\n\nI'll try a smaller suite.",
      status: "awaiting_approval",
      pending_approval: next,
    });
    const fetchMock = mockFetch(() =>
      sseResponse([
        sseEvent("resume", { assistant_message_id: "a1", approval: decided }),
        sseEvent("tool_result", { id: "call_2", tool: "run_injection_test", status: "rejected", summary: "the approver rejected this call", provenance: null, report_id: null }),
        sseEvent("delta", { text: "\n\nI'll try a smaller suite." }),
        sseEvent("tool_call", { id: "call_3", tool: "run_injection_test", arguments: { suite: "smoke" }, decision: "approval_required", reason_code: "approval_pending", message: "waiting for approval by an administrator", approval_id: "ap2" }),
        sseEvent("approval_required", { approval: next, assistant_message: waitingAgain }),
      ]),
    );
    const queryClient = seededClient([userMessage, waiting]);

    const snapshots = await record(() => resumeTurn(queryClient, waiting, "ap1", null));

    const [request] = callsTo(fetchMock, "/api/conversations/c1/approvals/ap1/continue", "POST");
    expect(request.body).toBeUndefined();
    expect(new Headers(request.headers).has("Content-Type")).toBe(false);
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    // Continuing does not pretend to know the decision; it shows the stored one.
    expect(snapshots[0].approval).toMatchObject({ status: "rejected", decided_by: "bob" });
    const last = snapshots.at(-1)!;
    expect(last.toolCalls.map((call) => [call.id, call.status])).toEqual([
      ["call_2", "rejected"],
      ["call_3", "pending"],
    ]);
    expect(last).toMatchObject({ status: "awaiting_approval", settled: true });
    expect(cachedMessages(queryClient)[1]).toMatchObject({ content: "Waiting.\n\nI'll try a smaller suite.", pending_approval: { id: "ap2" } });
    expect(getLiveTurn("c1")).toBeNull();
  });

  it("puts the stored message back when the server refuses the decision", async () => {
    const waiting = message({ id: "a1", role: "assistant", content: "Waiting.", status: "awaiting_approval", pending_approval: approval() });
    mockFetch(() => jsonResponse(409, { detail: "this approval is expired" }));
    const queryClient = seededClient([userMessage, waiting]);

    const snapshots = await record(() => resumeTurn(queryClient, waiting, "ap1", "approve"));

    expect(snapshots.some((turn) => turn.error === "this approval is expired")).toBe(true);
    expect(getLiveTurn("c1")).toBeNull();
    expect(cachedMessages(queryClient)[1]).toBe(waiting);
  });

  it("keeps the notices of a turn for its stored message", async () => {
    const notice = "Rampart stopped this turn after 8 model calls, the limit for one turn. Ask again in a new message to continue.";
    const answer = message({ id: "a-notice", role: "assistant", content: notice });
    mockFetch(() =>
      sseResponse([
        sseEvent("start", { user_message: userMessage, assistant_message_id: "a-notice", model_id: "m" }),
        sseEvent("delta", { text: notice }),
        sseEvent("notice", { kind: "model_calls", message: notice }),
        sseEvent("done", { assistant_message: answer }),
      ]),
    );
    const queryClient = seededClient();

    const snapshots = await runTurn(queryClient, "Go on");

    expect(snapshots.at(-1)?.notices).toEqual([{ kind: "model_calls", message: notice }]);
    expect(getTurnNotices("a-notice")).toEqual([{ kind: "model_calls", message: notice }]);
    expect(getTurnNotices("unknown")).toEqual([]);
  });

  it("shows a live turn until its stored copy takes over", () => {
    const base = {
      conversationId: "c1",
      userMessage: null,
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
      startedAt: 0,
      settled: false,
      generation: 1,
    } satisfies Omit<LiveTurn, "mode" | "assistantMessageId">;
    const stored = [message({ id: "a1", role: "assistant" })];
    const turn: LiveTurn = { ...base, mode: "turn", assistantMessageId: "a1" };
    const resume: LiveTurn = { ...base, mode: "resume", assistantMessageId: "a1" };

    expect(visibleLiveTurn(null, stored)).toBeNull();
    expect(visibleLiveTurn({ ...turn, assistantMessageId: "a2" }, stored)).not.toBeNull();
    expect(visibleLiveTurn(turn, stored)).toBeNull();
    // A resumed turn continues a message that is already stored.
    expect(visibleLiveTurn(resume, stored)).toBe(resume);
    expect(visibleLiveTurn({ ...resume, settled: true }, stored)).toBeNull();
  });
});

describe("describeRetrieval", () => {
  const search = (round: number): TurnRetrievalData => ({ phase: "search", round, query: `query ${round}` });
  const graded = (relevant: number): TurnRetrievalData => ({
    phase: "graded",
    round: 1,
    query: "query 1",
    mode: "hybrid",
    found: 5,
    relevant,
  });

  it("is null before the turn searched", () => {
    expect(describeRetrieval([])).toBeNull();
    expect(latestRetrievalMode([])).toBeNull();
  });

  it("names Rampart's guides in help mode and shows a rewritten query", () => {
    expect(describeRetrieval([search(1)], true)?.label).toBe("Searching Rampart's guides…");
    expect(describeRetrieval([search(1), graded(0), search(3)])).toEqual({
      phase: "searching",
      label: "Rewriting the query…",
      query: "query 3",
    });
  });

  it("counts relevant passages", () => {
    expect(describeRetrieval([search(1), graded(1)])).toMatchObject({ phase: "found", label: "1 relevant passage found" });
    expect(describeRetrieval([search(1), graded(0)])).toMatchObject({ phase: "nothing", label: "Nothing relevant found" });
    expect(latestRetrievalMode([search(1), graded(1)])).toBe("hybrid");
  });
});
