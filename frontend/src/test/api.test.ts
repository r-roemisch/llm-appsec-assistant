import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as api from "@/lib/api";
import { onUnauthorized, session } from "@/lib/session";
import { aliceSession, jsonResponse, model, streamOf } from "@/test/helpers";

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
          'event: guard\ndata: {"verdict":"allow"}\n\n',
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
    expect(events.map((event) => event.event)).toEqual(["start", "delta", "guard", "done"]);
    expect(api.toTurnEvent(events[2])).toBeNull();
    expect(api.toTurnEvent(events[1])).toEqual({ event: "delta", data: { text: "Hi" } });
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
