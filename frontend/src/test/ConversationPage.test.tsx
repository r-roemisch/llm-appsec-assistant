import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionContext } from "@/hooks/useSession";
import { session } from "@/lib/session";
import type { ConversationOut, MessageOut, ModelsOut } from "@/lib/types";
import { ConversationPage } from "@/pages/ConversationPage";
import {
  aliceSession,
  approval,
  callsTo,
  conversation,
  jsonResponse,
  message,
  mockFetch,
  model,
  renderWithProviders,
  sseEvent,
  sseResponse,
  toolCall,
} from "@/test/helpers";

const haiku = "anthropic/claude-haiku-5.5";
const models: ModelsOut = {
  models: [model({ id: haiku, display_name: "Claude Haiku 5.5" })],
  slots: {
    chat: { model_id: haiku, source: "default", temperature: null, max_tokens: 4096 },
    grader: { model_id: haiku, source: "default", temperature: null, max_tokens: 1024 },
    judge: { model_id: haiku, source: "default", temperature: null, max_tokens: 1024 },
    embedding: { model_id: "openai/text-embedding-3-small", source: "default", temperature: null, max_tokens: null },
  },
};

function renderPage(route: string) {
  return renderWithProviders(
    <SessionContext value={aliceSession}>
      <Routes>
        <Route path="/" element={<ConversationPage />} />
        <Route path="/c/:id" element={<ConversationPage />} />
      </Routes>
    </SessionContext>,
    { route },
  );
}

