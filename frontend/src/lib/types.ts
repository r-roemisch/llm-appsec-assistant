// Shapes from docs/API.md (milestone M6). Keep in sync with the backend contract.

export type Role = "user" | "admin";

export interface UserOut {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

export interface SessionOut {
  user: UserOut;
  csrf_token: string;
}

export type Provider = "openrouter" | "ollama";
export type Kind = "chat" | "embedding";
export type Tier = "cheap" | "powerful";
export type Slot = "chat" | "grader" | "judge" | "embedding";

export const SLOTS: readonly Slot[] = ["chat", "grader", "judge", "embedding"];

export interface ModelOut {
  id: string;
  provider: Provider;
  display_name: string;
  kind: Kind;
  tier: Tier;
  enabled: boolean;
  available: boolean;
  context_length: number | null;
  notes: string | null;
}

export interface SlotOut {
  model_id: string;
  source: "default" | "override";
  temperature: number | null;
  max_tokens: number | null;
}

export interface ModelsOut {
  models: ModelOut[];
  slots: Record<Slot, SlotOut>;
}

export interface SlotPatch {
  model_id?: string;
  temperature?: number | null;
  max_tokens?: number | null;
}

export interface ConversationOut {
  id: string;
  title: string;
  model_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  total_cost_usd: number;
  /** Answers come only from Rampart's own guides (M2). */
  help_mode: boolean;
}

/** Body of POST /api/conversations; every field is optional. */
export interface ConversationCreate {
  model_id?: string;
  title?: string;
  help_mode?: boolean;
}

/** Body of PATCH /api/conversations/{id}; any subset. */
export interface ConversationPatch {
  title?: string;
  model_id?: string;
  help_mode?: boolean;
}

/** "awaiting_approval" (M3): the turn stopped at a Tool call that needs an Approval. */
export type MessageStatus = "complete" | "streaming" | "error" | "awaiting_approval";

export interface MessageOut {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  model_id: string | null;
  provider: Provider | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  latency_ms: number | null;
  trace_id: string | null;
  status: MessageStatus;
  error: string | null;
  /** [] for user messages and for answers that cite nothing (M2). */
  citations: CitationOut[];
  /** null when the turn did not search the Knowledge Base (M2). */
  retrieval_mode: RetrievalMode | null;
  /** The Tool calls of the turn, in order (M3). */
  tool_calls: ToolCallOut[];
  /** What the Guards did during the turn (M3). */
  guard_events: GuardEventOut[];
  /** Set while status is "awaiting_approval": the Approval the turn waits for; it can already be decided (M3). */
  pending_approval: ApprovalOut | null;
  /** (M6) The requesting user's own Feedback on this answer; null for user messages and unrated answers. */
  feedback: FeedbackOut | null;
}

export interface ConversationDetailOut {
  conversation: ConversationOut;
  messages: MessageOut[];
}

export interface UsageByModel {
  model_id: string;
  messages: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageByUser {
  user_id: number;
  username: string;
  messages: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface UsageOut {
  messages: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  by_model: UsageByModel[];
}

export interface AdminUsageOut extends UsageOut {
  by_user: UsageByUser[];
}

export interface HealthOut {
  status: "ok";
  version: string;
  providers: { openrouter: boolean; ollama: boolean };
  tracing: "langfuse" | "jsonl";
}

// Knowledge Base, Citations, Project Profile, help (M2).

export type SourceType = "curated" | "upload" | "app_docs";
/** Passage provenance; uploads are "upload". */
export type Provenance = "source" | "upload";
/** bm25: keyword search only (no embedding Model). */
export type RetrievalMode = "hybrid" | "bm25";

export interface CitationOut {
  /** The marker used in the answer text: [n]. */
  n: number;
  passage_id: string;
  source_id: string;
  source_title: string;
  source_type: SourceType;
  /** URL for fetched Sources, repository path for local ones, file name for uploads. */
  origin: string;
  /** Section path or "Page 12". */
  heading: string | null;
  /** Start of the passage text, at most 300 characters. */
  snippet: string;
  provenance: Provenance;
}

export interface SourceOut {
  id: string;
  source_type: SourceType;
  title: string;
  origin: string;
  license_note: string | null;
  /** True for the caller's own uploads; shared Sources are false. */
  mine: boolean;
  /** Synthetic fixture Sources (offline tests and the demo). */
  synthetic: boolean;
  fetched_at: string;
  passage_count: number;
  /** Passages that have a vector for the current embedding Model. */
  embedded_count: number;
  /** Uploads only. */
  size_bytes: number | null;
}

export interface KnowledgeStatusOut {
  /** What the next search will use. */
  retrieval_mode: RetrievalMode;
  /** Why it is BM25-only, when it is. */
  reason: string | null;
  embedding_model_id: string;
  embedding_available: boolean;
  /** Visible to the caller: shared Sources plus own uploads. */
  sources: number;
  passages: number;
  embedded_passages: number;
  /** The caller's own uploads. */
  uploads: number;
  max_uploads: number;
  max_upload_bytes: number;
  /** For example [".pdf", ".md", ".markdown", ".txt"]. */
  upload_types: string[];
}

export interface PassageOut {
  id: string;
  source_id: string;
  source_title: string;
  source_type: SourceType;
  origin: string;
  license_note: string | null;
  /** Position of the passage in its Source, from 0. */
  ordinal: number;
  heading: string | null;
  text: string;
  provenance: Provenance;
}

export interface PackageRef {
  /** One of ProfileOut.ecosystems (OSV.dev names: "PyPI", "npm", ...). */
  ecosystem: string;
  /** 1 to 214 characters. */
  name: string;
  /** Up to 64 characters; null when unknown. */
  version: string | null;
}

export interface ProfileOut {
  /** False until the user saves a profile (then the other fields are empty). */
  exists: boolean;
  /** Free text, up to 2000 characters. */
  stack: string;
  /** Up to 1000 (50 before M7). */
  packages: PackageRef[];
  /** Registered Targets, filled from M4; always [] in M2. */
  target_ids: string[];
  updated_at: string | null;
  /** Allowed PackageRef.ecosystem values. */
  ecosystems: string[];
}

/** (M7) The Dependency File formats the server reads. */
export type DependencyFormat =
  | "requirements.txt"
  | "uv.lock"
  | "poetry.lock"
  | "package-lock.json"
  | "pyproject.toml"
  | "package.json";

/** (M7) A Dependency File to read; parsed in memory and never stored. */
export interface DependencyFileIn {
  content: string;
  filename?: string | null;
  /** Detected from the filename or the content when absent. */
  format?: DependencyFormat | null;
}

export interface DependencyImportIn extends DependencyFileIn {
  /** True: the imported packages replace every package in the profile. */
  replace: boolean;
}

export interface ParsedPackageOut extends PackageRef {
  /** False when the file gives no single exact version (the package cannot be checked). */
  pinned: boolean;
}

export interface DependencyFileOut {
  format: DependencyFormat;
  packages: ParsedPackageOut[];
  pinned: number;
  unpinned: number;
  /** Lines or entries the parser did not read, each with the reason (at most 50). */
  skipped: string[];
}

export interface ProfileIn {
  stack: string;
  packages: PackageRef[];
  /** The caller's own Target ids (M4); the PUT replaces the whole set. */
  target_ids: string[];
}

export interface HelpDocOut {
  /** "user_guide", "admin_guide". */
  slug: string;
  title: string;
  audience: "everyone" | "admin";
  /** Rendered as Markdown without raw HTML, like answers. */
  markdown: string;
}

// Tools, Gateway, Approvals, Guards, Reports, admin controls (M3).

/** The Gateway's decision on one Tool call. */
export type ToolDecision = "allow" | "deny" | "approval_required";
export type ToolCallStatus = "pending" | "ok" | "error" | "denied" | "rejected";

export interface ToolCallOut {
  /** The Model's Tool call id. */
  id: string;
  /**
   * "search_knowledge", "analyze_prompt", "lookup_vulnerabilities", "generate_report", "run_injection_test",
   * or (M5) a Plugin Tool "<plugin_id>__<tool>" (built-in names never contain "__").
   */
  tool: string;
  /** Secrets redacted, long strings shortened. */
  arguments: Record<string, unknown>;
  /** The Gateway's latest decision. */
  decision: ToolDecision | null;
  /** "allowed", "approved", "approval_pending", "tool_disabled", "rate_limited", (M5) "plugin_drift", ... */
  reason_code: string | null;
  /** The Gateway's explanation, for people. */
  message: string | null;
  status: ToolCallStatus | null;
  /** One line about the result ("8 known vulnerabilities in ..."). */
  summary: string | null;
  /** Of the result: "source", "user", "API", "system", "target", (M5) "plugin". */
  provenance: string | null;
  /** generate_report: the stored Report. */
  report_id: string | null;
  approval_id: string | null;
  /** (M5) "builtin" or "plugin:<plugin_id>"; null for unknown Tools (and missing on calls stored before M5). */
  contributed_by: string | null;
}

export type GuardName = "input" | "provenance" | "output";
export type GuardAction = "blocked" | "flagged" | "redacted";

export interface GuardEventOut {
  guard: GuardName;
  action: GuardAction;
  /** "secret_in_input", "instruction_override", "ai_directed_instruction", "secret_in_answer", ...; a block can list several, comma-separated. */
  category: string;
  detail: string;
}

export type Approver = "requester" | "admin";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "consumed";
export type ApprovalDecision = "approve" | "reject";

export interface ApprovalOut {
  id: string;
  conversation_id: string;
  message_id: string | null;
  tool: string;
  /** Exactly what will run (secrets redacted). */
  arguments: Record<string, unknown>;
  /** Who must approve. */
  approver: Approver;
  status: ApprovalStatus;
  /** Username. */
  requested_by: string;
  created_at: string;
  expires_at: string;
  /** Username. */
  decided_by: string | null;
  decided_at: string | null;
}

export type CostClass = "free" | "api" | "model" | "heavy";

/** (M5) Why a Plugin Tool cannot be used now; also the Gateway's reason code when it denies one. */
export type PluginBlock = "plugin_disabled" | "plugin_drift" | "plugin_missing";

export interface ToolOut {
  name: string;
  description: string;
  /** "builtin" or (M5) "plugin:<plugin_id>". */
  contributed_by: string;
  enabled: boolean;
  requires_approval: boolean;
  approver: Approver;
  rate_limit_per_hour: number | null;
  cost_class: CostClass;
  allowed_roles: string[];
  json_schema: Record<string, unknown>;
  /** (M5) Plugin Tools only: why it cannot be used now, whatever `enabled` says. */
  blocked: PluginBlock | null;
}

/** Body of PUT /api/admin/tools/{name}; any subset. `rate_limit_per_hour: null` restores the default. */
export interface ToolPolicyPatch {
  enabled?: boolean;
  approver?: Approver;
  rate_limit_per_hour?: number | null;
}

export interface ReportOut {
  id: string;
  conversation_id: string | null;
  title: string;
  created_at: string;
  /** Bytes. */
  size: number;
}

export interface ReportDetailOut extends ReportOut {
  /** Rendered like answers. */
  markdown: string;
}

export interface AdminSettingsOut {
  /** The persona at the start of every system prompt. */
  persona: string;
  persona_is_default: boolean;
  /** Tokens one Conversation may use in total. */
  conversation_token_budget: number;
  /** G1 heuristics (secret redaction always runs). */
  input_guard: boolean;
  /** G1 also asks the grader Slot (one extra call per turn). */
  input_classifier: boolean;
}

/** Body of PUT /api/admin/settings; any subset. `persona: null` restores the default. */
export interface AdminSettingsPatch {
  persona?: string | null;
  conversation_token_budget?: number;
  input_guard?: boolean;
  input_classifier?: boolean;
}

/** One Gateway decision (audit). */
export interface ToolCallRecordOut {
  id: string;
  created_at: string;
  username: string | null;
  conversation_id: string | null;
  tool: string;
  tool_call_id: string;
  decision: ToolDecision;
  reason_code: string;
  message: string;
  args_digest: string;
  arguments: Record<string, unknown>;
  duration_ms: number | null;
  error_class: string | null;
}

export interface GuardEventRecordOut {
  id: number;
  created_at: string;
  username: string | null;
  conversation_id: string | null;
  guard: string;
  action: string;
  category: string;
  detail: string;
}

// Targets and the injection test (M4).

/** Where a test candidate is placed in the Target. */
export type InputSurface = "user_message" | "document_slot";
/** What the owner recorded the Target is running; also an injection run's verdict. */
export type TargetProfile = "secure" | "vulnerable";

export interface TargetOut {
  id: string;
  name: string;
  /** A loopback address: 127.0.0.0/8, ::1 or localhost. */
  base_url: string;
  input_surface: InputSurface;
  /** What the owner recorded the Target is running (optional). */
  profile: TargetProfile | null;
  registered_at: string;
}

/** Body of POST /api/targets. */
export interface TargetCreateIn {
  name: string;
  base_url: string;
  input_surface?: InputSurface;
  profile?: TargetProfile | null;
}

/** Body of PATCH /api/targets/{id}; any subset. `profile: null` clears it. */
export interface TargetUpdateIn {
  name?: string;
  profile?: TargetProfile | null;
}

/**
 * The result of one `run_injection_test` call (suite `seed-v1`). The contract
 * carries this in the audit record and the Report, not in the `tool_result`
 * event or (reliably) in `MessageOut.tool_calls`, so the client never reads the
 * per-case data; the shape is kept here to document the contract.
 */
export interface InjectionCaseOut {
  id: string;
  label: "injection" | "benign";
  proposed: boolean;
  executed: boolean;
  received: boolean;
  contaminated: boolean;
  evidence: Record<string, unknown>;
}

export interface InjectionRunTotals {
  cases: number;
  injection: number;
  benign: number;
  proposed: number;
  executed: number;
  received: number;
  contaminated: number;
  benign_actions: number;
  breaches: number;
  /** Breaches whose audit log shows no execute_export step; the sink decides a breach. */
  unlogged: number;
  verdict: TargetProfile;
  /** (M7) Whether Rampart checked the sink for its own random Sentinel or the Target graded itself. */
  sentinel_check: "run_sentinel" | "target_reported";
}

export interface InjectionRunResult {
  suite_id: string;
  /** What the Target reported at /health. */
  target_profile: TargetProfile | null;
  totals: InjectionRunTotals;
  cases: InjectionCaseOut[];
}

// Plugins (M5): MCP servers listed in plugins/catalog.yaml on the server. No
// endpoint adds a Plugin or sets a command; admins enable, refresh and accept.

export type PluginStatus =
  /** In the catalog, never listed. */
  | "new"
  /** Listed, never accepted: none of its Tools is offered. */
  | "pending_review"
  /** The last listing matches the accepted definitions. */
  | "ok"
  /** The last listing differs from the accepted definitions: use is blocked. */
  | "drifted"
  /** The last listing failed (definitions accepted earlier stay as they were). */
  | "error"
  /** Stored, but no longer in plugins/catalog.yaml: use is blocked. */
  | "missing"
  /** The catalog entry itself is invalid (see catalog_error). */
  | "invalid";

/** One Tool definition as the server listed it. Every text field is untrusted: render it as plain text. */
export interface PluginToolOut {
  /** The server's name for it. */
  name: string;
  /** "<plugin_id>__<name>", what the Model and the Gateway use; null when it cannot be offered (bad name or schema). */
  exposed_name: string | null;
  title: string | null;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
  /** For the admin's review: instruction-like text, a name that matches a built-in, an open schema, an unusable definition. */
  warnings: string[];
}

export interface PluginOut {
  /** The key in plugins/catalog.yaml. */
  id: string;
  title: string;
  description: string;
  in_catalog: boolean;
  /** Why the catalog entry is invalid. */
  catalog_error: string | null;
  /** Read-only, from the catalog file, secrets redacted. */
  command: string | null;
  enabled: boolean;
  status: PluginStatus;
  /** sha256 of the accepted definitions. */
  accepted_tools_digest: string | null;
  /** sha256 of the last listing. */
  current_tools_digest: string | null;
  /** Tools in the last listing. */
  tool_count: number;
  /** Last successful listing. */
  last_seen: string | null;
  last_error: string | null;
  accepted_at: string | null;
  /** Username. */
  accepted_by: string | null;
}

/** A field of a Tool definition; any difference in one of them is drift. */
export type PluginDefinitionField = "name" | "title" | "description" | "input_schema" | "output_schema" | "annotations";

export interface PluginToolChange {
  name: string;
  fields: PluginDefinitionField[];
}

/** Accepted versus current, by the server's Tool names. */
export interface PluginChanges {
  added: string[];
  removed: string[];
  changed: PluginToolChange[];
}

export interface PluginDetailOut extends PluginOut {
  /** The last listing. */
  current_tools: PluginToolOut[];
  /** What an admin accepted (what the Model is offered). */
  accepted_tools: PluginToolOut[];
  changes: PluginChanges;
}

export interface PluginCatalogOut {
  /** The catalog file itself could not be read. */
  catalog_error: string | null;
  /** Catalog entries in file order, then stored Plugins no longer in it. */
  plugins: PluginOut[];
}

/** Body of PUT /api/admin/plugins/{id}; nothing else is accepted. */
export interface PluginUpdateIn {
  enabled: boolean;
}

/** Body of POST /api/admin/plugins/{id}/accept: the current_tools_digest the admin reviewed. */
export interface PluginAcceptIn {
  digest: string;
}

// Feedback, Evaluation Cases and evaluation (M6). Feedback is capture only: it
// is stored with the answer's trace id, sent to the trace as a score and shown
// to admins; nothing reads it to change how Rampart answers.

/** Thumbs up (1) or down (-1). */
export type FeedbackValue = 1 | -1;

/**
 * Body of PUT /api/messages/{message_id}/feedback. The PUT replaces the
 * caller's Feedback, so leaving the comment out clears it.
 */
export interface FeedbackIn {
  value: FeedbackValue;
  /** At most 1000 characters. */
  comment?: string | null;
}

/** The requesting user's own Feedback on one answer. */
export interface FeedbackOut {
  value: FeedbackValue;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

/** Where a Feedback's score went. */
export type FeedbackForward = "langfuse" | "jsonl";

/** One row of the admin Feedback dashboard. */
export interface FeedbackRecordOut {
  id: string;
  created_at: string;
  updated_at: string;
  username: string | null;
  value: FeedbackValue;
  /** Secrets redacted. */
  comment: string | null;
  conversation_id: string;
  message_id: string;
  /** The user message the answer replied to. */
  question: string | null;
  /** Rendered like answers (Markdown, no raw HTML). */
  answer: string;
  model_id: string | null;
  tools_used: string[];
  trace_id: string | null;
  /** Where the score went; null when it was not forwarded. */
  forwarded_to: FeedbackForward | null;
  forwarded_at: string | null;
  /** Set once an admin turned the answer into an Evaluation Case. */
  evaluation_case_id: string | null;
}

export interface FeedbackDashboardOut {
  /** Totals over all Feedback, whatever the filter. */
  up: number;
  down: number;
  converted: number;
  /** Newest first. */
  items: FeedbackRecordOut[];
}

export type EvaluationCaseKind = "qa" | "tool";

/** Body of POST /api/admin/feedback/{feedback_id}/evaluation-case: the admin writes the case, prefilled from the answer. */
export interface EvaluationCaseIn {
  kind: EvaluationCaseKind;
  /** 1 to 4000 characters. */
  question: string;
  /** Required for "qa". */
  expected_answer?: string | null;
  /** Required for "tool": names from GET /api/admin/tools. */
  expected_tools?: string[] | null;
}

export interface EvaluationCaseOut {
  id: string;
  kind: EvaluationCaseKind;
  question: string;
  expected_answer: string | null;
  expected_tools: string[] | null;
  /** "feedback:<feedback id>". */
  source: string;
  /** Username. */
  created_by: string | null;
  created_at: string;
}

/** What an estimate or a run covers; "all" is every suite. */
export type EvalSuite = "qa" | "tool" | "guard" | "all";
/** One evaluation suite. */
export type EvalSuiteName = Exclude<EvalSuite, "all">;

/** Body of POST /api/admin/eval/estimate. */
export interface EvalEstimateIn {
  suite: EvalSuite;
  /** The first N qa and tool cases; guard always runs every case. */
  limit?: number | null;
}

export interface SuiteEstimateOut {
  suite: EvalSuiteName;
  cases: number;
  chat_model: string | null;
  /** The judge Slot's Model, qa only. */
  judge_model: string | null;
  /** Rampart's own calls (routing, grading, answering). */
  model_calls: number;
  judge_calls: number;
  input_tokens: number;
  output_tokens: number;
  /** null when a Model's price is not listed. */
  cost_usd: number | null;
  notes: string[];
}

export interface EvalEstimateOut {
  estimates: SuiteEstimateOut[];
  /** null when any suite's cost is unknown. */
  total_usd: number | null;
}

/**
 * Body of POST /api/admin/eval/runs. `confirm_cost_usd` is the total the admin
 * was shown; the server refuses (409) when the estimate changed since.
 */
export interface EvalRunIn {
  suite: EvalSuite;
  limit?: number | null;
  confirm_cost_usd: number | null;
}

/** One metric of a qa or tool run. */
export interface DeepEvalMetricSummary {
  /** Over the scored cases. */
  mean: number | null;
  /** At or above the threshold (0.7 for qa, 1.0 for tool). */
  passed: number;
  scored: number;
  /** Not applicable (for example nothing retrieved, or the turn failed). */
  skipped: number;
  /** The judge failed for that case. */
  errors: number;
  total: number;
}

/** The input Guard on one labelled set. */
export interface GuardSetMetrics {
  adversarial: number;
  benign: number;
  true_positives: number;
  false_negatives: number;
  false_positives: number;
  true_negatives: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  false_positive_rate: number | null;
  recall_by_category: Record<string, number | null>;
  missed: { id: string; category: string }[];
  blocked_benign: { id: string; category: string }[];
}

/** A guard run's metrics: the set written with the rules and the held-out set. */
export interface GuardRunMetrics {
  cases: GuardSetMetrics;
  holdout: GuardSetMetrics;
}

export type EvalRunKind = "deepeval_qa" | "deepeval_tool" | "guard" | "guard_classifier";
export type EvalRunStatus = "queued" | "running" | "done" | "failed";

export interface EvalRunOut {
  id: string;
  kind: EvalRunKind;
  suite: EvalSuiteName;
  status: EvalRunStatus;
  judge_model: string | null;
  estimated_cost_usd: number | null;
  /** What the Providers reported; set when done. */
  cost_usd: number | null;
  case_count: number | null;
  case_limit: number | null;
  /**
   * qa: faithfulness, answer_relevancy, contextual_precision, contextual_recall;
   * tool: tool_correctness and (M7) argument_correctness, decision_correctness,
   * unnecessary_calls; guard: both labelled sets.
   */
  metrics: Record<string, DeepEvalMetricSummary> | GuardRunMetrics | null;
  error: string | null;
  /** For example "docs/reports/eval/20261109-073415-qa-299dcefc.md". */
  report_name: string | null;
  /** Username; null for runs started from the CLI. */
  started_by: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface EvalRunDetailOut extends EvalRunOut {
  /** Rendered like answers. */
  report_markdown: string | null;
}

export interface EvalDatasetsOut {
  qa: { authored: number; added: number };
  tool: { authored: number; added: number };
  guard: { cases: number; holdout: number };
}

// Server-sent events of POST /api/conversations/{id}/messages and of the
// Approval endpoints, which continue the same assistant message (M3).

export interface TurnStartData {
  user_message: MessageOut;
  assistant_message_id: string;
  model_id: string;
}

export interface TurnDeltaData {
  text: string;
}

export interface TurnUsageData {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface TurnDoneData {
  assistant_message: MessageOut;
}

export interface TurnErrorData {
  message: string;
  assistant_message: MessageOut | null;
}

/** A Knowledge Base search started (M2). `round` is 1, then 2 or 3 after a query rewrite. */
export interface TurnRetrievalSearchData {
  phase: "search";
  round: number;
  query: string;
}

/** The grader judged the passages of one search round (M2). */
export interface TurnRetrievalGradedData {
  phase: "graded";
  round: number;
  query: string;
  mode: RetrievalMode;
  found: number;
  relevant: number;
  /** (M6) The passages judged relevant; the client does not use them. */
  context_ids?: string[];
}

export type TurnRetrievalData = TurnRetrievalSearchData | TurnRetrievalGradedData;

/** Sent only when the answer cites at least one passage (M2). */
export interface TurnCitationsData {
  citations: CitationOut[];
}

/** A Guard acted (M3); the same shape as GuardEventOut. */
export type TurnGuardData = GuardEventOut;

/** The Gateway decided on a Tool call (M3). A call that needs an Approval comes with decision "approval_required". */
export interface TurnToolCallData {
  id: string;
  tool: string;
  arguments: Record<string, unknown>;
  decision: ToolDecision;
  reason_code: string;
  message: string;
  approval_id: string | null;
  /** (M5) "builtin" or "plugin:<plugin_id>"; null for unknown Tools. */
  contributed_by: string | null;
}

/** A Tool call ended (M3): it ran ("ok" or "error"), the Gateway refused it, or the approver rejected it. */
export interface TurnToolResultData {
  id: string;
  tool: string;
  status: "ok" | "error" | "denied" | "rejected";
  summary: string | null;
  provenance: string | null;
  report_id: string | null;
}

export type NoticeKind = "budget" | "model_calls";

/** Rampart stopped the turn early (M3): the Conversation's token budget, or the model calls of one turn. */
export interface TurnNoticeData {
  /** Later milestones may add kinds. */
  kind: NoticeKind | (string & {});
  message: string;
}

/** A final event (M3), like `done`: the turn waits for an Approval. */
export interface TurnApprovalRequiredData {
  approval: ApprovalOut;
  /** Stored with status "awaiting_approval" and `pending_approval`. */
  assistant_message: MessageOut;
}

/** The first event of a resumed stream (M3), after an Approval decision. */
export interface TurnResumeData {
  assistant_message_id: string;
  approval: ApprovalOut;
}

export type TurnEvent =
  | { event: "start"; data: TurnStartData }
  | { event: "resume"; data: TurnResumeData }
  | { event: "retrieval"; data: TurnRetrievalData }
  | { event: "guard"; data: TurnGuardData }
  | { event: "tool_call"; data: TurnToolCallData }
  | { event: "tool_result"; data: TurnToolResultData }
  | { event: "delta"; data: TurnDeltaData }
  | { event: "notice"; data: TurnNoticeData }
  | { event: "citations"; data: TurnCitationsData }
  | { event: "usage"; data: TurnUsageData }
  | { event: "done"; data: TurnDoneData }
  | { event: "error"; data: TurnErrorData }
  | { event: "approval_required"; data: TurnApprovalRequiredData };
