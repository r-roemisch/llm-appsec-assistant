import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MessageItem } from "@/components/conversation/MessageItem";
import { SessionContext } from "@/hooks/useSession";
import { canRate, feedbackInput, nextFeedback } from "@/lib/feedback";
import { session } from "@/lib/session";
import type { FeedbackIn, MessageOut, ModelsOut } from "@/lib/types";
import { ConversationPage } from "@/pages/ConversationPage";
import {
  aliceSession,
  approval,
  callsTo,
  conversation,
  feedback,
  jsonResponse,
  message,
  mockFetch,
  model,
  renderWithProviders,
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

const FEEDBACK_URL = "/api/messages/a1/feedback";

function body(init: RequestInit): unknown {
  return JSON.parse(String(init.body));
}

/** A gate a mocked request waits at, so a test can look at the state before the server answers. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/**
 * The Conversation page with one question and one finished answer. PUT and
 * DELETE on the answer's Feedback answer like the server unless `respond`
 * says otherwise.
 */
function renderConversation(
  answer: Partial<MessageOut> = {},
  respond?: (method: string, input: FeedbackIn | null) => Response | undefined | Promise<Response | undefined>,
) {
  const messages = [
    message({ id: "u1", role: "user", content: "How do I stop indirect prompt injection?" }),
    message({ id: "a1", role: "assistant", content: "Treat retrieved text as data.", model_id: haiku, ...answer }),
  ];
  const fetchMock = mockFetch(async (url, method, init) => {
    if (url === "/api/models") return jsonResponse(200, models);
    if (url === "/api/conversations/c1" && method === "GET") {
      return jsonResponse(200, { conversation: conversation({ id: "c1" }), messages });
    }
    if (url === FEEDBACK_URL && (method === "PUT" || method === "DELETE")) {
      const input = method === "PUT" ? (body(init) as FeedbackIn) : null;
      const custom = await respond?.(method, input);
      if (custom) return custom;
      if (!input) return jsonResponse(204);
      return jsonResponse(200, {
        value: input.value,
        comment: input.comment ?? null,
        created_at: "2026-11-09T09:00:00Z",
        updated_at: "2026-11-09T09:00:00Z",
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  const user = userEvent.setup();
  renderWithProviders(
    <SessionContext value={aliceSession}>
      <Routes>
        <Route path="/c/:id" element={<ConversationPage />} />
      </Routes>
    </SessionContext>,
    { route: "/c/c1" },
  );
  return { fetchMock, user };
}

describe("Feedback on answers (M6)", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("rates an answer helpful at once with a PUT, then removes the rating with a DELETE", async () => {
    const saving = gate();
    const { fetchMock, user } = renderConversation({}, async (method) => {
      if (method === "PUT") await saving.opened;
      return undefined;
    });

    const group = await screen.findByRole("group", { name: "Rate this answer" });
    const helpful = within(group).getByRole("button", { name: "Helpful" });
    const notHelpful = within(group).getByRole("button", { name: "Not helpful" });
    expect(helpful).toHaveAttribute("aria-pressed", "false");
    expect(notHelpful).toHaveAttribute("aria-pressed", "false");

    await user.click(helpful);

    // The thumb shows the rating before the server has answered.
    await waitFor(() => expect(helpful).toHaveAttribute("aria-pressed", "true"));
    expect(notHelpful).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(callsTo(fetchMock, FEEDBACK_URL, "PUT")).toHaveLength(1));
    const [put] = callsTo(fetchMock, FEEDBACK_URL, "PUT");
    expect(body(put)).toEqual({ value: 1 });
    expect(new Headers(put.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    saving.open();

    // The comment form opens and says who sees the rating, and that it changes nothing by itself.
    const form = screen.getByRole("form", { name: "Comment on this answer" });
    expect(within(form).getByRole("textbox", { name: /What made this answer helpful\?/ })).toHaveFocus();
    expect(form).toHaveTextContent(
      "Administrators see your rating and comment together with your question and this answer, to help improve Rampart. Feedback alone never changes how Rampart answers.",
    );
    await user.click(within(form).getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("form", { name: "Comment on this answer" })).not.toBeInTheDocument();
    expect(helpful).toHaveFocus();
    expect(helpful).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Add a comment" })).toBeInTheDocument();

    // The pressed thumb again removes the rating.
    await user.click(helpful);
    await waitFor(() => expect(helpful).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(callsTo(fetchMock, FEEDBACK_URL, "DELETE")).toHaveLength(1));
    const [remove] = callsTo(fetchMock, FEEDBACK_URL, "DELETE");
    expect(remove.body).toBeUndefined();
    expect(new Headers(remove.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(within(group).queryByRole("button", { name: "Add a comment" })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, FEEDBACK_URL, "PUT")).toHaveLength(1);
  });

  it("asks what was wrong after a thumbs down and saves the comment with the rating", async () => {
    const { fetchMock, user } = renderConversation();

    const group = await screen.findByRole("group", { name: "Rate this answer" });
    await user.click(within(group).getByRole("button", { name: "Not helpful" }));
    await waitFor(() => expect(callsTo(fetchMock, FEEDBACK_URL, "PUT")).toHaveLength(1));
    expect(body(callsTo(fetchMock, FEEDBACK_URL, "PUT")[0])).toEqual({ value: -1 });

    const form = screen.getByRole("form", { name: "Comment on this answer" });
    const comment = within(form).getByRole("textbox", { name: /What was wrong with this answer\?/ });
    await user.click(comment);
    await user.paste("  It cited the wrong OWASP item.  ");
    expect(within(form).getByText("30 / 1,000")).toBeInTheDocument();
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(callsTo(fetchMock, FEEDBACK_URL, "PUT")).toHaveLength(2));
    expect(body(callsTo(fetchMock, FEEDBACK_URL, "PUT")[1])).toEqual({ value: -1, comment: "It cited the wrong OWASP item." });
    await waitFor(() => expect(screen.queryByRole("form", { name: "Comment on this answer" })).not.toBeInTheDocument());
    expect(within(group).getByRole("button", { name: "Not helpful" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Edit your comment" })).toBeInTheDocument();
  });

  it("keeps the comment when the other thumb is chosen, and lets the user edit it", async () => {
    const { fetchMock, user } = renderConversation({ feedback: feedback({ value: -1, comment: "Too vague." }) });

    const group = await screen.findByRole("group", { name: "Rate this answer" });
    expect(within(group).getByRole("button", { name: "Not helpful" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "Helpful" }));

    await waitFor(() => expect(callsTo(fetchMock, FEEDBACK_URL, "PUT")).toHaveLength(1));
    expect(body(callsTo(fetchMock, FEEDBACK_URL, "PUT")[0])).toEqual({ value: 1, comment: "Too vague." });
    const form = screen.getByRole("form", { name: "Comment on this answer" });
    const comment = within(form).getByRole("textbox", { name: /What made this answer helpful\?/ });
    expect(comment).toHaveValue("Too vague.");

    // Clearing the comment and saving sends the rating alone, which clears it on the server.
    await user.clear(comment);
    await user.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(callsTo(fetchMock, FEEDBACK_URL, "PUT")).toHaveLength(2));
    expect(body(callsTo(fetchMock, FEEDBACK_URL, "PUT")[1])).toEqual({ value: 1 });
    expect(await within(group).findByRole("button", { name: "Add a comment" })).toBeInTheDocument();
  });

  it("puts the thumb back when the server refuses the rating", async () => {
    const { fetchMock, user } = renderConversation({}, (method) =>
      method === "PUT" ? jsonResponse(409, { detail: "the answer is not finished yet" }) : undefined,
    );

    const group = await screen.findByRole("group", { name: "Rate this answer" });
    const notHelpful = within(group).getByRole("button", { name: "Not helpful" });
    await user.click(notHelpful);

    await waitFor(() => expect(callsTo(fetchMock, FEEDBACK_URL, "PUT")).toHaveLength(1));
    await waitFor(() => expect(notHelpful).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByRole("form", { name: "Comment on this answer" })).not.toBeInTheDocument();
  });

  it("does not save a comment longer than 1000 characters", async () => {
    const { fetchMock, user } = renderConversation({ feedback: feedback({ value: -1, comment: null }) });

    const group = await screen.findByRole("group", { name: "Rate this answer" });
    await user.click(within(group).getByRole("button", { name: "Add a comment" }));
    const form = screen.getByRole("form", { name: "Comment on this answer" });
    const comment = within(form).getByRole("textbox", { name: /What was wrong/ });
    await user.click(comment);
    await user.paste("x".repeat(1001));

    expect(within(form).getByText("1,001 / 1,000")).toHaveClass("text-destructive");
    expect(within(form).getByRole("alert")).toHaveTextContent("The comment is longer than 1,000 characters.");
    expect(within(form).getByRole("button", { name: "Save" })).toBeDisabled();
    expect(callsTo(fetchMock, FEEDBACK_URL)).toHaveLength(0);
  });
});

describe("Which answers can be rated (M6)", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  function renderMessage(item: MessageOut) {
    mockFetch((url, method) => {
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    return renderWithProviders(
      <SessionContext value={aliceSession}>
        <MessageItem message={item} modelName="Claude Haiku 5.5" />
      </SessionContext>,
    );
  }

  it.each([
    ["complete", true],
    ["error", true],
    ["streaming", false],
    ["awaiting_approval", false],
  ] as const)("shows the thumbs on a %s answer: %s", (status, shown) => {
    renderMessage(
      message({
        id: "a1",
        role: "assistant",
        content: "Partial answer",
        status,
        error: status === "error" ? "client disconnected" : null,
        pending_approval: status === "awaiting_approval" ? approval() : null,
      }),
    );
    if (shown) {
      const group = screen.getByRole("group", { name: "Rate this answer" });
      expect(within(group).getByRole("button", { name: "Helpful" })).toBeInTheDocument();
      expect(within(group).getByRole("button", { name: "Not helpful" })).toBeInTheDocument();
    } else {
      expect(screen.queryByRole("group", { name: "Rate this answer" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Helpful" })).not.toBeInTheDocument();
    }
  });

  it("never shows thumbs on the user's own messages", () => {
    renderMessage(message({ id: "u1", role: "user", content: "Hello" }));
    expect(screen.queryByRole("group", { name: "Rate this answer" })).not.toBeInTheDocument();
  });

  it("decides what a click sends", () => {
    expect(canRate({ role: "assistant", status: "complete" })).toBe(true);
    expect(canRate({ role: "assistant", status: "awaiting_approval" })).toBe(false);
    expect(canRate({ role: "user", status: "complete" })).toBe(false);
    expect(nextFeedback(null, 1)).toEqual({ value: 1 });
    expect(nextFeedback(feedback({ value: 1, comment: null }), 1)).toBeNull();
    expect(nextFeedback(feedback({ value: -1, comment: "Too vague." }), 1)).toEqual({ value: 1, comment: "Too vague." });
    expect(feedbackInput(-1, "   ")).toEqual({ value: -1 });
    expect(feedbackInput(-1, "  ok  ")).toEqual({ value: -1, comment: "ok" });
  });
});
