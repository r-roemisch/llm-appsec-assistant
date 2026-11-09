import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as api from "@/lib/api";
import { onUnauthorized, session } from "@/lib/session";
import { aliceSession, conversation, jsonResponse, model, profile, source, streamOf, target } from "@/test/helpers";

type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

function lastCall(fetchMock: FetchMock): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] ?? {} };
}

describe("api client", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    session.clear();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    session.clear();
  });

  it("login sends JSON with same-origin credentials and no CSRF header, then stores the session", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, aliceSession));

    const result = await api.login("alice", "secret");

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({ username: "alice", password: "secret" });
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("X-CSRF-Token")).toBe(false);
    expect(result).toEqual(aliceSession);
    expect(session.csrfToken()).toBe("csrf-token-1");
  });

  it("attaches the CSRF token to state-changing requests", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: "c1", title: "" }));

    await api.createConversation({ model_id: "anthropic/claude-haiku-5.5" });

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/conversations");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("attaches the CSRF token to PATCH and DELETE, not to GET", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "c1" }));
    await api.updateConversation("c1", { title: "Renamed" });
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await expect(api.deleteConversation("c1")).resolves.toBeUndefined();
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");

    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));
    await api.listConversations();
    expect(lastCall(fetchMock).init.method).toBe("GET");
    expect(new Headers(lastCall(fetchMock).init.headers).has("X-CSRF-Token")).toBe(false);
  });

  it("URL-encodes Model ids in paths", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, model({ id: "anthropic/claude-haiku-5.5", display_name: "Claude Haiku", enabled: false })),
    );

    await api.setModelEnabled("anthropic/claude-haiku-5.5", false);

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/admin/models/anthropic%2Fclaude-haiku-5.5");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ enabled: false });
  });

  it("addresses Slots by name", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await api.setSlot("grader", { temperature: null, model_id: "ollama/qwen3:8b" });
    expect(lastCall(fetchMock).url).toBe("/api/admin/models/slots/grader");
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual({ temperature: null, model_id: "ollama/qwen3:8b" });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await api.resetSlot("embedding");
    expect(lastCall(fetchMock).url).toBe("/api/admin/models/slots/embedding");
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
  });

  it("clears the session and notifies on a 401 outside login", async () => {
    session.set(aliceSession);
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: "Not authenticated" }));

    await expect(api.listConversations()).rejects.toMatchObject({ status: 401, detail: "Not authenticated" });

    expect(session.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not notify on a 401 from login and surfaces the server detail", async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: "Invalid username or password" }));

    const error = await api.login("alice", "wrong").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(api.ApiError);
    expect((error as api.ApiError).detail).toBe("Invalid username or password");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("joins validation error lists into one message", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        detail: [
          { loc: ["body", "username"], msg: "String should have at least 3 characters", type: "string_too_short" },
          { loc: ["body", "password"], msg: "String should have at least 8 characters", type: "string_too_short" },
        ],
      }),
    );

    await expect(api.createUser({ username: "a", password: "b", role: "user" })).rejects.toMatchObject({
      status: 422,
      detail: "username: String should have at least 3 characters; password: String should have at least 8 characters",
    });
  });

  it("wraps network failures", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api.getHealth()).rejects.toMatchObject({ status: 0, detail: "Could not reach the server" });
  });

  it("streams turn events with the CSRF token and an event-stream Accept header", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(
      new Response(
        streamOf([
          'event: start\ndata: {"assistant_message_id":"a1","model_id":"m"}\n\n',
          'event: delta\ndata: {"text":"Hi"}\n\n',
          'event: heartbeat\ndata: {"at":1}\n\n',
          'event: done\ndata: {"assistant_message":{"id":"a1"}}\n\n',
        ]),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      ),
    );

    const events = [];
    for await (const event of api.streamTurn("c1", "hello")) events.push(event);

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/conversations/c1/messages");
    expect(new Headers(init.headers).get("Accept")).toBe("text/event-stream");
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(events.map((event) => event.event)).toEqual(["start", "delta", "heartbeat", "done"]);
    expect(api.toTurnEvent(events[2])).toBeNull();
    expect(api.toTurnEvent(events[1])).toEqual({ event: "delta", data: { text: "Hi" } });
  });

  it("recognises the retrieval and citations events and skips unknown or malformed ones", () => {
    const search = { phase: "search", round: 1, query: "indirect prompt injection" };
    expect(api.toTurnEvent({ event: "retrieval", data: search })).toEqual({ event: "retrieval", data: search });
    expect(api.toTurnEvent({ event: "citations", data: { citations: [] } })?.event).toBe("citations");
    expect(api.toTurnEvent({ event: "heartbeat", data: { ok: true } })).toBeNull();
    expect(api.toTurnEvent({ event: "delta", data: "not json" })).toBeNull();
    expect(api.toTurnEvent({ event: "retrieval", data: null })).toBeNull();
  });

  it("uploads a file as multipart form data with the CSRF token and no JSON content type", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, source({ id: "s1", title: "notes.md", source_type: "upload", mine: true })),
    );
    const file = new File(["# Notes\n\nDelimit untrusted text."], "notes.md", { type: "text/markdown" });

    const created = await api.uploadSource(file);

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/knowledge/uploads");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBeInstanceOf(FormData);
    const sent = (init.body as FormData).get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("notes.md");
    const headers = new Headers(init.headers);
    expect(headers.get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(headers.has("Content-Type")).toBe(false);
    expect(created.title).toBe("notes.md");
  });

  it("surfaces the server detail when an upload is refused", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "You already uploaded this file" }));
    await expect(api.uploadSource(new File(["x"], "notes.md"))).rejects.toMatchObject({
      status: 409,
      detail: "You already uploaded this file",
    });
  });

  it("sends help_mode when creating and patching a Conversation", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(jsonResponse(201, conversation({ help_mode: true })));
    await api.createConversation({ help_mode: true });
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual({ help_mode: true });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, conversation({ help_mode: false })));
    await api.updateConversation("c1", { help_mode: false });
    expect(lastCall(fetchMock).init.method).toBe("PATCH");
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual({ help_mode: false });
  });

  it("reads the Knowledge Base, passages, the profile and the guides without a CSRF token", async () => {
    session.set(aliceSession);
    const reads: Array<[() => Promise<unknown>, string]> = [
      [api.getKnowledgeStatus, "/api/knowledge/status"],
      [api.listSources, "/api/knowledge/sources"],
      [() => api.getPassage("p 1/2"), "/api/knowledge/passages/p%201%2F2"],
      [api.getProfile, "/api/profile"],
      [api.getHelpDocs, "/api/help/docs"],
    ];
    for (const [read, expectedUrl] of reads) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
      await read();
      const { url, init } = lastCall(fetchMock);
      expect(url).toBe(expectedUrl);
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).has("X-CSRF-Token")).toBe(false);
    }
  });

  it("saves and deletes the profile and deletes uploads with the CSRF token", async () => {
    session.set(aliceSession);
    const input = {
      stack: "FastAPI",
      packages: [{ ecosystem: "PyPI", name: "fastapi", version: null }],
      target_ids: ["t-staging"],
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, profile({ exists: true, ...input })));
    await api.saveProfile(input);
    expect(lastCall(fetchMock).url).toBe("/api/profile");
    expect(lastCall(fetchMock).init.method).toBe("PUT");
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual(input);
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await expect(api.deleteProfile()).resolves.toBeUndefined();
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await api.deleteSource("s/1");
    expect(lastCall(fetchMock).url).toBe("/api/knowledge/sources/s%2F1");
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("lists, creates, updates and deletes Targets with the CSRF rules (M4)", async () => {
    session.set(aliceSession);
    const staging = target({ id: "t-staging", name: "Staging bot" });

    // GET /api/targets: no CSRF token.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, [staging]));
    await expect(api.listTargets()).resolves.toEqual([staging]);
    expect(lastCall(fetchMock).url).toBe("/api/targets");
    expect(lastCall(fetchMock).init.method).toBe("GET");
    expect(new Headers(lastCall(fetchMock).init.headers).has("X-CSRF-Token")).toBe(false);

    // POST /api/targets: JSON body and the CSRF token.
    const createInput = {
      name: "Staging bot",
      base_url: "http://127.0.0.1:8001",
      input_surface: "document_slot" as const,
      profile: "secure" as const,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, staging));
    await api.createTarget(createInput);
    expect(lastCall(fetchMock).url).toBe("/api/targets");
    expect(lastCall(fetchMock).init.method).toBe("POST");
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual(createInput);
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");

    // PATCH /api/targets/{id}: id encoded, CSRF token, clearing the profile.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, staging));
    await api.updateTarget("t/1", { name: "Renamed", profile: null });
    expect(lastCall(fetchMock).url).toBe("/api/targets/t%2F1");
    expect(lastCall(fetchMock).init.method).toBe("PATCH");
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toEqual({ name: "Renamed", profile: null });
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");

    // DELETE /api/targets/{id}: CSRF token.
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await expect(api.deleteTarget("t-staging")).resolves.toBeUndefined();
    expect(lastCall(fetchMock).url).toBe("/api/targets/t-staging");
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("surfaces the server detail when a Target is refused (M4)", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "This URL is already registered" }));
    await expect(
      api.createTarget({ name: "dup", base_url: "http://127.0.0.1:8001" }),
    ).rejects.toMatchObject({ status: 409, detail: "This URL is already registered" });
  });

  it("recognises the M3 stream events", () => {
    for (const name of ["resume", "guard", "tool_call", "tool_result", "notice", "approval_required"]) {
      expect(api.toTurnEvent({ event: name, data: { id: "x" } })?.event).toBe(name);
    }
    expect(api.toTurnEvent({ event: "tool_call", data: "call_1" })).toBeNull();
  });

  it("streams Approval decisions and continuations with the CSRF token", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(
      new Response(streamOf(['event: resume\ndata: {"assistant_message_id":"a1"}\n\n']), { status: 200 }),
    );
    const events = [];
    for await (const event of api.streamApprovalDecision("c 1", "ap/1", "reject")) events.push(event);
    let { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/conversations/c%201/approvals/ap%2F1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "reject" });
    expect(new Headers(init.headers).get("Accept")).toBe("text/event-stream");
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(events).toEqual([{ event: "resume", data: { assistant_message_id: "a1" } }]);

    fetchMock.mockResolvedValueOnce(new Response(streamOf([]), { status: 200 }));
    for await (const event of api.streamApprovalContinue("c1", "ap1")) void event;
    ({ url, init } = lastCall(fetchMock));
    expect(url).toBe("/api/conversations/c1/approvals/ap1/continue");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");

    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: "an administrator must approve this tool call" }));
    const refused = async () => {
      for await (const event of api.streamApprovalDecision("c1", "ap1", "approve")) void event;
    };
    await expect(refused()).rejects.toMatchObject({ status: 403, detail: "an administrator must approve this tool call" });
  });

  it("reads Reports, downloads by link and deletes with the CSRF token", async () => {
    session.set(aliceSession);
    const reads: Array<[() => Promise<unknown>, string]> = [
      [api.listReports, "/api/reports"],
      [() => api.getReport("r 1"), "/api/reports/r%201"],
    ];
    for (const [read, expectedUrl] of reads) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
      await read();
      expect(lastCall(fetchMock).url).toBe(expectedUrl);
      expect(lastCall(fetchMock).init.method).toBe("GET");
      expect(new Headers(lastCall(fetchMock).init.headers).has("X-CSRF-Token")).toBe(false);
    }
    expect(api.reportDownloadUrl("r/1")).toBe("/api/reports/r%2F1/download");

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await expect(api.deleteReport("r1")).resolves.toBeUndefined();
    expect(lastCall(fetchMock).url).toBe("/api/reports/r1");
    expect(lastCall(fetchMock).init.method).toBe("DELETE");
    expect(new Headers(lastCall(fetchMock).init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("calls the admin controls with query strings and JSON bodies", async () => {
    session.set(aliceSession);
    const calls: Array<[() => Promise<unknown>, string, string, unknown]> = [
      [api.listAdminTools, "GET", "/api/admin/tools", undefined],
      [() => api.updateTool("run_injection_test", { rate_limit_per_hour: null }), "PUT", "/api/admin/tools/run_injection_test", { rate_limit_per_hour: null }],
      [() => api.listApprovals(), "GET", "/api/admin/approvals", undefined],
      [() => api.listApprovals({ status: "pending", approver: "admin" }), "GET", "/api/admin/approvals?status=pending&approver=admin", undefined],
      [() => api.decideApproval("ap1", "approve"), "POST", "/api/admin/approvals/ap1", { decision: "approve" }],
      [() => api.listToolCallRecords({ limit: 50, tool: "", decision: "deny" }), "GET", "/api/admin/audit/tool-calls?limit=50&decision=deny", undefined],
      [() => api.listGuardEventRecords({ guard: "input" }), "GET", "/api/admin/audit/guard-events?guard=input", undefined],
      [api.getAdminSettings, "GET", "/api/admin/settings", undefined],
      [() => api.updateAdminSettings({ persona: null, input_classifier: true }), "PUT", "/api/admin/settings", { persona: null, input_classifier: true }],
    ];
    for (const [call, method, expectedUrl, expectedBody] of calls) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
      await call();
      const { url, init } = lastCall(fetchMock);
      expect(url).toBe(expectedUrl);
      expect(init.method).toBe(method);
      if (expectedBody === undefined) {
        expect(init.body).toBeUndefined();
        expect(new Headers(init.headers).has("X-CSRF-Token")).toBe(false);
      } else {
        expect(JSON.parse(String(init.body))).toEqual(expectedBody);
        expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
      }
    }
  });

  it("calls the Plugin endpoints with the CSRF rules and encoded ids (M5)", async () => {
    session.set(aliceSession);
    const digest = "f".repeat(64);
    const calls: Array<[() => Promise<unknown>, string, string, unknown]> = [
      [api.listPlugins, "GET", "/api/admin/plugins", undefined],
      [() => api.getPlugin("fixture docs"), "GET", "/api/admin/plugins/fixture%20docs", undefined],
      [() => api.setPluginEnabled("fixture_docs", true), "PUT", "/api/admin/plugins/fixture_docs", { enabled: true }],
      [() => api.setPluginEnabled("fixture_docs", false), "PUT", "/api/admin/plugins/fixture_docs", { enabled: false }],
      [() => api.acceptPlugin("fixture_docs", digest), "POST", "/api/admin/plugins/fixture_docs/accept", { digest }],
    ];
    for (const [call, method, expectedUrl, expectedBody] of calls) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
      await call();
      const { url, init } = lastCall(fetchMock);
      expect(url).toBe(expectedUrl);
      expect(init.method).toBe(method);
      expect(init.credentials).toBe("same-origin");
      if (expectedBody === undefined) {
        expect(init.body).toBeUndefined();
        expect(new Headers(init.headers).has("X-CSRF-Token")).toBe(false);
      } else {
        expect(JSON.parse(String(init.body))).toEqual(expectedBody);
        expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
      }
    }

    // Refresh is a POST without a body: still state-changing, so it carries the token.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await api.refreshPlugin("secret/scanner");
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/admin/plugins/secret%2Fscanner/refresh");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("surfaces a 409 from accepting stale Plugin definitions (M5)", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        detail: "the tool definitions changed since you reviewed them; review the current definitions and accept again",
      }),
    );
    await expect(api.acceptPlugin("fixture_docs", "0".repeat(64))).rejects.toMatchObject({
      status: 409,
      detail: "the tool definitions changed since you reviewed them; review the current definitions and accept again",
    });
  });

  it("sets and removes Feedback with the CSRF token and an encoded message id (M6)", async () => {
    session.set(aliceSession);
    const saved = { value: -1, comment: "Wrong item", created_at: "2026-11-09T08:00:00Z", updated_at: "2026-11-09T08:00:00Z" };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, saved));

    await expect(api.setFeedback("a1/x", { value: -1, comment: "Wrong item" })).resolves.toEqual(saved);
    let { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/messages/a1%2Fx/feedback");
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({ value: -1, comment: "Wrong item" });
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");

    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await expect(api.deleteFeedback("a1")).resolves.toBeUndefined();
    ({ url, init } = lastCall(fetchMock));
    expect(url).toBe("/api/messages/a1/feedback");
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("surfaces a 409 for Feedback on an unfinished answer (M6)", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "the answer is not finished yet" }));
    await expect(api.setFeedback("a1", { value: 1 })).rejects.toMatchObject({
      status: 409,
      detail: "the answer is not finished yet",
    });
  });

  it("calls the admin Feedback, Evaluation Case and evaluation endpoints with the CSRF rules (M6)", async () => {
    session.set(aliceSession);
    const calls: Array<[() => Promise<unknown>, string, string, unknown]> = [
      [() => api.getFeedbackDashboard(), "GET", "/api/admin/feedback", undefined],
      [() => api.getFeedbackDashboard({ value: -1, limit: 200 }), "GET", "/api/admin/feedback?value=-1&limit=200", undefined],
      [() => api.getFeedbackDashboard({ value: 1 }), "GET", "/api/admin/feedback?value=1", undefined],
      [
        () => api.createEvaluationCase("fb 1", { kind: "tool", question: "Check requests 2.25.0", expected_tools: ["lookup_vulnerabilities"] }),
        "POST",
        "/api/admin/feedback/fb%201/evaluation-case",
        { kind: "tool", question: "Check requests 2.25.0", expected_tools: ["lookup_vulnerabilities"] },
      ],
      [api.listEvaluationCases, "GET", "/api/admin/evaluation-cases", undefined],
      [api.getEvalDatasets, "GET", "/api/admin/eval/datasets", undefined],
      [() => api.estimateEval({ suite: "qa", limit: 3 }), "POST", "/api/admin/eval/estimate", { suite: "qa", limit: 3 }],
      [
        () => api.startEvalRuns({ suite: "qa", limit: 3, confirm_cost_usd: 0.2077 }),
        "POST",
        "/api/admin/eval/runs",
        { suite: "qa", limit: 3, confirm_cost_usd: 0.2077 },
      ],
      [
        () => api.startEvalRuns({ suite: "all", confirm_cost_usd: null }),
        "POST",
        "/api/admin/eval/runs",
        { suite: "all", confirm_cost_usd: null },
      ],
      [api.listEvalRuns, "GET", "/api/admin/eval/runs", undefined],
      [() => api.getEvalRun("run/1"), "GET", "/api/admin/eval/runs/run%2F1", undefined],
    ];
    for (const [call, method, expectedUrl, expectedBody] of calls) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
      await call();
      const { url, init } = lastCall(fetchMock);
      expect(url).toBe(expectedUrl);
      expect(init.method).toBe(method);
      expect(init.credentials).toBe("same-origin");
      if (expectedBody === undefined) {
        expect(init.body).toBeUndefined();
        expect(new Headers(init.headers).has("X-CSRF-Token")).toBe(false);
      } else {
        expect(JSON.parse(String(init.body))).toEqual(expectedBody);
        expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
      }
    }

    // Deleting a case is a DELETE without a body, still with the token.
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    await expect(api.deleteEvaluationCase("case/1")).resolves.toBeUndefined();
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("/api/admin/evaluation-cases/case%2F1");
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("surfaces the evaluation conflicts and validation errors (M6)", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { detail: "the estimate is now $0.2500; review it and confirm again" }),
    );
    await expect(api.startEvalRuns({ suite: "qa", confirm_cost_usd: 0.2077 })).rejects.toMatchObject({
      status: 409,
      detail: "the estimate is now $0.2500; review it and confirm again",
    });

    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "this Feedback is already Evaluation Case c-1" }));
    await expect(api.createEvaluationCase("fb1", { kind: "qa", question: "q", expected_answer: "a" })).rejects.toMatchObject({
      status: 409,
      detail: "this Feedback is already Evaluation Case c-1",
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { detail: [{ loc: ["body", "limit"], msg: "Input should be less than or equal to 500" }] }),
    );
    await expect(api.estimateEval({ suite: "qa", limit: 900 })).rejects.toMatchObject({
      status: 422,
      detail: "limit: Input should be less than or equal to 500",
    });
  });

  it("throws the server detail when a stream request is refused", async () => {
    session.set(aliceSession);
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { detail: "A turn is already streaming" }));
    const iterate = async () => {
      for await (const event of api.streamTurn("c1", "hello")) void event;
    };
    await expect(iterate()).rejects.toMatchObject({ status: 409, detail: "A turn is already streaming" });
  });
});
