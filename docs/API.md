# Rampart HTTP API

Version: milestone M6 (2026-11-09); additions are marked **(M2)** to **(M6)**. Every path is prefixed with `/api`. The backend is FastAPI; the frontend is a React single-page app that only uses this contract. Later milestones add endpoints and server-sent events; they never change the shapes below without a note in this file.

## Conventions

- JSON request and response bodies. Timestamps are ISO 8601 strings in UTC (`2026-11-06T10:15:30Z`). Money is a JSON number in US dollars (`0.000123`).
- Errors use FastAPI's shape `{"detail": "..."}` (or a list for validation errors, status 422).
- Status codes: `401` no valid session; `403` wrong role or missing/invalid CSRF token; `404` not found, which is also returned for another user's Conversation so that existence is not leaked; `409` conflict (for example a Conversation that is already streaming); `422` validation.
- Authentication is a session cookie named `rampart_session`: `HttpOnly`, `SameSite=Lax`, `Secure` when the request is HTTPS, `Path=/`. The frontend never reads it.
- CSRF: every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) except `POST /api/auth/login` must send the header `X-CSRF-Token` with the token returned by `/api/auth/login` or `/api/auth/me`. A missing or wrong token gives `403`.
- Roles are `user` and `admin`. Admin routes live under `/api/admin/`; a `user` calling them gets `403`. Role checks are enforced in the backend services, not only by routing.
- Model identifiers contain slashes (`anthropic/claude-haiku-5.5`); as path parameters they are URL-encoded or matched with a path converter.

## Shapes

