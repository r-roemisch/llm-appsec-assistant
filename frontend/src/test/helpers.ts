import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { vi, type Mock } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ShellContext, type ShellState } from "@/hooks/useShell";
import type {
  AdminSettingsOut,
  ApprovalOut,
  CitationOut,
  ConversationOut,
  EvalRunOut,
  EvaluationCaseOut,
  FeedbackDashboardOut,
  FeedbackOut,
  FeedbackRecordOut,
  GuardSetMetrics,
  KnowledgeStatusOut,
  MessageOut,
  ModelOut,
  PluginCatalogOut,
  PluginDetailOut,
  PluginOut,
  PluginToolOut,
  ProfileOut,
  ReportOut,
  SessionOut,
  SourceOut,
  SuiteEstimateOut,
  TargetOut,
  ToolCallOut,
  ToolOut,
  UserOut,
} from "@/lib/types";

export type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

export function jsonResponse(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** One server-sent event as the backend writes it. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function sseResponse(chunks: string[]): Response {
  return new Response(streamOf(chunks), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** Stubs fetch with a handler that gets the URL, the method and the init. */
export function mockFetch(
  handler: (url: string, method: string, init: RequestInit) => Response | Promise<Response>,
): FetchMock {
  const fetchMock: FetchMock = vi.fn(async (input, init) => handler(String(input), init?.method ?? "GET", init ?? {}));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The calls made to `url` (and `method`, when given). */
export function callsTo(fetchMock: FetchMock, url: string, method?: string): RequestInit[] {
  return fetchMock.mock.calls
    .filter(([input, init]) => String(input) === url && (!method || (init?.method ?? "GET") === method))
    .map(([, init]) => init ?? {});
}

const shell: ShellState = {
  collapsed: false,
  toggleCollapsed: () => undefined,
  mobileOpen: false,
  setMobileOpen: () => undefined,
};

/**
 * Renders `ui` inside the app's providers: TanStack Query without retries, a
 * memory router, tooltips and the shell that PageHeader reads.
 */
export function renderWithProviders(ui: ReactElement, { route = "/" }: { route?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Providers({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        MemoryRouter,
        { initialEntries: [route] },
        createElement(ShellContext, { value: shell }, createElement(TooltipProvider, null, children)),
      ),
    );
  }
  return { queryClient, ...render(ui, { wrapper: Providers }) };
}

export const alice: UserOut = {
  id: 1,
  username: "alice",
  role: "user",
  created_at: "2026-11-01T09:00:00Z",
};

export const aliceSession: SessionOut = { user: alice, csrf_token: "csrf-token-1" };

export const bob: UserOut = {
  id: 2,
  username: "bob",
  role: "admin",
  created_at: "2026-11-01T09:00:00Z",
};

export const bobSession: SessionOut = { user: bob, csrf_token: "csrf-token-2" };

export function model(overrides: Partial<ModelOut> & Pick<ModelOut, "id" | "display_name">): ModelOut {
  return {
    provider: "openrouter",
    kind: "chat",
    tier: "cheap",
    enabled: true,
    available: true,
    context_length: 200_000,
    notes: null,
    ...overrides,
  };
}

export function conversation(overrides: Partial<ConversationOut> = {}): ConversationOut {
  return {
    id: "c1",
    title: "Indirect prompt injection",
    model_id: "anthropic/claude-haiku-5.5",
    created_at: "2026-11-08T09:00:00Z",
    updated_at: "2026-11-08T09:00:00Z",
    message_count: 0,
    total_cost_usd: 0,
    help_mode: false,
    ...overrides,
  };
}

export function message(overrides: Partial<MessageOut> & Pick<MessageOut, "id" | "role">): MessageOut {
  return {
    conversation_id: "c1",
    content: "",
    created_at: "2026-11-08T09:00:00Z",
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
    ...overrides,
  };
}

export function citation(overrides: Partial<CitationOut> & Pick<CitationOut, "n">): CitationOut {
  return {
    passage_id: `p${overrides.n}`,
    source_id: "s-owasp",
    source_title: "OWASP Top 10 for LLM Applications 2025",
    source_type: "curated",
    origin: "https://genai.owasp.org/llm-top-10/",
    heading: "LLM01:2025 Prompt Injection > Prevention and Mitigation Strategies",
    snippet: "Constrain model behavior by giving specific instructions about the model's role and limits.",
    provenance: "source",
    ...overrides,
  };
}

export function source(overrides: Partial<SourceOut> & Pick<SourceOut, "id" | "title">): SourceOut {
  return {
    source_type: "curated",
    origin: "https://genai.owasp.org/llm-top-10/",
    license_note: "CC BY-SA 4.0",
    mine: false,
    synthetic: false,
    fetched_at: "2026-11-07T12:00:00Z",
    passage_count: 42,
    embedded_count: 42,
    size_bytes: null,
    ...overrides,
  };
}

export function knowledgeStatus(overrides: Partial<KnowledgeStatusOut> = {}): KnowledgeStatusOut {
  return {
    retrieval_mode: "hybrid",
    reason: null,
    embedding_model_id: "openai/text-embedding-3-small",
    embedding_available: true,
    sources: 3,
    passages: 120,
    embedded_passages: 120,
    uploads: 1,
    max_uploads: 50,
    max_upload_bytes: 5 * 1024 * 1024,
    upload_types: [".pdf", ".md", ".markdown", ".txt"],
    ...overrides,
  };
}

export function profile(overrides: Partial<ProfileOut> = {}): ProfileOut {
  return {
    exists: false,
    stack: "",
    packages: [],
    target_ids: [],
    updated_at: null,
    ecosystems: ["PyPI", "npm", "Go", "crates.io"],
    ...overrides,
  };
}

export function toolCall(overrides: Partial<ToolCallOut> & Pick<ToolCallOut, "id" | "tool">): ToolCallOut {
  return {
    arguments: {},
    decision: null,
    reason_code: null,
    message: null,
    status: null,
    summary: null,
    provenance: null,
    report_id: null,
    approval_id: null,
    contributed_by: null,
    ...overrides,
  };
}

/** A pending Approval for run_injection_test that expires in 15 minutes. */
export function approval(overrides: Partial<ApprovalOut> = {}): ApprovalOut {
  const now = Date.now();
  return {
    id: "ap1",
    conversation_id: "c1",
    message_id: "a1",
    tool: "run_injection_test",
    arguments: { target_id: "t-staging", suite: "basic" },
    approver: "requester",
    status: "pending",
    requested_by: "alice",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 15 * 60_000).toISOString(),
    decided_by: null,
    decided_at: null,
    ...overrides,
  };
}

export function tool(overrides: Partial<ToolOut> & Pick<ToolOut, "name">): ToolOut {
  return {
    description: "",
    contributed_by: "builtin",
    enabled: true,
    requires_approval: false,
    approver: "requester",
    rate_limit_per_hour: null,
    cost_class: "free",
    allowed_roles: ["user", "admin"],
    json_schema: {},
    blocked: null,
    ...overrides,
  };
}

export const DIGEST_A = "a".repeat(64);
export const DIGEST_B = "b".repeat(64);
export const DIGEST_C = "c".repeat(64);

/** One Tool definition as a Plugin's server listed it. */
export function pluginTool(overrides: Partial<PluginToolOut> & Pick<PluginToolOut, "name">): PluginToolOut {
  return {
    exposed_name: `fixture_docs__${overrides.name}`,
    title: null,
    description: "",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    output_schema: null,
    annotations: null,
    warnings: [],
    ...overrides,
  };
}

/** A catalog entry; by default the fixture docs Plugin, listed and accepted. */
export function plugin(overrides: Partial<PluginOut> = {}): PluginOut {
  return {
    id: "fixture_docs",
    title: "Fixture docs",
    description: "Read-only access to a few synthetic internal security notes.",
    in_catalog: true,
    catalog_error: null,
    command: "/usr/bin/python3 /srv/rampart/plugins/fixture_docs/server.py",
    enabled: true,
    status: "ok",
    accepted_tools_digest: DIGEST_A,
    current_tools_digest: DIGEST_A,
    tool_count: 2,
    last_seen: "2026-11-08T09:30:00Z",
    last_error: null,
    accepted_at: "2026-11-07T15:00:00Z",
    accepted_by: "bob",
    ...overrides,
  };
}

/** A Plugin with its definitions; changes default to none. */
export function pluginDetail(overrides: Partial<PluginDetailOut> = {}): PluginDetailOut {
  const tools = [
    pluginTool({ name: "list_docs", description: "List the available notes with their ids and titles." }),
    pluginTool({
      name: "read_doc",
      description: "Read one note by its id.",
      input_schema: {
        type: "object",
        properties: { doc_id: { type: "string", maxLength: 64, description: "A document id from list_docs." } },
        required: ["doc_id"],
        additionalProperties: false,
      },
    }),
  ];
  return {
    ...plugin(),
    current_tools: tools,
    accepted_tools: tools,
    changes: { added: [], removed: [], changed: [] },
    ...overrides,
  };
}

export function pluginCatalog(plugins: PluginOut[], catalogError: string | null = null): PluginCatalogOut {
  return { catalog_error: catalogError, plugins };
}

export function report(overrides: Partial<ReportOut> & Pick<ReportOut, "id" | "title">): ReportOut {
  return {
    conversation_id: "c1",
    created_at: "2026-11-08T10:15:00Z",
    size: 2048,
    ...overrides,
  };
}

export function target(overrides: Partial<TargetOut> & Pick<TargetOut, "id" | "name">): TargetOut {
  return {
    base_url: "http://127.0.0.1:8001",
    input_surface: "user_message",
    profile: null,
    registered_at: "2026-11-08T09:00:00Z",
    ...overrides,
  };
}

/** A thumbs down with a comment, as the requesting user sees it on the answer (M6). */
export function feedback(overrides: Partial<FeedbackOut> = {}): FeedbackOut {
  return {
    value: -1,
    comment: "It cited the wrong OWASP item.",
    created_at: "2026-11-09T08:00:00Z",
    updated_at: "2026-11-09T08:00:00Z",
    ...overrides,
  };
}

/** One row of the admin Feedback dashboard: alice's thumbs down, sent to Langfuse, not converted (M6). */
export function feedbackRecord(overrides: Partial<FeedbackRecordOut> & Pick<FeedbackRecordOut, "id">): FeedbackRecordOut {
  return {
    created_at: "2026-11-09T08:00:00Z",
    updated_at: "2026-11-09T08:00:00Z",
    username: "alice",
    value: -1,
    comment: "It cited the wrong OWASP item.",
    conversation_id: "c1",
    message_id: "a1",
    question: "How do I stop indirect prompt injection in a RAG app?",
    answer: "Treat retrieved text as **data**, not instructions [1].\n\n- Keep tools behind approvals\n- Filter outputs",
    model_id: "anthropic/claude-haiku-5.5",
    tools_used: ["search_knowledge"],
    trace_id: "7f3a9c2e5b1d4f60a8e2c4b6d8f0a1b3",
    forwarded_to: "langfuse",
    forwarded_at: "2026-11-09T08:00:01Z",
    evaluation_case_id: null,
    ...overrides,
  };
}

export function feedbackDashboard(items: FeedbackRecordOut[], totals: Partial<FeedbackDashboardOut> = {}): FeedbackDashboardOut {
  return {
    up: items.filter((item) => item.value === 1).length,
    down: items.filter((item) => item.value === -1).length,
    converted: items.filter((item) => item.evaluation_case_id).length,
    items,
    ...totals,
  };
}

export function evaluationCase(overrides: Partial<EvaluationCaseOut> & Pick<EvaluationCaseOut, "id">): EvaluationCaseOut {
  return {
    kind: "qa",
    question: "How do I stop indirect prompt injection in a RAG app?",
    expected_answer: "Treat retrieved text as data, never as instructions; keep Tools behind approvals.",
    expected_tools: null,
    source: "feedback:fb1",
    created_by: "bob",
    created_at: "2026-11-09T08:30:00Z",
    ...overrides,
  };
}

/** A finished qa run of three cases with all four metrics (M6). */
export function evalRun(overrides: Partial<EvalRunOut> & Pick<EvalRunOut, "id">): EvalRunOut {
  return {
    kind: "deepeval_qa",
    suite: "qa",
    status: "done",
    judge_model: "openai/gpt-6.1-sol",
    estimated_cost_usd: 0.2077,
    cost_usd: 0.0897,
    case_count: 3,
    case_limit: 3,
    metrics: {
      faithfulness: { mean: 0.9167, passed: 3, scored: 3, skipped: 0, errors: 0, total: 3 },
      answer_relevancy: { mean: 1, passed: 3, scored: 3, skipped: 0, errors: 0, total: 3 },
      contextual_precision: { mean: 0.8333, passed: 2, scored: 3, skipped: 0, errors: 0, total: 3 },
      contextual_recall: { mean: 0.75, passed: 2, scored: 2, skipped: 1, errors: 0, total: 3 },
    },
    error: null,
    report_name: "docs/reports/eval/20261109-073415-qa-299dcefc.md",
    started_by: "bob",
    created_at: "2026-11-09T07:32:00Z",
    finished_at: "2026-11-09T07:34:15Z",
    ...overrides,
  };
}

/** The input Guard on one labelled set. */
export function guardSet(overrides: Partial<GuardSetMetrics> = {}): GuardSetMetrics {
  return {
    adversarial: 52,
    benign: 52,
    true_positives: 50,
    false_negatives: 2,
    false_positives: 0,
    true_negatives: 52,
    precision: 1,
    recall: 0.9615,
    f1: 0.9804,
    false_positive_rate: 0,
    recall_by_category: { jailbreak: 0.909, indirect_framing: 0 },
    missed: [{ id: "adv-019", category: "indirect_framing" }],
    blocked_benign: [],
    ...overrides,
  };
}

export function suiteEstimate(overrides: Partial<SuiteEstimateOut> & Pick<SuiteEstimateOut, "suite">): SuiteEstimateOut {
  return {
    cases: 3,
    chat_model: "openai/gpt-6-luna",
    judge_model: null,
    model_calls: 9,
    judge_calls: 0,
    input_tokens: 23_100,
    output_tokens: 1650,
    cost_usd: 0,
    notes: [],
    ...overrides,
  };
}

export function adminSettings(overrides: Partial<AdminSettingsOut> = {}): AdminSettingsOut {
  return {
    persona: "You are Rampart, an assistant that helps teams review the security of their LLM applications.",
    persona_is_default: true,
    conversation_token_budget: 200_000,
    input_guard: true,
    input_classifier: false,
    ...overrides,
  };
}
