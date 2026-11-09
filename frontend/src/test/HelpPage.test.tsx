import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { session } from "@/lib/session";
import type { HelpDocOut } from "@/lib/types";
import { HelpPage } from "@/pages/HelpPage";
import {
  aliceSession,
  callsTo,
  conversation,
  jsonResponse,
  message,
  mockFetch,
  renderWithProviders,
  sseEvent,
  sseResponse,
} from "@/test/helpers";

const docs: HelpDocOut[] = [
  {
    slug: "user_guide",
    title: "User guide",
    audience: "everyone",
    markdown: "# Using Rampart\n\nUpload files on the **Knowledge Base** page.\n\n<script>window.pwned = true</script>",
  },
  {
    slug: "admin_guide",
    title: "Admin guide",
    audience: "admin",
    markdown: "# Running Rampart\n\nRun `rampart ingest` to add the shared Sources.",
  },
];

function renderHelp() {
  return renderWithProviders(
    <Routes>
      <Route path="/help" element={<HelpPage />} />
      <Route path="/c/:id" element={<p>Opened the Conversation</p>} />
    </Routes>,
    { route: "/help" },
  );
}

describe("HelpPage", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("renders the guides as Markdown and labels the admin guide", async () => {
    mockFetch((url) => {
      if (url === "/api/help/docs") return jsonResponse(200, docs);
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    const { container } = renderHelp();

    expect(await screen.findByRole("heading", { name: "Using Rampart" })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    const adminTab = screen.getByRole("tab", { name: /Admin guide/ });
    expect(adminTab).toHaveTextContent("For administrators");

    await user.click(adminTab);
    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Running Rampart" })).toBeInTheDocument();
    expect(within(panel).getByText("For administrators")).toBeInTheDocument();
  });

  it("starts a help-mode Conversation with the question and opens it", async () => {
    const created = conversation({ id: "c9", title: "How do I upload a PDF?", help_mode: true });
    const userMessage = message({ id: "u1", role: "user", conversation_id: "c9", content: "How do I upload a PDF?" });
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/help/docs") return jsonResponse(200, docs);
      if (url === "/api/conversations" && method === "POST") return jsonResponse(201, created);
      if (url === "/api/conversations" && method === "GET") return jsonResponse(200, [created]);
      if (url === "/api/conversations/c9/messages" && method === "POST") {
        return sseResponse([
          sseEvent("start", { user_message: userMessage, assistant_message_id: "a1", model_id: created.model_id }),
          sseEvent("done", { assistant_message: message({ id: "a1", role: "assistant", conversation_id: "c9" }) }),
        ]);
      }
      if (url === "/api/conversations/c9") return jsonResponse(200, { conversation: created, messages: [] });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderHelp();

    await user.type(screen.getByRole("textbox", { name: "Your question about Rampart" }), "How do I upload a PDF?");
    await user.click(screen.getByRole("button", { name: "Ask" }));

    expect(await screen.findByText("Opened the Conversation")).toBeInTheDocument();
    const [create] = callsTo(fetchMock, "/api/conversations", "POST");
    expect(JSON.parse(String(create.body))).toEqual({ help_mode: true });
    await waitFor(() => expect(callsTo(fetchMock, "/api/conversations/c9/messages", "POST")).toHaveLength(1));
    const [send] = callsTo(fetchMock, "/api/conversations/c9/messages", "POST");
    expect(JSON.parse(String(send.body))).toEqual({ content: "How do I upload a PDF?" });
  });

  it("does not send an empty question", async () => {
    mockFetch((url) => {
      if (url === "/api/help/docs") return jsonResponse(200, docs);
      throw new Error(`Unexpected request: ${url}`);
    });
    renderHelp();
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });
});