```ts
type Role = "user" | "admin";

interface UserOut {
  id: number;
  username: string;
  role: Role;
  created_at: string;
}

interface SessionOut {
  user: UserOut;
  csrf_token: string;
}

type Provider = "openrouter" | "ollama";
type Kind = "chat" | "embedding";
type Tier = "cheap" | "powerful";
type Slot = "chat" | "grader" | "judge" | "embedding";

interface ModelOut {
  id: string;             // "anthropic/claude-haiku-5.5", "ollama/qwen3:8b"
  provider: Provider;
  display_name: string;
  kind: Kind;
  tier: Tier;
  enabled: boolean;       // admin switch; catalog default true
  available: boolean;     // openrouter: API key configured; ollama: server reachable and model pulled
  context_length: number | null;
  notes: string | null;
}

interface SlotOut {
  model_id: string;
  source: "default" | "override";   // default from models.yaml, override set by an admin
  temperature: number | null;       // null means "do not send"; some hosted Models reject it
  max_tokens: number | null;        // generation cap for this Slot; null for the embedding Slot
}

interface ModelsOut {
  models: ModelOut[];
  slots: Record<Slot, SlotOut>;
}

interface ConversationOut {
  id: string;             // UUID
  title: string;
  model_id: string;       // chat Model used for the next turn
  created_at: string;
  updated_at: string;
  message_count: number;
  total_cost_usd: number;
  help_mode: boolean;     // (M2) answers come only from Rampart's own guides
}

type MessageStatus = "complete" | "streaming" | "error" | "awaiting_approval";   // (M3) awaiting_approval

interface MessageOut {
  id: string;             // UUID
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  model_id: string | null;        // assistant messages only
  provider: Provider | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;        // null when unknown (for example provider reported nothing); 0 for Ollama
  latency_ms: number | null;
  trace_id: string | null;
  status: MessageStatus;
  error: string | null;
  citations: CitationOut[];               // (M2) [] for user messages and for answers that cite nothing
  retrieval_mode: RetrievalMode | null;   // (M2) null when the turn did not search the Knowledge Base
  tool_calls: ToolCallOut[];              // (M3) the Tool calls of the turn, in order
  guard_events: GuardEventOut[];          // (M3) what the Guards did during the turn
  pending_approval: ApprovalOut | null;   // (M3) set while status is "awaiting_approval": the Approval
                                          //      the turn waits for (it can already be decided)
  feedback: FeedbackOut | null;           // (M6) the requesting user's own Feedback on this answer
}

interface ConversationDetailOut {
  conversation: ConversationOut;
  messages: MessageOut[];         // chronological
}

// (M2) by_model is read from every Model call of a turn (routing, grading, query rewriting, query
// embedding, the answer), so the grader and embedding Models get their own rows. `messages` counts
// the assistant messages whose turn used that Model; a turn that used two Models counts in both rows.
interface UsageByModel { model_id: string; messages: number; input_tokens: number; output_tokens: number; cost_usd: number; }
interface UsageByUser  { user_id: number; username: string; messages: number; input_tokens: number; output_tokens: number; cost_usd: number; }

interface UsageOut {
  messages: number;               // assistant messages counted
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  by_model: UsageByModel[];
}

interface AdminUsageOut extends UsageOut {
  by_user: UsageByUser[];
}

interface HealthOut {
  status: "ok";
  version: string;
  providers: { openrouter: boolean; ollama: boolean };   // configured / reachable
  tracing: "langfuse" | "jsonl";
}

// ---- (M2) Knowledge Base, Citations, Project Profile, help ----

type SourceType = "curated" | "upload" | "app_docs";
type Provenance = "source" | "upload";      // Passage provenance; uploads are "upload"
type RetrievalMode = "hybrid" | "bm25";     // bm25: keyword search only (no embedding Model)

interface CitationOut {
  n: number;              // the marker used in the answer text: [n]
  passage_id: string;
  source_id: string;
  source_title: string;
  source_type: SourceType;
  origin: string;         // URL for fetched Sources, repository path for local ones, file name for uploads
  heading: string | null; // section path ("LLM01:2025 Prompt Injection > Prevention ...") or "Page 12"
  snippet: string;        // start of the passage text, at most 300 characters
  provenance: Provenance;
}

interface SourceOut {
  id: string;
  source_type: SourceType;
  title: string;
  origin: string;
  license_note: string | null;
  mine: boolean;          // true for the caller's own uploads; shared Sources are false
  synthetic: boolean;     // synthetic fixture Sources (offline tests and the demo)
  fetched_at: string;     // when it was fetched, read from the repository, or uploaded
  passage_count: number;
  embedded_count: number; // passages that have a vector for the current embedding Model
  size_bytes: number | null;   // uploads only
}

interface KnowledgeStatusOut {
  retrieval_mode: RetrievalMode;   // what the next search will use
  reason: string | null;           // why it is BM25-only, or how many passages still lack vectors
  embedding_model_id: string;      // the embedding Slot's Model
  embedding_available: boolean;
  sources: number;                 // visible to the caller: shared Sources plus own uploads
  passages: number;
  embedded_passages: number;
  uploads: number;                 // the caller's own uploads
  max_uploads: number;
  max_upload_bytes: number;
  upload_types: string[];          // [".pdf", ".md", ".markdown", ".txt"]
}

interface PassageOut {
  id: string;
  source_id: string;
  source_title: string;
  source_type: SourceType;
  origin: string;
  license_note: string | null;
  ordinal: number;        // position of the passage in its Source, from 0
  heading: string | null;
  text: string;
  provenance: Provenance;
}

interface PackageRef {
  ecosystem: string;      // one of ProfileOut.ecosystems (OSV.dev names: "PyPI", "npm", ...)
  name: string;           // 1 to 214 characters
  version: string | null; // up to 64 characters; null when unknown
}

interface ProfileOut {
  exists: boolean;        // false until the user saves a profile (then the other fields are empty)
  stack: string;          // free text, up to 2000 characters
  packages: PackageRef[]; // up to 50
  target_ids: string[];   // registered Targets, filled from M4; always [] in M2
  updated_at: string | null;
  ecosystems: string[];   // allowed PackageRef.ecosystem values
}

interface ProfileIn {
  stack: string;
  packages: PackageRef[];
}

interface HelpDocOut {
  slug: string;           // "user_guide", "admin_guide"
  title: string;
  audience: "everyone" | "admin";
  markdown: string;       // render as Markdown without raw HTML, like answers
}

// ---- (M3) Tools, Gateway, Approvals, Guards, Reports, admin controls ----

interface ToolCallOut {
  id: string;                         // the Model's Tool call id
  tool: string;                       // "search_knowledge", "analyze_prompt", "lookup_vulnerabilities",
                                      // (M7) "check_dependencies",
                                      // "generate_report", "run_injection_test", or (M5) a Plugin
                                      // Tool "<plugin_id>__<tool>" (built-in names never contain "__")
  arguments: Record<string, unknown>; // secrets redacted, long strings shortened
  decision: "allow" | "deny" | "approval_required" | null;   // the Gateway's latest decision
  reason_code: string | null;         // "allowed", "approved", "approval_pending", "unknown_tool",
                                      // "tool_disabled", "role_forbidden", "invalid_arguments",
                                      // "turn_limit", "rate_limited", "conversation_budget",
                                      // "target_not_registered", "approval_rejected",
                                      // "approval_expired", "approval_mismatch", (M5)
                                      // "plugin_disabled", "plugin_drift", "plugin_missing", ...
  message: string | null;             // the Gateway's explanation, for people
  status: "pending" | "ok" | "error" | "denied" | "rejected" | null;
  summary: string | null;             // one line about the result ("8 known vulnerabilities in ...")
  provenance: string | null;          // of the result: "source", "user", "API", "system", "target",
                                      // (M5) "plugin"
  report_id: string | null;           // generate_report: the stored Report
  approval_id: string | null;
  contributed_by: string | null;      // (M5) "builtin" or "plugin:<plugin_id>"; null for unknown Tools
}

interface GuardEventOut {
  guard: "input" | "provenance" | "output";
  action: "blocked" | "flagged" | "redacted";
  category: string;                   // "secret_in_input", "instruction_override", "prompt_extraction",
                                      // "ai_directed_instruction", "secret_in_answer", "classifier", ...
  detail: string;
}

interface ApprovalOut {
  id: string;
  conversation_id: string;
  message_id: string | null;
  tool: string;
  arguments: Record<string, unknown>; // exactly what will run (secrets redacted)
  approver: "requester" | "admin";    // who must approve
  status: "pending" | "approved" | "rejected" | "expired" | "consumed";
  requested_by: string;               // username
  created_at: string;
  expires_at: string;
  decided_by: string | null;          // username
  decided_at: string | null;
}

interface ToolOut {
  name: string;
  description: string;
  contributed_by: string;             // "builtin" or (M5) "plugin:<plugin_id>"
  enabled: boolean;
  requires_approval: boolean;
  approver: "requester" | "admin";
  rate_limit_per_hour: number | null;
  cost_class: "free" | "api" | "model" | "heavy";
  allowed_roles: string[];
  json_schema: Record<string, unknown>;
  blocked: "plugin_disabled" | "plugin_drift" | "plugin_missing" | null;  // (M5) Plugin Tools only:
                                      // why it cannot be used now, whatever `enabled` says
}

interface ReportOut { id: string; conversation_id: string | null; title: string; created_at: string; size: number; }
interface ReportDetailOut extends ReportOut { markdown: string; }   // render like answers

interface AdminSettingsOut {
  persona: string;                    // the persona at the start of every system prompt
  persona_is_default: boolean;
  conversation_token_budget: number;  // tokens one Conversation may use in total
  input_guard: boolean;               // G1 heuristics (secret redaction always runs)
  input_classifier: boolean;          // G1 also asks the grader Slot (one extra call per turn)
}

interface ToolCallRecordOut {         // one Gateway decision (audit)
  id: string; created_at: string; username: string | null; conversation_id: string | null;
  tool: string; tool_call_id: string; decision: "allow" | "deny" | "approval_required";
  reason_code: string; message: string; args_digest: string; arguments: Record<string, unknown>;
  duration_ms: number | null; error_class: string | null;
}

interface GuardEventRecordOut {
  id: number; created_at: string; username: string | null; conversation_id: string | null;
  guard: string; action: string; category: string; detail: string;
}

// ---- (M4) Targets and the injection test ----

type InputSurface = "user_message" | "document_slot";
type TargetProfile = "secure" | "vulnerable";

interface TargetOut {
  id: string;
  name: string;
  base_url: string;              // a loopback address: 127.0.0.0/8, ::1 or localhost
  input_surface: InputSurface;   // where a test candidate is placed in the Target
  profile: TargetProfile | null; // what the owner recorded the Target is running (optional)
  registered_at: string;
}
interface TargetCreateIn { name: string; base_url: string; input_surface?: InputSurface; profile?: TargetProfile | null; }
interface TargetUpdateIn { name?: string; profile?: TargetProfile | null; }

// (M4) ProfileIn gains `target_ids: string[]` (the caller's own Target ids), and ProfileOut's
// `target_ids` is now filled. A run_injection_test tool_result carries this in the audit record
// and the Report (read with GET /api/admin/audit/tool-calls or inside a Report), not in the event:
interface InjectionRunResult {
  suite_id: string;
  target_profile: TargetProfile | null;   // what the Target reported at /health
  totals: {                                // read from the Target's audit log and sink
    cases: number; injection: number; benign: number;
    proposed: number; executed: number; received: number;
    contaminated: number; benign_actions: number; breaches: number;
    verdict: "secure" | "vulnerable";
    // (M7) "run_sentinel": Rampart found its own random Sentinel in the sink text;
    // "target_reported": the Target did not plant it and reported its own sink (weaker evidence)
    sentinel_check: "run_sentinel" | "target_reported";
  };
  cases: { id: string; label: "injection" | "benign"; proposed: boolean; executed: boolean;
           received: boolean; contaminated: boolean; evidence: Record<string, unknown> }[];
}
```

