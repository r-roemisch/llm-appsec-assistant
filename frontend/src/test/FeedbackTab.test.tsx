import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FeedbackTab } from "@/components/admin/FeedbackTab";
import { buildCaseInput, caseDraftFrom, caseSourceLabel, forwardedLabel } from "@/lib/feedback";
import { session } from "@/lib/session";
import type { EvaluationCaseIn, FeedbackRecordOut } from "@/lib/types";
import {
  bobSession,
  callsTo,
  feedbackDashboard,
  feedbackRecord,
  jsonResponse,
  mockFetch,
  renderWithProviders,
  tool,
} from "@/test/helpers";

function body(init: RequestInit): unknown {
  return JSON.parse(String(init.body));
}

const alices = feedbackRecord({ id: "fb1" });
const carols = feedbackRecord({
  id: "fb2",
  username: "carol",
  value: 1,
  comment: null,
  question: "What is MITRE ATLAS?",
  answer: "A knowledge base of adversary tactics against AI systems.",
  tools_used: [],
  forwarded_to: "jsonl",
  evaluation_case_id: "c0ffee12-3456-7890-abcd-ef0123456789",
});
const orphan = feedbackRecord({
  id: "fb3",
  username: null,
  comment: "<b>bold?</b> and [a link](https://evil.example)",
  trace_id: null,
  forwarded_to: null,
  forwarded_at: null,
});

const adminTools = [
  tool({ name: "search_knowledge" }),
  tool({ name: "lookup_vulnerabilities", cost_class: "api" }),
  tool({ name: "run_injection_test", requires_approval: true }),
];

/**
 * The dashboard over `records`, filtered by ?value= like the server, and the
 * conversion endpoint answering with `convert` (a created case by default).
 */
