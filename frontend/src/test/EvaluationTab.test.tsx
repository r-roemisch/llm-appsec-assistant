import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EvaluationTab } from "@/components/admin/EvaluationTab";
import { session } from "@/lib/session";
import type { EvalDatasetsOut, EvalEstimateOut, EvalRunDetailOut, EvalRunIn, EvalRunOut, EvaluationCaseOut } from "@/lib/types";
import {
  bobSession,
  callsTo,
  evalRun,
  evaluationCase,
  guardSet,
  jsonResponse,
  mockFetch,
  renderWithProviders,
  suiteEstimate,
} from "@/test/helpers";

function body(init: RequestInit): unknown {
  return JSON.parse(String(init.body));
}

const datasets: EvalDatasetsOut = {
  qa: { authored: 30, added: 2 },
  tool: { authored: 20, added: 1 },
  guard: { cases: 104, holdout: 30 },
};

const QA_REPORT = `# Evaluation report: qa

| | |
|---|---|
| Run | r-done |
| Judge Model | openai/gpt-6.1-sol |
| Actual cost | $0.0897 |

## Metrics

| Metric | Mean score | Passed | Scored |
|---|---|---|---|
| Faithfulness | 0.917 | 3 | 3 |

Cases added from Feedback are listed by id only. <img src=x onerror=alert(1)>`;

function qaEstimate(total: number): EvalEstimateOut {
  return {
    estimates: [
      suiteEstimate({
        suite: "qa",
        cases: 3,
        judge_model: "openai/gpt-6.1-sol",
        model_calls: 9,
        judge_calls: 33,
        cost_usd: total,
      }),
    ],
    total_usd: total,
  };
}

interface Server {
  runs: EvalRunOut[];
  cases: EvaluationCaseOut[];
  estimate: (input: unknown, call: number) => EvalEstimateOut;
  start: (input: EvalRunIn, call: number) => Response;
  detail: (id: string) => EvalRunDetailOut | undefined;
}