### (M5) Plugin shapes

```ts
type PluginStatus =
  | "new"             // in the catalog, never listed
  | "pending_review"  // listed, never accepted: none of its Tools is offered
  | "ok"              // the last listing matches the accepted definitions
  | "drifted"         // the last listing differs from the accepted definitions: use is blocked
  | "error"           // the last listing failed (definitions accepted earlier stay as they were)
  | "missing"         // stored, but no longer in plugins/catalog.yaml: use is blocked
  | "invalid";        // the catalog entry itself is invalid (see catalog_error)

interface PluginToolOut {             // one Tool definition as the server listed it
  name: string;                       // the server's name for it
  exposed_name: string | null;        // "<plugin_id>__<name>", what the Model and the Gateway use;
                                      // null when it cannot be offered (bad name or schema)
  title: string | null;
  description: string;                // untrusted text from the server: render as plain text
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
  warnings: string[];                 // for the admin's review: instruction-like text, a name that
                                      // matches a built-in, an open schema, an unusable definition
}

interface PluginOut {
  id: string;                         // the key in plugins/catalog.yaml
  title: string;
  description: string;
  in_catalog: boolean;
  catalog_error: string | null;       // why the catalog entry is invalid
  command: string | null;             // read-only, from the catalog file, secrets redacted
  enabled: boolean;
  status: PluginStatus;
  accepted_tools_digest: string | null;  // sha256 of the accepted definitions
  current_tools_digest: string | null;   // sha256 of the last listing
  tool_count: number;                 // Tools in the last listing
  last_seen: string | null;           // last successful listing
  last_error: string | null;
  accepted_at: string | null;
  accepted_by: string | null;         // username
}

interface PluginDetailOut extends PluginOut {
  current_tools: PluginToolOut[];     // the last listing
  accepted_tools: PluginToolOut[];    // what an admin accepted (what the Model is offered)
  changes: {                          // accepted versus current, by the server's Tool names
    added: string[];
    removed: string[];
    changed: { name: string; fields: ("name" | "title" | "description" | "input_schema" |
                                      "output_schema" | "annotations")[] }[];
  };
}

interface PluginCatalogOut { catalog_error: string | null; plugins: PluginOut[]; }
interface PluginUpdateIn { enabled: boolean; }   // nothing else is accepted
interface PluginAcceptIn { digest: string; }     // the current_tools_digest the admin reviewed
```