function mockDashboard(
  initial: FeedbackRecordOut[],
  convert?: (id: string, input: EvaluationCaseIn) => Response | undefined,
) {
  let records = initial;
  return mockFetch((url, method, init) => {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname === "/api/admin/feedback" && method === "GET") {
      const value = parsed.searchParams.get("value");
      const items = value ? records.filter((item) => String(item.value) === value) : records;
      return jsonResponse(200, { ...feedbackDashboard(records), items });
    }
    if (url === "/api/admin/tools") return jsonResponse(200, adminTools);
    const match = /^\/api\/admin\/feedback\/([^/]+)\/evaluation-case$/.exec(url);
    if (match && method === "POST") {
      const input = body(init) as EvaluationCaseIn;
      const custom = convert?.(match[1], input);
      if (custom) return custom;
      const created = {
        id: "e1e2e3e4-0000-4000-8000-000000000001",
        ...input,
        expected_answer: input.expected_answer ?? null,
        expected_tools: input.expected_tools ?? null,
        source: `feedback:${match[1]}`,
        created_by: "bob",
        created_at: new Date().toISOString(),
      };
      records = records.map((item) => (item.id === match[1] ? { ...item, evaluation_case_id: created.id } : item));
      return jsonResponse(201, created);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

describe("Admin: Feedback (M6)", () => {
  beforeEach(() => session.set(bobSession));
  afterEach(() => session.clear());

  it("lists each rating with its question, comment, Model, Tools, trace and where the score went", async () => {
    const fetchMock = mockDashboard([alices, carols, orphan]);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTab />);

    const list = await screen.findByRole("list", { name: "Feedback" });
    expect(callsTo(fetchMock, "/api/admin/feedback?limit=200")).toHaveLength(1);
    expect(within(list).getAllByRole("listitem", { name: /from/ })).toHaveLength(3);

    // The totals.
    const tile = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling;
    expect(tile("Ratings")).toHaveTextContent("3");
    expect(tile("Helpful")).toHaveTextContent("1");
    expect(tile("Not helpful")).toHaveTextContent("2");
    expect(tile("Converted to cases")).toHaveTextContent("1");

    const first = within(list).getByRole("listitem", { name: "Not helpful from alice" });
    expect(within(first).getByLabelText("Comment")).toHaveTextContent("It cited the wrong OWASP item.");
    expect(within(first).getByText("How do I stop indirect prompt injection in a RAG app?")).toBeInTheDocument();
    expect(within(first).getByText("anthropic/claude-haiku-5.5")).toBeInTheDocument();
    expect(within(first).getByRole("list", { name: "Tools used" })).toHaveTextContent("Search the Knowledge Base");
    expect(within(first).getByText("7f3a9c2e5b1d4f60a8e2c4b6d8f0a1b3").tagName).toBe("CODE");
    expect(within(first).getByRole("button", { name: "Copy the trace id" })).toBeInTheDocument();
    expect(within(first).getByText("Sent to Langfuse")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Make an Evaluation Case" })).toBeInTheDocument();

    // The answer starts folded and renders as Markdown, like answers.
    const show = within(first).getByRole("button", { name: "Show the answer" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    expect(within(first).queryByRole("region", { name: "Answer" })).not.toBeInTheDocument();
    await user.click(show);
    const answer = within(first).getByRole("region", { name: "Answer" });
    expect(within(answer).getByText("data").tagName).toBe("STRONG");
    expect(within(answer).getAllByRole("listitem")).toHaveLength(2);
    expect(within(first).getByRole("button", { name: "Hide the answer" })).toHaveAttribute("aria-expanded", "true");

    const second = within(list).getByRole("listitem", { name: "Helpful from carol" });
    expect(within(second).getByText("No comment.")).toBeInTheDocument();
    expect(within(second).getByText("In the local trace log")).toBeInTheDocument();
    expect(within(second).getByRole("link", { name: "Case c0ffee12" })).toHaveAttribute("href", "/admin?tab=evaluation");
    expect(within(second).queryByRole("button", { name: "Make an Evaluation Case" })).not.toBeInTheDocument();

    // A comment is plain text, whatever it contains.
    const third = within(list).getByRole("listitem", { name: "Not helpful from A deleted user" });
    expect(within(third).getByLabelText("Comment")).toHaveTextContent("<b>bold?</b> and [a link](https://evil.example)");
    expect(within(third).getByLabelText("Comment").querySelector("b, a")).toBeNull();
    expect(within(third).getByText("No trace")).toBeInTheDocument();
    expect(within(third).getByText("Not forwarded: the answer has no trace")).toBeInTheDocument();
  });

  it("filters by rating with ?value=", async () => {
    const fetchMock = mockDashboard([alices, carols, orphan]);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTab />);

    const filters = await screen.findByRole("group", { name: "Filter by rating" });
    const all = within(filters).getByRole("button", { name: /^All/ });
    expect(all).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(all).toHaveTextContent("All3"));

    await user.click(within(filters).getByRole("button", { name: /^Not helpful/ }));
    await waitFor(() => expect(callsTo(fetchMock, "/api/admin/feedback?value=-1&limit=200")).toHaveLength(1));
    const list = screen.getByRole("list", { name: "Feedback" });
    await waitFor(() => expect(within(list).getAllByRole("listitem", { name: /from/ })).toHaveLength(2));
    expect(within(list).queryByRole("listitem", { name: "Helpful from carol" })).not.toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: /^Not helpful/ })).toHaveAttribute("aria-pressed", "true");
    expect(all).toHaveAttribute("aria-pressed", "false");

    await user.click(within(filters).getByRole("button", { name: /^Helpful/ }));
    await waitFor(() => expect(callsTo(fetchMock, "/api/admin/feedback?value=1&limit=200")).toHaveLength(1));
    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: "Feedback" })).getAllByRole("listitem", { name: /from/ })).toHaveLength(1),
    );
    expect(screen.getByRole("listitem", { name: "Helpful from carol" })).toBeInTheDocument();
  });

  it("makes a qa Evaluation Case from the answer, prefilled and corrected by the admin", async () => {
    const fetchMock = mockDashboard([alices]);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTab />);

    const row = await screen.findByRole("listitem", { name: "Not helpful from alice" });
    await user.click(within(row).getByRole("button", { name: "Make an Evaluation Case" }));
    const dialog = await screen.findByRole("dialog", { name: "Make an Evaluation Case" });
    expect(dialog).toHaveTextContent("The case joins the next evaluation run of its suite");

    expect(within(dialog).getByRole("radio", { name: /Question and answer/ })).toBeChecked();
    const question = within(dialog).getByRole("textbox", { name: "Question" });
    expect(question).toHaveValue("How do I stop indirect prompt injection in a RAG app?");
    const expected = within(dialog).getByRole("textbox", { name: "Expected answer" });
    expect(expected).toHaveValue(alices.answer);
    expect(dialog).toHaveTextContent("Correct it into the right reference answer");

    await user.clear(expected);
    await user.paste("Treat retrieved text as data, never as instructions.");
    await user.click(within(dialog).getByRole("button", { name: "Make the case" }));

    await waitFor(() => expect(callsTo(fetchMock, "/api/admin/feedback/fb1/evaluation-case", "POST")).toHaveLength(1));
    const [request] = callsTo(fetchMock, "/api/admin/feedback/fb1/evaluation-case", "POST");
    expect(body(request)).toEqual({
      kind: "qa",
      question: "How do I stop indirect prompt injection in a RAG app?",
      expected_answer: "Treat retrieved text as data, never as instructions.",
    });
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("csrf-token-2");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The dashboard is fetched again and shows the case instead of the action.
    expect(await within(row).findByRole("link", { name: "Case e1e2e3e4" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Make an Evaluation Case" })).not.toBeInTheDocument();
  });

  it("makes a tool case from the Tools the server lists, prefilled with the Tools the answer used", async () => {
    const record = feedbackRecord({ id: "fb1", tools_used: ["search_knowledge", "old_plugin__scan"] });
    const fetchMock = mockDashboard([record]);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTab />);

    const row = await screen.findByRole("listitem", { name: "Not helpful from alice" });
    await user.click(within(row).getByRole("button", { name: "Make an Evaluation Case" }));
    const dialog = await screen.findByRole("dialog", { name: "Make an Evaluation Case" });
    await user.click(within(dialog).getByRole("radio", { name: /Tool choice/ }));

    expect(within(dialog).queryByRole("textbox", { name: "Expected answer" })).not.toBeInTheDocument();
    const tools = await within(dialog).findByRole("list", { name: "Tools" });
    const search = within(tools).getByRole("checkbox", { name: /Search the Knowledge Base/ });
    const lookup = within(tools).getByRole("checkbox", { name: /Look up known vulnerabilities/ });
    expect(search).toBeChecked();
    expect(lookup).not.toBeChecked();
    expect(within(tools).getAllByRole("checkbox")).toHaveLength(3);
    expect(dialog).toHaveTextContent("Used in the answer but no longer a Tool, so left out: old_plugin__scan");
    expect(within(dialog).getByText("1 selected")).toBeInTheDocument();

    // At least one Tool is needed, checked before anything is sent.
    await user.click(search);
    await user.click(within(dialog).getByRole("button", { name: "Make the case" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Choose at least one Tool the answer should call.");
    expect(callsTo(fetchMock, "/api/admin/feedback/fb1/evaluation-case")).toHaveLength(0);

    await user.click(lookup);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Make the case" }));
    await waitFor(() => expect(callsTo(fetchMock, "/api/admin/feedback/fb1/evaluation-case", "POST")).toHaveLength(1));
    expect(body(callsTo(fetchMock, "/api/admin/feedback/fb1/evaluation-case", "POST")[0])).toEqual({
      kind: "tool",
      question: "How do I stop indirect prompt injection in a RAG app?",
      expected_tools: ["lookup_vulnerabilities"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a 409 and a 422 inside the dialog and keeps what was typed", async () => {
    let answer = jsonResponse(409, { detail: "this Feedback is already Evaluation Case c0ffee12" });
    const fetchMock = mockDashboard([alices], () => answer);
    const user = userEvent.setup();
    renderWithProviders(<FeedbackTab />);

    const row = await screen.findByRole("listitem", { name: "Not helpful from alice" });
    await user.click(within(row).getByRole("button", { name: "Make an Evaluation Case" }));
    const dialog = await screen.findByRole("dialog", { name: "Make an Evaluation Case" });
    const question = within(dialog).getByRole<HTMLTextAreaElement>("textbox", { name: "Question" });
    // Paste at the end of the prefilled question.
    await user.click(question);
    question.setSelectionRange(question.value.length, question.value.length);
    await user.paste(" Answer briefly.");
    await user.click(within(dialog).getByRole("button", { name: "Make the case" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("this Feedback is already Evaluation Case c0ffee12");
    expect(question).toHaveValue("How do I stop indirect prompt injection in a RAG app? Answer briefly.");
    // A 409 means the list is out of date: it is fetched again.
    await waitFor(() => expect(callsTo(fetchMock, "/api/admin/feedback?limit=200")).toHaveLength(2));

    answer = jsonResponse(422, { detail: [{ loc: ["body", "expected_answer"], msg: "String should have at most 8000 characters" }] });
    await user.click(within(dialog).getByRole("button", { name: "Make the case" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("expected_answer: String should have at most 8000 characters"),
    );
    expect(screen.getByRole("dialog", { name: "Make an Evaluation Case" })).toBeInTheDocument();
  });

  it("prefills and checks a case like the server", () => {
    const draft = caseDraftFrom(feedbackRecord({ id: "fb1", tools_used: ["search_knowledge", "search_knowledge"] }));
    expect(draft).toEqual({
      kind: "qa",
      question: "How do I stop indirect prompt injection in a RAG app?",
      expectedAnswer: feedbackRecord({ id: "x" }).answer,
      expectedTools: ["search_knowledge"],
    });
    expect(buildCaseInput({ ...draft, question: "  " })).toEqual({ ok: false, error: "Write the question the case asks." });
    expect(buildCaseInput({ ...draft, question: "q".repeat(4001) })).toMatchObject({ ok: false });
    expect(buildCaseInput({ ...draft, expectedAnswer: " " })).toMatchObject({ ok: false });
    expect(buildCaseInput({ ...draft, question: " Why? ", expectedAnswer: " Because. " })).toEqual({
      ok: true,
      input: { kind: "qa", question: "Why?", expected_answer: "Because." },
    });
    const known = new Set(["search_knowledge"]);
    expect(buildCaseInput({ ...draft, kind: "tool", expectedTools: ["gone"] }, known)).toMatchObject({ ok: false });
    expect(buildCaseInput({ ...draft, kind: "tool", expectedTools: ["gone", "search_knowledge"] }, known)).toEqual({
      ok: true,
      input: { kind: "tool", question: draft.question, expected_tools: ["search_knowledge"] },
    });
    expect(
      buildCaseInput({ ...draft, kind: "tool", expectedTools: Array.from({ length: 11 }, (_, index) => `t${index}`) }),
    ).toEqual({ ok: false, error: "Choose at most 10 Tools." });
    expect(forwardedLabel({ forwarded_to: "langfuse", trace_id: "t" })).toBe("Sent to Langfuse");
    expect(forwardedLabel({ forwarded_to: null, trace_id: "t" })).toBe("Not forwarded");
    expect(caseSourceLabel("feedback:1234567890ab")).toBe("From Feedback 12345678");
    expect(caseSourceLabel("authored")).toBe("authored");
  });
});