describe("ConversationPage help mode", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("turns help mode on for an existing Conversation with a PATCH and shows the badge", async () => {
    let current: ConversationOut = conversation({ id: "c1" });
    const fetchMock = mockFetch((url, method, init) => {
      if (url === "/api/models") return jsonResponse(200, models);
      if (url === "/api/conversations/c1" && method === "GET") {
        return jsonResponse(200, { conversation: current, messages: [] });
      }
      if (url === "/api/conversations/c1" && method === "PATCH") {
        current = { ...current, ...(JSON.parse(String(init.body)) as Partial<ConversationOut>) };
        return jsonResponse(200, current);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage("/c/c1");

    const toggle = await screen.findByRole("button", { name: "Help mode" });
    await waitFor(() => expect(toggle).toBeEnabled());
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Answers come only from Rampart's guides.")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Answers come only from Rampart's guides.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("placeholder", "Ask how to use Rampart");
    const [patch] = callsTo(fetchMock, "/api/conversations/c1", "PATCH");
    expect(JSON.parse(String(patch.body))).toEqual({ help_mode: true });
    expect(new Headers(patch.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("greets the user on '/' and creates a help-mode Conversation when the toggle is on", async () => {
    const created = conversation({ id: "c7", help_mode: true });
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/models") return jsonResponse(200, models);
      if (url === "/api/conversations" && method === "POST") return jsonResponse(201, created);
      if (url === "/api/conversations/c7" && method === "GET") {
        return jsonResponse(200, { conversation: created, messages: [] });
      }
      if (url === "/api/conversations/c7/messages" && method === "POST") {
        return sseResponse([
          sseEvent("start", {
            user_message: message({ id: "u1", role: "user", conversation_id: "c7", content: "Where do uploads go?" }),
            assistant_message_id: "a1",
            model_id: haiku,
          }),
        ]);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage("/");

    expect(screen.getByText("Hello, alice")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What are you building?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Help mode" }));
    expect(screen.getByRole("heading", { name: "What would you like to know about Rampart?" })).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/conversations")).toHaveLength(0);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Claude Haiku 5.5"));
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Where do uploads go?{Enter}");

    await waitFor(() => expect(callsTo(fetchMock, "/api/conversations/c7/messages", "POST")).toHaveLength(1));
    const [create] = callsTo(fetchMock, "/api/conversations", "POST");
    expect(JSON.parse(String(create.body))).toEqual({ model_id: haiku, help_mode: true });
  });
});

describe("ConversationPage Tools and Approvals (M3)", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  const question = message({ id: "u1", role: "user", content: "Test my staging bot for prompt injection" });
  const testArgs = { target_id: "t-staging", suite: "basic" };
  const waiting = message({
    id: "a1",
    role: "assistant",
    content: "I'll run the basic suite against your staging target.",
    model_id: haiku,
    status: "awaiting_approval",
    tool_calls: [
      toolCall({
        id: "call_1",
        tool: "run_injection_test",
        arguments: testArgs,
        decision: "approval_required",
        reason_code: "approval_pending",
        message: "waiting for approval by the user",
        status: "pending",
        approval_id: "ap1",
      }),
    ],
    guard_events: [
      {
        guard: "input",
        action: "redacted",
        category: "secret_in_input",
        detail: "Removed from your message before any model saw it: 1 openai_key. Rotate these credentials.",
      },
    ],
    pending_approval: approval({ arguments: testArgs }),
  });
  const answered = message({
    ...waiting,
    content: "I'll run the basic suite against your staging target.\n\nNone of the 12 probes got through.",
    status: "complete",
    tool_calls: [
      toolCall({
        id: "call_1",
        tool: "run_injection_test",
        arguments: testArgs,
        decision: "allow",
        reason_code: "approved",
        status: "ok",
        summary: "0 of 12 probes succeeded",
        provenance: "target",
      }),
    ],
    pending_approval: null,
  });

  it("shows the waiting answer, keeps the composer closed, and continues the same message after Approve", async () => {
    let messages: MessageOut[] = [question, waiting];
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/models") return jsonResponse(200, models);
      if (url === "/api/conversations") return jsonResponse(200, [conversation({ id: "c1" })]);
      if (url === "/api/conversations/c1" && method === "GET") {
        return jsonResponse(200, { conversation: conversation({ id: "c1", message_count: 2 }), messages });
      }
      if (url === "/api/conversations/c1/approvals/ap1" && method === "POST") {
        messages = [question, answered];
        return sseResponse([
          sseEvent("resume", { assistant_message_id: "a1", approval: approval({ status: "approved", decided_by: "alice" }) }),
          sseEvent("tool_call", {
            id: "call_1",
            tool: "run_injection_test",
            arguments: testArgs,
            decision: "allow",
            reason_code: "approved",
            message: "approved by the user",
            approval_id: "ap1",
          }),
          sseEvent("tool_result", {
            id: "call_1",
            tool: "run_injection_test",
            status: "ok",
            summary: "0 of 12 probes succeeded",
            provenance: "target",
            report_id: null,
          }),
          sseEvent("delta", { text: "\n\nNone of the 12 probes got through." }),
          sseEvent("done", { assistant_message: answered }),
        ]);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage("/c/c1");

    const card = await screen.findByRole("article", { name: "Tool call: Run an injection test" });
    expect(within(card).getByText("Waiting for approval")).toBeInTheDocument();
    expect(screen.getByText("1 secret removed from your message before any model saw it; rotate it if it is real")).toBeInTheDocument();
    const request = screen.getByRole("region", { name: "Approval request" });
    expect(within(request).getByLabelText("Arguments of Run an injection test to approve")).toHaveTextContent('"suite": "basic"');
    const composer = screen.getByRole("textbox", { name: "Message" });
    expect(composer).toBeDisabled();
    expect(composer).toHaveAttribute("placeholder", "Waiting for a decision on a tool call");
    expect(screen.getByText(/waiting for a decision on a tool call\. Decide above to continue\./)).toBeInTheDocument();

    await user.click(within(request).getByRole("button", { name: "Approve" }));

    // The same message continues: the text grows and the card shows the result.
    expect(await screen.findByText("None of the 12 probes got through.")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(screen.getByRole("article", { name: "Tool call: Run an injection test" })).getByText("Allowed")).toBeInTheDocument(),
    );
    expect(screen.getByText("0 of 12 probes succeeded")).toBeInTheDocument();
    expect(screen.getAllByText(/I'll run the basic suite against your staging target\./)).toHaveLength(1);
    expect(screen.queryByRole("region", { name: "Approval request" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled());
    const [decision] = callsTo(fetchMock, "/api/conversations/c1/approvals/ap1", "POST");
    expect(JSON.parse(String(decision.body))).toEqual({ decision: "approve" });
  });

  it("shows the server's detail when it refuses a new message with 409", async () => {
    mockFetch((url, method) => {
      if (url === "/api/models") return jsonResponse(200, models);
      if (url === "/api/conversations") return jsonResponse(200, [conversation({ id: "c1" })]);
      if (url === "/api/conversations/c1" && method === "GET") {
        return jsonResponse(200, { conversation: conversation({ id: "c1" }), messages: [] });
      }
      if (url === "/api/conversations/c1/messages" && method === "POST") {
        return jsonResponse(409, { detail: "this conversation is waiting for an approval; reject it to move on" });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderPage("/c/c1");

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(composer).toBeEnabled());
    await user.type(composer, "Next question{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "this conversation is waiting for an approval; reject it to move on",
    );
  });
});