### (M6) Feedback, Evaluation Cases and evaluation shapes

```ts
interface FeedbackIn { value: 1 | -1; comment?: string | null; }   // comment at most 1000 characters
interface FeedbackOut { value: 1 | -1; comment: string | null; created_at: string; updated_at: string; }

interface FeedbackRecordOut {          // one row of the admin Feedback dashboard
  id: string;
  created_at: string;
  updated_at: string;
  username: string | null;
  value: 1 | -1;
  comment: string | null;              // secrets redacted
  conversation_id: string;
  message_id: string;
  question: string | null;             // the user message the answer replied to
  answer: string;                      // render like answers (Markdown, no raw HTML)
  model_id: string | null;
  tools_used: string[];
  trace_id: string | null;
  forwarded_to: "langfuse" | "jsonl" | null;   // where the score went; null when not forwarded
  forwarded_at: string | null;
  evaluation_case_id: string | null;   // set once converted
}
interface FeedbackDashboardOut { up: number; down: number; converted: number; items: FeedbackRecordOut[]; }

interface EvaluationCaseIn {           // the admin writes the case, prefilled from the answer
  kind: "qa" | "tool";
  question: string;                    // 1 to 4000 characters
  expected_answer?: string | null;     // required for "qa"
  expected_tools?: string[] | null;    // required for "tool": names from GET /api/admin/tools
}
interface EvaluationCaseOut {
  id: string; kind: "qa" | "tool"; question: string; expected_answer: string | null;
  expected_tools: string[] | null; source: string;   // "feedback:<feedback id>"
  created_by: string | null; created_at: string;
}

type EvalSuite = "qa" | "tool" | "guard" | "all";
interface EvalEstimateIn { suite: EvalSuite; limit?: number | null; }   // limit: first N qa/tool cases
interface SuiteEstimateOut {
  suite: "qa" | "tool" | "guard";
  cases: number;
  chat_model: string | null;
  judge_model: string | null;          // the judge Slot's Model, qa only
  model_calls: number;                 // Rampart's own calls (routing, grading, answering)
  judge_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;             // null when a Model's price is not listed
  notes: string[];
}
interface EvalEstimateOut { estimates: SuiteEstimateOut[]; total_usd: number | null; }
interface EvalRunIn { suite: EvalSuite; limit?: number | null; confirm_cost_usd: number | null; }  // the total shown

interface DeepEvalMetricSummary {      // per metric of a qa or tool run
  mean: number | null;                 // over scored cases
  passed: number;                      // at or above the threshold (0.7 for qa, 1.0 for tool)
  scored: number;
  skipped: number;                     // not applicable (e.g. nothing retrieved, the turn failed)
  errors: number;                      // the judge failed for that case
  total: number;
}
interface GuardSetMetrics {
  adversarial: number; benign: number;
  true_positives: number; false_negatives: number; false_positives: number; true_negatives: number;
  precision: number | null; recall: number | null; f1: number | null; false_positive_rate: number | null;
  recall_by_category: Record<string, number | null>;
  missed: { id: string; category: string }[];
  blocked_benign: { id: string; category: string }[];
}
interface EvalRunOut {
  id: string;
  kind: "deepeval_qa" | "deepeval_tool" | "guard" | "guard_classifier";  // (M7) the last from the CLI's --classifier
  suite: "qa" | "tool" | "guard";
  status: "queued" | "running" | "done" | "failed";
  judge_model: string | null;
  estimated_cost_usd: number | null;
  cost_usd: number | null;             // what the Providers reported; set when done
  case_count: number | null;
  case_limit: number | null;
  metrics: Record<string, DeepEvalMetricSummary>          // qa: faithfulness, answer_relevancy,
         | { cases: GuardSetMetrics; holdout: GuardSetMetrics }   // contextual_precision,
         | null;                                          // contextual_recall; tool: tool_correctness
  error: string | null;
  report_name: string | null;          // e.g. "docs/reports/eval/20261109-073415-qa-299dcefc.md"
  started_by: string | null;           // username; null for runs started from the CLI
  created_at: string;
  finished_at: string | null;
}
interface EvalRunDetailOut extends EvalRunOut { report_markdown: string | null; }  // render like answers
interface EvalDatasetsOut {
  qa: { authored: number; added: number };
  tool: { authored: number; added: number };
  guard: { cases: number; holdout: number };
}
```

## Endpoints

### Health

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/health` | none | `HealthOut` |

### Auth

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/auth/login` | none | `{username, password}` | `200 SessionOut`, sets cookie; `401` on bad credentials |
| POST | `/api/auth/logout` | session + CSRF | none | `204`, clears cookie |
| GET | `/api/auth/me` | session | none | `200 SessionOut`; `401` when not logged in |
| POST | `/api/auth/password` | session + CSRF | `{current_password, new_password}` | `204`; `400` when the current password is wrong; new password at least 8 characters |