/** The evaluation endpoints over mutable state; `overrides` decide estimates, starts and details. */
function mockEvaluation(overrides: Partial<Server> = {}) {
  const server: Server = {
    runs: [],
    cases: [],
    estimate: () => qaEstimate(0.2077),
    start: () => jsonResponse(500),
    detail: () => undefined,
    ...overrides,
  };
  let estimates = 0;
  let starts = 0;
  const fetchMock = mockFetch((url, method, init) => {
    if (url === "/api/admin/eval/datasets") return jsonResponse(200, datasets);
    if (url === "/api/admin/evaluation-cases" && method === "GET") return jsonResponse(200, server.cases);
    const caseMatch = /^\/api\/admin\/evaluation-cases\/(.+)$/.exec(url);
    if (caseMatch && method === "DELETE") {
      server.cases = server.cases.filter((item) => item.id !== caseMatch[1]);
      return jsonResponse(204);
    }
    if (url === "/api/admin/eval/runs" && method === "GET") return jsonResponse(200, server.runs);
    if (url === "/api/admin/eval/estimate" && method === "POST") {
      estimates += 1;
      return jsonResponse(200, server.estimate(body(init), estimates));
    }
    if (url === "/api/admin/eval/runs" && method === "POST") {
      starts += 1;
      return server.start(body(init) as EvalRunIn, starts);
    }
    const runMatch = /^\/api\/admin\/eval\/runs\/(.+)$/.exec(url);
    if (runMatch && method === "GET") {
      const detail = server.detail(runMatch[1]);
      return detail ? jsonResponse(200, detail) : jsonResponse(404, { detail: "there is no such evaluation run" });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  return { fetchMock, server };
}

async function chooseSuite(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("combobox", { name: "Suite" }));
  await user.click(await screen.findByRole("option", { name }));
}

describe("Admin: Evaluation (M6)", () => {
  beforeEach(() => session.set(bobSession));
  afterEach(() => {
    session.clear();
    vi.useRealTimers();
  });

  it("shows the dataset sizes and the added cases, and deletes a case after a confirm", async () => {
    const { fetchMock } = mockEvaluation({
      cases: [
        evaluationCase({ id: "e1e2e3e4-0000-4000-8000-000000000001" }),
        evaluationCase({
          id: "f5f6f7f8-0000-4000-8000-000000000002",
          kind: "tool",
          question: "Check requests 2.25.0 for known vulnerabilities",
          expected_answer: null,
          expected_tools: ["lookup_vulnerabilities"],
          source: "feedback:9a8b7c6d5e4f",
          created_by: null,
        }),
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<EvaluationTab />);

    const qa = await screen.findByText("Answer quality (qa)", { selector: "dt" });
    expect(qa.parentElement).toHaveTextContent("32 cases30 authored, 2 added from Feedback");
    expect(screen.getByText("Tool choice (tool)", { selector: "dt" }).parentElement).toHaveTextContent("21 cases");
    expect(screen.getByText("Input Guard (guard)", { selector: "dt" }).parentElement).toHaveTextContent(
      "134 cases104 written with the rules, 30 held out",
    );
    // What each suite costs is said before anything is estimated (all suites are chosen at first).
    const costs = screen.getByRole("list", { name: "What the chosen suites cost" });
    expect(costs).toHaveTextContent(
      "Answer quality (qa) Costs real money: Rampart answers every question and a judge Model scores every answer.",
    );
    expect(costs).toHaveTextContent("Tool choice (tool) Costs a little");
    expect(costs).toHaveTextContent("Input Guard (guard) Free");

    const list = await screen.findByRole("list", { name: "Added Evaluation Cases" });
    const first = within(list).getByRole("listitem", { name: "Evaluation Case e1e2e3e4" });
    expect(first).toHaveTextContent("Question and answer");
    expect(first).toHaveTextContent("How do I stop indirect prompt injection in a RAG app?");
    expect(first).toHaveTextContent("Expected answer: Treat retrieved text as data");
    expect(first).toHaveTextContent("From Feedback fb1");
    expect(first).toHaveTextContent("added by bob");
    const second = within(list).getByRole("listitem", { name: "Evaluation Case f5f6f7f8" });
    expect(second).toHaveTextContent("Expected Tools: Look up known vulnerabilities");
    expect(second).toHaveTextContent("From Feedback 9a8b7c6d");

    await user.click(within(first).getByRole("button", { name: "Delete Evaluation Case e1e2e3e4" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete this Evaluation Case?" });
    expect(confirm).toHaveTextContent("The Feedback it came from stays");
    expect(callsTo(fetchMock, "/api/admin/evaluation-cases/e1e2e3e4-0000-4000-8000-000000000001")).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Delete the case" }));

    await waitFor(() =>
      expect(callsTo(fetchMock, "/api/admin/evaluation-cases/e1e2e3e4-0000-4000-8000-000000000001", "DELETE")).toHaveLength(1),
    );
    const [remove] = callsTo(fetchMock, "/api/admin/evaluation-cases/e1e2e3e4-0000-4000-8000-000000000001", "DELETE");
    expect(new Headers(remove.headers).get("X-CSRF-Token")).toBe("csrf-token-2");
    await waitFor(() => expect(within(list).queryByRole("listitem", { name: "Evaluation Case e1e2e3e4" })).not.toBeInTheDocument());
    // The dataset sizes are fetched again too.
    expect(callsTo(fetchMock, "/api/admin/eval/datasets").length).toBeGreaterThanOrEqual(2);
  });

  it("estimates a qa run, says loudly that it costs money, and starts it with the total shown", async () => {
    const queued = evalRun({ id: "r-new", status: "queued", cost_usd: null, metrics: null, report_name: null, finished_at: null });
    const { fetchMock, server } = mockEvaluation({
      start: () => {
        server.runs = [queued];
        return jsonResponse(202, [queued]);
      },
    });
    const user = userEvent.setup();
    renderWithProviders(<EvaluationTab />);

    await screen.findByText("No runs yet.", { exact: false });
    await chooseSuite(user, "Answer quality (qa)");
    expect(screen.getByRole("list", { name: "What the chosen suites cost" })).toHaveTextContent("Costs real money");
    await user.type(screen.getByRole("spinbutton", { name: /First N cases/ }), "3");
    // Nothing can run before an estimate.
    expect(screen.queryByRole("button", { name: /^Run/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Estimate" }));

    const panel = await screen.findByRole("region", { name: "Estimate" });
    const [request] = callsTo(fetchMock, "/api/admin/eval/estimate", "POST");
    expect(body(request)).toEqual({ suite: "qa", limit: 3 });
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("csrf-token-2");

    const note = within(panel).getByRole("note", { name: "Judge cost" });
    expect(note).toHaveTextContent("Answer quality (qa) spends real money: about $0.21");
    expect(note).toHaveTextContent("Rampart answers 3 questions (9 Model calls), and the judge openai/gpt-6.1-sol scores every answer (33 judge calls)");
    const row = within(panel).getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "Answer quality (qa)judge openai/gpt-6.1-sol",
      "3",
      "9",
      "33",
      "$0.2077",
    ]);
    expect(panel).toHaveTextContent("Total: $0.2077");
    expect(callsTo(fetchMock, "/api/admin/eval/runs", "POST")).toHaveLength(0);

    await user.click(within(panel).getByRole("button", { name: "Run for about $0.21" }));

    await waitFor(() => expect(callsTo(fetchMock, "/api/admin/eval/runs", "POST")).toHaveLength(1));
    const [start] = callsTo(fetchMock, "/api/admin/eval/runs", "POST");
    expect(body(start)).toEqual({ suite: "qa", limit: 3, confirm_cost_usd: 0.2077 });
    expect(new Headers(start.headers).get("X-CSRF-Token")).toBe("csrf-token-2");
    await waitFor(() => expect(screen.queryByRole("region", { name: "Estimate" })).not.toBeInTheDocument());
    const runs = await screen.findByRole("list", { name: "Evaluation runs" });
    expect(within(runs).getByRole("listitem", { name: "Answer quality (qa) run, Queued" })).toBeInTheDocument();
  });

  it("on a 409 shows why, estimates again and confirms only the new total", async () => {
    const queued = evalRun({ id: "r-new", status: "queued", cost_usd: null, metrics: null, finished_at: null });
    const { fetchMock } = mockEvaluation({
      estimate: (_input, call) => qaEstimate(call === 1 ? 0.2077 : 0.25),
      start: (_input, call) =>
        call === 1
          ? jsonResponse(409, { detail: "the estimate is now $0.2500; review it and confirm again" })
          : jsonResponse(202, [queued]),
    });
    const user = userEvent.setup();
    renderWithProviders(<EvaluationTab />);

    await chooseSuite(user, "Answer quality (qa)");
    await user.click(screen.getByRole("button", { name: "Estimate" }));
    const panel = await screen.findByRole("region", { name: "Estimate" });
    await user.click(within(panel).getByRole("button", { name: "Run for about $0.21" }));

    const alert = await within(screen.getByRole("region", { name: "Estimate" })).findByRole("alert");
    expect(alert).toHaveTextContent("Nothing was started: the estimate is now $0.2500; review it and confirm again");
    // The estimate is fetched again with the same request, and the button names the new total.
    const again = await screen.findByRole("button", { name: "Run for about $0.25" });
    const estimates = callsTo(fetchMock, "/api/admin/eval/estimate", "POST");
    expect(estimates).toHaveLength(2);
    expect(body(estimates[1])).toEqual({ suite: "qa" });

    await user.click(again);
    await waitFor(() => expect(callsTo(fetchMock, "/api/admin/eval/runs", "POST")).toHaveLength(2));
    expect(body(callsTo(fetchMock, "/api/admin/eval/runs", "POST")[1])).toEqual({ suite: "qa", confirm_cost_usd: 0.25 });
  });

  it("forgets the estimate when the suite changes, and names an unknown cost", async () => {
    mockEvaluation({
      estimate: (input) =>
        (input as { suite: string }).suite === "all"
          ? {
              estimates: [
                suiteEstimate({
                  suite: "qa",
                  judge_model: "vendor/judge",
                  judge_calls: 33,
                  cost_usd: null,
                  notes: ["no price listed for the judge vendor/judge"],
                }),
                suiteEstimate({ suite: "tool", cost_usd: 0.0123, notes: ["Tool correctness is deterministic: no judge calls."] }),
                suiteEstimate({
                  suite: "guard",
                  cases: 134,
                  chat_model: null,
                  model_calls: 0,
                  cost_usd: 0,
                  notes: ["Deterministic: the input Guard's rules run locally, no Model is called."],
                }),
              ],
              total_usd: null,
            }
          : { estimates: [suiteEstimate({ suite: "guard", cases: 134, model_calls: 0, cost_usd: 0 })], total_usd: 0 },
    });
    const user = userEvent.setup();
    renderWithProviders(<EvaluationTab />);

    await user.click(await screen.findByRole("button", { name: "Estimate" }));
    const panel = await screen.findByRole("region", { name: "Estimate" });
    expect(within(panel).getByRole("note", { name: "Judge cost" })).toHaveTextContent(
      "Answer quality (qa) spends real money: the amount is unknown",
    );
    expect(within(panel).getByRole("list", { name: "Notes" })).toHaveTextContent(
      "Answer quality (qa): no price listed for the judge vendor/judge",
    );
    expect(within(panel).getByText("Total", { selector: "td" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Run (cost unknown)" })).toBeEnabled();

    await chooseSuite(user, "Input Guard (guard)");
    expect(screen.queryByRole("region", { name: "Estimate" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Estimate" }));
    const guard = await screen.findByRole("region", { name: "Estimate" });
    expect(within(guard).queryByRole("note", { name: "Judge cost" })).not.toBeInTheDocument();
    expect(within(guard).getByRole("button", { name: "Run (free)" })).toBeInTheDocument();
  });

  it("checks the case limit before estimating", async () => {
    const { fetchMock } = mockEvaluation();
    const user = userEvent.setup();
    renderWithProviders(<EvaluationTab />);

    await user.type(await screen.findByRole("spinbutton", { name: /First N cases/ }), "0");
    await user.click(screen.getByRole("button", { name: "Estimate" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a whole number of cases from 1 to 500");
    expect(callsTo(fetchMock, "/api/admin/eval/estimate")).toHaveLength(0);
  });

  it("lists runs with their state, cost and metrics, and blocks a new run while one is active", async () => {
    mockEvaluation({
      runs: [
        evalRun({ id: "r-running", status: "running", cost_usd: null, metrics: null, report_name: null, finished_at: null }),
        evalRun({
          id: "r-failed",
          kind: "deepeval_tool",
          suite: "tool",
          status: "failed",
          judge_model: null,
          cost_usd: null,
          case_limit: null,
          metrics: null,
          error: "RuntimeError: the judge Model could not be used, so no turns were run",
          started_by: null,
        }),
        evalRun({
          id: "r-tool",
          kind: "deepeval_tool",
          suite: "tool",
          judge_model: null,
          case_count: 20,
          case_limit: null,
          estimated_cost_usd: 0.0123,
          cost_usd: 0.0101,
          metrics: { tool_correctness: { mean: 0.9, passed: 18, scored: 20, skipped: 0, errors: 0, total: 20 } },
        }),
        evalRun({
          id: "r-guard",
          kind: "guard",
          suite: "guard",
          judge_model: null,
          estimated_cost_usd: 0,
          cost_usd: 0,
          case_count: 134,
          case_limit: null,
          metrics: { cases: guardSet(), holdout: guardSet({ adversarial: 15, benign: 15, recall: 0.4, false_positive_rate: 0 }) },
        }),
        evalRun({ id: "r-done" }),
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<EvaluationTab />);

    const list = await screen.findByRole("list", { name: "Evaluation runs" });
    const running = within(list).getByRole("listitem", { name: "Answer quality (qa) run, Running" });
    expect(running.querySelector('[data-status="running"] svg')).toHaveClass("animate-spin");
    expect(running).toHaveTextContent("Started by bob");
    expect(running).toHaveTextContent("estimated $0.2077 · actual when done");
    expect(screen.getByText(/Checking every 3 seconds/)).toBeInTheDocument();

    const failed = within(list).getByRole("listitem", { name: "Tool choice (tool) run, Failed" });
    expect(failed.querySelector('[data-status="failed"]')).toHaveClass("text-destructive");
    expect(failed).toHaveTextContent("RuntimeError: the judge Model could not be used");
    expect(failed).toHaveTextContent("Started from the command line");

    const tool = within(list).getByRole("listitem", { name: "Tool choice (tool) run, Done" });
    expect(within(tool).getByRole("definition")).toHaveTextContent("18/20 passed");
    expect(tool).toHaveTextContent("20 cases");
    expect(tool).toHaveTextContent("estimated $0.0123 · actual $0.0101");

    const guard = within(list).getByRole("listitem", { name: "Input Guard (guard) run, Done" });
    const metrics = within(guard).getByLabelText("Metrics");
    expect(metrics).toHaveTextContent("Written setprecision 100.0% · recall 96.2% · FPR 0.0% · 52 adversarial, 52 benign");
    expect(metrics).toHaveTextContent("Held-out setprecision 100.0% · recall 40.0% · FPR 0.0% · 15 adversarial, 15 benign");

    const done = within(list).getByRole("listitem", { name: "Answer quality (qa) run, Done" });
    expect(done.querySelector('[data-status="done"]')).toHaveClass("text-success");
    expect(within(done).getByLabelText("Metrics")).toHaveTextContent("Faithfulness0.92 · 3/3 passed");
    expect(within(done).getByLabelText("Metrics")).toHaveTextContent("Contextual recall0.75 · 2/2 passed, 1 skipped");
    expect(done).toHaveTextContent("took 2 min 15 s");
    expect(done).toHaveTextContent("3 cases (the first 3)");

    // A run is active: the server would refuse another one, so the button is off.
    await user.click(screen.getByRole("button", { name: "Estimate" }));
    const panel = await screen.findByRole("region", { name: "Estimate" });
    expect(within(panel).getByRole("button", { name: "Run for about $0.21" })).toBeDisabled();
    expect(panel).toHaveTextContent("A run is queued or running");
  });

  it("polls the runs every 3 seconds while one is queued or running, and stops once all are done", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = evalRun({ id: "r1", status: "running", cost_usd: null, metrics: null, finished_at: null });
    const { fetchMock, server } = mockEvaluation({ runs: [running] });
    renderWithProviders(<EvaluationTab />);

    const list = await screen.findByRole("list", { name: "Evaluation runs" });
    expect(within(list).getByRole("listitem", { name: "Answer quality (qa) run, Running" })).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/admin/eval/runs", "GET")).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(3000));
    await waitFor(() => expect(callsTo(fetchMock, "/api/admin/eval/runs", "GET")).toHaveLength(2));

    server.runs = [evalRun({ id: "r1" })];
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(await within(list).findByRole("listitem", { name: "Answer quality (qa) run, Done" })).toBeInTheDocument();
    const settled = callsTo(fetchMock, "/api/admin/eval/runs", "GET").length;
    expect(settled).toBe(3);

    // Idle: no more requests, however long the page stays open.
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(callsTo(fetchMock, "/api/admin/eval/runs", "GET")).toHaveLength(settled);
    expect(screen.queryByText(/Checking every 3 seconds/)).not.toBeInTheDocument();
  });

  it("opens a finished run with every field and its Markdown report", async () => {
    const done = evalRun({ id: "r-done" });
    const { fetchMock } = mockEvaluation({
      runs: [done],
      detail: (id) => (id === "r-done" ? { ...done, report_markdown: QA_REPORT } : undefined),
    });
    const user = userEvent.setup();
    renderWithProviders(<EvaluationTab />, { route: "/admin?tab=evaluation" });

    const row = await screen.findByRole("listitem", { name: "Answer quality (qa) run, Done" });
    await user.click(within(row).getByRole("button", { name: "Report" }));

    const dialog = await screen.findByRole("dialog", { name: /Answer quality \(qa\) run/ });
    const report = await within(dialog).findByRole("article", { name: "Evaluation report" });
    expect(within(report).getByRole("heading", { level: 1, name: "Evaluation report: qa" })).toBeInTheDocument();
    expect(within(report).getAllByRole("table")).toHaveLength(2);
    // Like answers: no raw HTML.
    expect(report.querySelector("img")).toBeNull();
    expect(callsTo(fetchMock, "/api/admin/eval/runs/r-done", "GET")).toHaveLength(1);

    expect(dialog).toHaveTextContent("deepeval_qa");
    expect(dialog).toHaveTextContent("by bob");
    expect(dialog).toHaveTextContent("openai/gpt-6.1-sol");
    expect(dialog).toHaveTextContent("estimated $0.2077 · actual $0.0897");
    expect(dialog).toHaveTextContent("3 cases (the first 3)");
    expect(dialog).toHaveTextContent("docs/reports/eval/20261109-073415-qa-299dcefc.md");
    expect(within(dialog).getByLabelText("Metrics")).toHaveTextContent("Answer relevancy1.00 · 3/3 passed");
  });

  it("explains that a running run's report comes later, and opens the run named in the URL", async () => {
    const running = evalRun({ id: "r-running", status: "running", cost_usd: null, metrics: null, report_name: null, finished_at: null });
    mockEvaluation({ runs: [running], detail: () => ({ ...running, report_markdown: null }) });
    renderWithProviders(<EvaluationTab />, { route: "/admin?tab=evaluation&run=r-running" });

    const dialog = await screen.findByRole("dialog", { name: /Answer quality \(qa\) run/ });
    expect(await within(dialog).findByText(/The report appears when the run is done/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("Not yet");
    expect(within(dialog).queryByRole("article", { name: "Evaluation report" })).not.toBeInTheDocument();
  });
});