There is no sign-up endpoint. Accounts are created by an admin (below) or by the `rampart init`, `rampart user create` and `rampart demo` commands.

### Admin: users

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/admin/users` | | `UserOut[]` |
| POST | `/api/admin/users` | `{username, password, role}` | `201 UserOut`; `409` when the username exists |
| POST | `/api/admin/users/{id}/password` | `{new_password}` | `204` |
| DELETE | `/api/admin/users/{id}` | | `204`; `400` when deleting yourself. Deletes the user's Conversations. |

Usernames: 3 to 64 characters, letters, digits, `.`, `_`, `-`. Passwords: 8 to 256 characters.

### Models

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/models` | session | | `ModelsOut` (all catalog entries; the picker shows `kind == "chat" && enabled`) |
| PUT | `/api/admin/models/slots/{slot}` | admin + CSRF | `{model_id?, temperature?, max_tokens?}` (any subset; `temperature: null` clears it) | `200 Record<Slot, SlotOut>`; `422` when the Model's kind does not fit the Slot, the Model is disabled, temperature is outside 0 to 2, or max_tokens is outside 1 to 128000 |
| DELETE | `/api/admin/models/slots/{slot}` | admin + CSRF | | `200 Record<Slot, SlotOut>` (back to the `models.yaml` default) |
| PUT | `/api/admin/models/{model_id:path}` | admin + CSRF | `{enabled}` | `200 ModelOut`; `422` when disabling the Model that a Slot currently uses |

### Conversations

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/conversations` | | `ConversationOut[]`, newest `updated_at` first |
| POST | `/api/conversations` | `{model_id?, title?, help_mode?}` | `201 ConversationOut`; default Model is the chat Slot; `422` when the Model is not an enabled chat Model; `help_mode` defaults to `false` |
| GET | `/api/conversations/{id}` | | `ConversationDetailOut` |
| PATCH | `/api/conversations/{id}` | `{title?, model_id?, help_mode?}` | `200 ConversationOut` |
| DELETE | `/api/conversations/{id}` | | `204` |
| POST | `/api/conversations/{id}/messages` | `{content}` | `200` stream `text/event-stream` (below); `409` when a turn is already streaming or (M3) waits for an Approval; `422` when content is empty or longer than 32 000 characters |

All Conversation routes require a session and act only on the caller's own Conversations (`404` otherwise). Titles default to the first 60 characters of the first user message.

### Streaming a turn

`POST /api/conversations/{id}/messages` answers with server-sent events. Each event has an `event:` name and a single-line JSON `data:` payload. Order: `start`, zero or more `delta`, optionally `usage`, then exactly one of `done` or `error`. The connection closes after the final event. If the client aborts the request, generation stops and the assistant message is stored with what was received so far and `status: "error"`, `error: "client disconnected"`.

```
event: start
data: {"user_message": MessageOut, "assistant_message_id": "…", "model_id": "anthropic/claude-haiku-5.5"}

event: delta
data: {"text": "Prompt injection is …"}

event: usage
data: {"input_tokens": 812, "output_tokens": 240, "cost_usd": 0.000201}

event: done
data: {"assistant_message": MessageOut}

event: error
data: {"message": "OpenRouter returned 429: rate limited", "assistant_message": MessageOut}
```

Later milestones add `tool_call`, `tool_result`, `approval_required` and `guard` events between `start` and `done`; a client must ignore event names it does not know.

**(M2) Retrieval and Citations.** Each turn first decides whether to search the Knowledge Base (a routing call on the grader Slot; skipped when the caller can see no passages, and always "search Rampart's guides" in help mode). A search runs hybrid retrieval (embeddings plus BM25, or BM25 alone), the grader Slot judges which passages are relevant, and when none are, the query is rewritten and searched again, at most twice. The answer cites passages as `[n]`. Order of a turn: `start`, zero or more `retrieval`, zero or more `delta`, optionally `citations`, optionally `usage`, then `done` or `error`. `usage` and the stored message carry the totals of every Model call in the turn.

```
event: retrieval
data: {"phase": "search", "round": 1, "query": "indirect prompt injection mitigations"}

event: retrieval
data: {"phase": "graded", "round": 1, "query": "indirect prompt injection mitigations", "mode": "hybrid", "found": 6, "relevant": 2,
       "context_ids": ["<passage id>", "<passage id>"]}

event: citations
data: {"citations": [CitationOut, ...]}
```

`round` is 1 for the first search and 2 or 3 after a query rewrite. A UI can show "Searching the Knowledge Base" after `phase: "search"` and "Rewriting the query" when a round above 1 starts. `citations` is sent only when the answer cites at least one passage; the same list is in `done.assistant_message.citations`.

### Usage

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/usage/me` | session | `UsageOut` for the caller |
| GET | `/api/admin/usage` | admin | `AdminUsageOut` for everyone |

**(M3) Tools, Approvals and Guards in the stream.** The chat Model can call Tools; every call passes the Gateway. New events, all between `start` and the final event:

```
event: guard
data: {"guard": "input", "action": "redacted", "category": "secret_in_input", "detail": "..."}

event: tool_call
data: {"id": "call_1", "tool": "lookup_vulnerabilities", "arguments": {...}, "decision": "allow",
       "reason_code": "allowed", "message": "allowed by policy", "approval_id": null,
       "contributed_by": "builtin"}

event: tool_result
data: {"id": "call_1", "tool": "lookup_vulnerabilities", "status": "ok",
       "summary": "8 known vulnerabilities in requests 2.25.0", "provenance": "API", "report_id": null}

event: notice
data: {"kind": "budget" | "model_calls", "message": "..."}

event: approval_required
data: {"approval": ApprovalOut, "assistant_message": MessageOut}
```

- A blocked input (G1) is answered with a fixed safe response as ordinary `delta` text, after a `guard` event with `action: "blocked"`; no Model is called.
- `tool_call` arrives when the Gateway decides; a call that needs an Approval sends `tool_call` with `decision: "approval_required"`, then the stream ends with `approval_required` (a final event, like `done`). The assistant message is stored with `status: "awaiting_approval"` and `pending_approval`.
- `tool_result.status`: `ok`, `error` (the Tool ran and reported a problem, for example OSV.dev unreachable), `denied` (the Gateway refused; `summary` says why) or `rejected` (the approver rejected it).
- Text deltas can come before Tool calls (a preamble) and after them; a blank line separates the segments.
- Answers are redacted while they stream (G4): what the browser receives is what is stored.
- Full order: `start`, then any of `guard`, `retrieval`, `tool_call`, `tool_result`, `delta`, `notice`, then optionally `citations` and `usage`, then exactly one of `done`, `error` or `approval_required`.

A resumed stream (after an Approval decision) starts with `resume` and continues like a turn, ending with `done`, `error` or another `approval_required`:

```
event: resume
data: {"assistant_message_id": "...", "approval": ApprovalOut}
```

### (M3) Approvals

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/api/conversations/{id}/approvals/{approval_id}` | session + CSRF | `{decision: "approve" \| "reject"}` | `200` stream: the turn continues (`resume`, ...). `403` when approving needs an admin (`approver: "admin"`) or the caller did not ask for the call; `409` when the Approval is not pending (decided, expired, consumed) or a turn is streaming; `404` unknown |
| POST | `/api/conversations/{id}/approvals/{approval_id}/continue` | session + CSRF | | `200` stream: continues after an admin decided or the Approval expired; `409` while still pending |

Rules: the Approval is bound to the exact arguments; it expires (15 minutes; 24 hours when an admin must approve); it is consumed by the one call it was made for. The requester can always reject (cancel). While a turn waits, `POST /messages` on that Conversation answers `409`; reject to move on.

### (M3) Tools and Reports

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/tools` | session | `ToolOut[]`: the Tools the caller's turns may use (enabled, allowed for the role) |
| GET | `/api/reports` | session | `ReportOut[]`, newest first, own Reports only |
| GET | `/api/reports/{id}` | session | `ReportDetailOut`; `404` for another user's Report |
| GET | `/api/reports/{id}/download` | session | `text/markdown` attachment |
| DELETE | `/api/reports/{id}` | session + CSRF | `204` |

### (M3) Admin controls

All under `/api/admin/` (admin role and CSRF; a user gets `403`).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/admin/tools` | | `ToolOut[]`, every Tool with its effective policy |
| PUT | `/api/admin/tools/{name}` | `{enabled?, approver?, rate_limit_per_hour?}` (`rate_limit_per_hour: null` restores the default) | `200 ToolOut`; `404` unknown Tool |
| GET | `/api/admin/approvals?status=&approver=` | | `ApprovalOut[]`, newest first |
| POST | `/api/admin/approvals/{id}` | `{decision}` | `200 ApprovalOut`; an admin approves calls whose `approver` is `admin` (approving a requester's own Approval gives `403`); `409` when not pending |
| GET | `/api/admin/audit/tool-calls?limit=&tool=&decision=` | | `ToolCallRecordOut[]`, newest first: every Gateway decision |
| GET | `/api/admin/audit/guard-events?limit=&guard=` | | `GuardEventRecordOut[]`, newest first |
| GET | `/api/admin/settings` | | `AdminSettingsOut` |
| PUT | `/api/admin/settings` | `{persona?, conversation_token_budget?, input_guard?, input_classifier?}` (`persona: null` restores the default; 50 to 8000 characters; budget 1000 to 10 000 000) | `200 AdminSettingsOut`; `422` out of range |

### (M5) Admin: Plugins

A Plugin is an MCP server listed in `plugins/catalog.yaml` on the server. No endpoint adds a
Plugin or sets a command, and the bodies below reject any other field (`422`). A Plugin's Tools
appear in `GET /api/admin/tools` only after an admin accepts its definitions, as
`contributed_by: "plugin:<id>"`, disabled (`PUT /api/admin/tools/{name}` enables them) and always
needing the requester's Approval (an admin may switch the approver to `admin`). A Plugin that is
disabled, missing or drifted blocks its Tools (`ToolOut.blocked`); the Gateway denies them with
that reason code. All under `/api/admin/` (admin role and CSRF; a user gets `403`).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/admin/plugins` | | `PluginCatalogOut`: catalog entries in file order, then stored Plugins no longer in it |
| GET | `/api/admin/plugins/{id}` | | `PluginDetailOut`; `404` neither in the catalog nor stored |
| POST | `/api/admin/plugins/{id}/refresh` | | `200 PluginDetailOut` after starting the server and listing its Tools (a failure is `status: "error"` with `last_error`, not an HTTP error); `404`; `422` invalid entry. Takes about a second |
| PUT | `/api/admin/plugins/{id}` | `PluginUpdateIn` | `200 PluginDetailOut`; enabling also lists the Tools (as refresh); `404`; `422` invalid entry or body |
| POST | `/api/admin/plugins/{id}/accept` | `PluginAcceptIn` | `200 PluginDetailOut` with `status: "ok"`; `409` when nothing was listed yet or the digest is not the current one (the definitions changed since the review: fetch the detail again); `404`; `422` |

A Plugin's Tool output reaches the Model as untrusted data with Provenance `plugin`, redacted and
scanned like other Tool output.

### (M2) Knowledge Base

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/knowledge/status` | session | | `KnowledgeStatusOut` |
| GET | `/api/knowledge/sources` | session | | `SourceOut[]`: the caller's uploads (newest first), then shared Sources (curated, then app_docs, by title) |
| POST | `/api/knowledge/uploads` | session + CSRF | `multipart/form-data`, one file field named `file` | `201 SourceOut`; `422` for a type other than PDF, Markdown or text (checked by extension and content), an empty file, a file over `max_upload_bytes`, an encrypted or unreadable PDF, a file with no extractable text, or when the caller already has `max_uploads` uploads; `409` when the caller already uploaded the same file |
| DELETE | `/api/knowledge/sources/{id}` | session + CSRF | | `204` for the caller's own upload; `403` for a shared Source (managed with `rampart ingest`); `404` for an unknown id or another user's upload |
| GET | `/api/knowledge/passages/{id}` | session | | `PassageOut`; `404` when the passage does not exist or belongs to another user's upload |

Uploads are private to the uploader: they are never retrieved, cited or listed for anyone else, admins included. Shared Sources come from `rampart ingest` (OWASP Top 10 for LLM Applications, MITRE ATLAS, NIST AI RMF, Rampart's primers and guides) or `rampart ingest --fixtures` (synthetic fixtures for offline use).

### (M4) Targets

A Target is a loopback application the caller may run the fixed injection test suite against.
Registration refuses any address that is not a loopback literal; the host is never resolved. The
Gateway checks ownership and the loopback address again when `run_injection_test` is requested.

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/targets` | session | | `TargetOut[]`, newest first, own Targets only |
| POST | `/api/targets` | session + CSRF | `TargetCreateIn` | `201 TargetOut`; `422` for a non-loopback URL, a bad input_surface or profile, or the per-user limit (20); `409` when the same URL is already registered |
| PATCH | `/api/targets/{id}` | session + CSRF | `TargetUpdateIn` | `200 TargetOut`; `404` for another user's Target |
| DELETE | `/api/targets/{id}` | session + CSRF | | `204`; `404` for another user's Target |

Running a suite is not a REST call: the model calls the `run_injection_test` Tool (suite
`seed-v1`), which needs an Approval (M3). The run drives the Target over HTTP and reads the
outcome from the Target's own audit log and sink, never from its replies. The demo Target is
started with `rampart demo-target --profile secure|vulnerable`.

### (M2) Project Profile

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/profile` | session | | `ProfileOut` (with `exists: false` before the first save) |
| PUT | `/api/profile` | session + CSRF | `ProfileIn` | `200 ProfileOut`; `422` when `stack` is over 2000 characters, there are more than 1000 packages (50 before M7), an ecosystem is not in the list, a name is empty or too long, a version is too long, or (M4) a `target_id` is not one of the caller's own Targets |
| DELETE | `/api/profile` | session + CSRF | | `204`, also when there was no profile |
| POST | `/api/profile/dependency-file/preview` | session + CSRF | `DependencyFileIn` | (M7) `200 DependencyFileOut`: what the file lists; nothing is saved. `422` when the file does not parse as its format |
| POST | `/api/profile/dependency-file/import` | session + CSRF | `DependencyImportIn` | (M7) `200 ProfileOut`. Packages with the same ecosystem and name take the imported versions, new ones are added, nothing is removed; with `replace: true` the file's packages become the whole list. `422` when the file lists no PyPI or npm package, does not parse, or the result would exceed 1000 packages (the count is named) |

```ts
// (M7) A Dependency File is parsed in memory, without a Model, and never stored.
type DependencyFormat = "requirements.txt" | "uv.lock" | "poetry.lock" | "package-lock.json"
                      | "pyproject.toml" | "package.json";
interface DependencyFileIn { content: string; filename?: string | null; format?: DependencyFormat | null } // content up to 5,000,000 characters; format detected when absent
interface DependencyImportIn extends DependencyFileIn { replace: boolean }
interface DependencyFileOut {
  format: DependencyFormat;
  packages: { ecosystem: "PyPI" | "npm"; name: string; version: string | null; pinned: boolean }[];
  pinned: number; unpinned: number;
  skipped: string[];                    // lines or entries not read, with the reason (at most 50)
}
```

The profile is read at the start of every turn and given to the model as user-provided context; after a delete it is no longer applied.

### (M6) Feedback

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| PUT | `/api/messages/{message_id}/feedback` | session + CSRF | `FeedbackIn` | `200 FeedbackOut`; sets or changes the caller's Feedback on their own finished answer; `404` for someone else's message or a user message; `409` while the answer is streaming or waiting for an Approval; `422` for any other value or an unknown field |
| DELETE | `/api/messages/{message_id}/feedback` | session + CSRF | | `204` |

Feedback is stored with the answer's trace id and the Tools it used, and sent to the trace as a
score named `user_feedback` (Langfuse, or the local JSONL trace log); a changed thumb updates the
same score. It is shown to admins together with the question and the answer, and it changes
nothing else: no policy, Guard, Slot, prompt or retrieval reads it. It is deleted with its
Conversation.

### (M6) Admin: Feedback and Evaluation Cases

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/admin/feedback?value=&limit=` | | `FeedbackDashboardOut`, newest first (`value` 1 or -1 filters) |
| POST | `/api/admin/feedback/{feedback_id}/evaluation-case` | `EvaluationCaseIn` | `201 EvaluationCaseOut`; `409` when this Feedback already became a case; `422` for a missing expected answer or Tool, or an unknown Tool |
| GET | `/api/admin/evaluation-cases` | | `EvaluationCaseOut[]` (cases added by admins; authored cases live in `eval/`) |
| DELETE | `/api/admin/evaluation-cases/{case_id}` | | `204`; the Feedback it came from stays, unlinked |

### (M6) Admin: evaluation

`rampart eval` and these endpoints run the same suites: `qa` (DeepEval faithfulness, answer
relevancy, contextual precision and recall on real Rampart turns, judged by the judge Slot),
`tool` (tool correctness, deterministic) and `guard` (the input Guard's precision and recall on
the labelled sets, deterministic). Turns run on a snapshot of the database and the vector store,
so they never add Conversations or usage to the real data. A run writes Markdown and JSON to
`docs/reports/eval/`; cases added from Feedback appear there by id only.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/admin/eval/datasets` | | `EvalDatasetsOut` |
| POST | `/api/admin/eval/estimate` | `EvalEstimateIn` | `EvalEstimateOut` at OpenRouter's listed prices (zero for local Models) |
| POST | `/api/admin/eval/runs` | `EvalRunIn` | `202 EvalRunOut[]`, one per suite, `queued`; the run executes in a separate process. `409` when the estimate changed since it was shown (more than 10 % or $0.01: review it again) or another run is queued or running |
| GET | `/api/admin/eval/runs` | | `EvalRunOut[]`, newest first; poll while one is queued or running (a run whose process disappeared is reported `failed`) |
| GET | `/api/admin/eval/runs/{run_id}` | | `EvalRunDetailOut` with the Markdown report |


### (M2) Help

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/help/docs` | session | `HelpDocOut[]`: the user guide and the admin guide, the same files that help mode searches |

Help mode is a Conversation setting (`help_mode: true`): every turn searches only the `app_docs` Sources (Rampart's guides) and cites them.

## Static files and development

- Production: FastAPI serves `frontend/dist` at `/`; any path that is not `/api/...` and does not match a file returns `index.html` so client routes work on reload.
- Development: the Vite dev server runs on `http://127.0.0.1:5173` and proxies `/api` to the backend on `http://127.0.0.1:8000`. Cookies work because both are same-origin through the proxy.

## Frontend routes (for reference)

| Route | Who | Content |
|---|---|---|
| `/login` | anyone | login form |
| `/` | signed in | app shell with Conversation list; starts a new Conversation on first message |
| `/c/:id` | signed in | one Conversation |
| `/account` | signed in | change password, own usage |
| `/admin` | admin | users, Models and Slots, usage for everyone |
| `/knowledge` | signed in | (M2) upload and delete own files, list shared Sources with origin and license, retrieval mode badge |
| `/profile` | signed in | (M2) Project Profile form: stack and packages; delete |
| `/help` | signed in | (M2) the guides, and a box that starts a help-mode Conversation |
| `/reports`, `/reports/:id` | signed in | (M3) own Reports: list, read, download, delete |
| `/targets` | signed in | (M4) register a loopback Target, run the injection suite, see per-case outcomes |
| `/admin` | admin | (M3) also Tools (enable, approver, rate limit), Approvals waiting for an admin, Audit (Tool calls, Guard events), Settings (persona, budget, Guard flags) |
| `/admin` | admin | (M5) also Plugins: the catalog with each Plugin's status, enable and disable, refresh, review the listed Tool definitions with warnings and the changes since acceptance, accept |
| `/admin` | admin | (M6) also Feedback (the dashboard, turning an answer into an Evaluation Case) and Evaluation (dataset sizes, added cases, the estimate and a confirmed start, runs with metrics, cost and the report) |
| `/`, `/c/:id` | signed in | (M6) thumbs up and down with an optional comment on each finished answer |
