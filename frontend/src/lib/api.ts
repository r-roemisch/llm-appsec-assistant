// The only module that talks to the backend. Every call goes through `send`,
// which applies the rules from docs/API.md: same-origin cookies, the CSRF
// header on state-changing requests (not on login), and session reset on 401.

import { emitUnauthorized, session } from "@/lib/session";
import { parseSSE, type SSEEvent } from "@/lib/sse";
import type {
  AdminSettingsOut,
  AdminSettingsPatch,
  AdminUsageOut,
  ApprovalDecision,
  ApprovalOut,
  ApprovalStatus,
  Approver,
  ConversationCreate,
  ConversationDetailOut,
  ConversationOut,
  ConversationPatch,
  EvalDatasetsOut,
  EvalEstimateIn,
  EvalEstimateOut,
  EvalRunDetailOut,
  EvalRunIn,
  EvalRunOut,
  EvaluationCaseIn,
  EvaluationCaseOut,
  FeedbackDashboardOut,
  FeedbackIn,
  FeedbackOut,
  FeedbackValue,
  GuardEventRecordOut,
  HealthOut,
  HelpDocOut,
  KnowledgeStatusOut,
  ModelOut,
  ModelsOut,
  PassageOut,
  PluginAcceptIn,
  PluginCatalogOut,
  PluginDetailOut,
  PluginUpdateIn,
  DependencyFileIn,
  DependencyFileOut,
  DependencyImportIn,
  ProfileIn,
  ProfileOut,
  ReportDetailOut,
  ReportOut,
  Role,
  SessionOut,
  Slot,
  SlotOut,
  SlotPatch,
  SourceOut,
  TargetCreateIn,
  TargetOut,
  TargetUpdateIn,
  ToolCallRecordOut,
  ToolDecision,
  ToolOut,
  ToolPolicyPatch,
  TurnEvent,
  UsageOut,
  UserOut,
} from "@/lib/types";

export type * from "@/lib/types";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly body: unknown;

  constructor(status: number, detail: string, body: unknown = null) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.body = body;
  }
}

/** A short, user-facing message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface SendOptions {
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as multipart/form-data; the browser sets Content-Type with the boundary. */
  form?: FormData;
  signal?: AbortSignal;
  /** The login call: no CSRF header, and a 401 means bad credentials. */
  login?: boolean;
  accept?: string;
}

const STATE_CHANGING: ReadonlySet<Method> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function defaultDetail(status: number): string {
  switch (status) {
    case 401:
      return "You are not signed in";
    case 403:
      return "Not allowed";
    case 404:
      return "Not found";
    case 409:
      return "Conflict";
    case 422:
      return "Invalid request";
    default:
      return `Request failed (${status})`;
  }
}

interface ValidationItem {
  loc?: unknown[];
  msg?: string;
}

function extractDetail(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item: ValidationItem) => {
        if (!item || typeof item !== "object") return null;
        const loc = Array.isArray(item.loc)
          ? item.loc.filter((part) => typeof part === "string" && part !== "body")
          : [];
        const field = loc.length > 0 ? String(loc[loc.length - 1]) : null;
        if (!item.msg) return field;
        return field ? `${field}: ${item.msg}` : item.msg;
      })
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join("; ") : null;
  }
  return null;
}

async function toApiError(response: Response, isLogin: boolean): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => null);
  const detail = extractDetail(body) ?? defaultDetail(response.status);
  if (response.status === 401 && !isLogin) {
    session.clear();
    emitUnauthorized();
  }
  return new ApiError(response.status, detail, body);
}

async function send(method: Method, path: string, options: SendOptions = {}): Promise<Response> {
  const headers = new Headers({ Accept: options.accept ?? "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (STATE_CHANGING.has(method) && !options.login) {
    const token = session.csrfToken();
    if (token) headers.set("X-CSRF-Token", token);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(0, "Could not reach the server");
  }

  if (!response.ok) throw await toApiError(response, options.login === true);
  return response;
}

async function request<T>(method: Method, path: string, options: SendOptions = {}): Promise<T> {
  const response = await send(method, path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const encode = encodeURIComponent;

/** Appends the given query parameters, skipping empty ones. */
function withQuery(path: string, params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/** POSTs to an endpoint that answers with server-sent events and yields them. */
async function* openStream(
  path: string,
  body: unknown,
  signal: AbortSignal | undefined,
): AsyncGenerator<SSEEvent, void, undefined> {
  const response = await send("POST", path, { body, signal, accept: "text/event-stream" });
  if (!response.body) throw new ApiError(0, "The server sent an empty stream");
  yield* parseSSE(response.body, signal);
}

// Health

export function getHealth(): Promise<HealthOut> {
  return request("GET", "/api/health");
}

// Auth

export async function login(username: string, password: string): Promise<SessionOut> {
  const result = await request<SessionOut>("POST", "/api/auth/login", {
    body: { username, password },
    login: true,
  });
  session.set(result);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await request<void>("POST", "/api/auth/logout");
  } finally {
    session.clear();
  }
}

export async function getMe(): Promise<SessionOut> {
  const result = await request<SessionOut>("GET", "/api/auth/me");
  session.set(result);
  return result;
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request("POST", "/api/auth/password", {
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

// Admin: users

export function listUsers(): Promise<UserOut[]> {
  return request("GET", "/api/admin/users");
}

export function createUser(input: { username: string; password: string; role: Role }): Promise<UserOut> {
  return request("POST", "/api/admin/users", { body: input });
}

export function resetUserPassword(userId: number, newPassword: string): Promise<void> {
  return request("POST", `/api/admin/users/${encode(String(userId))}/password`, {
    body: { new_password: newPassword },
  });
}

export function deleteUser(userId: number): Promise<void> {
  return request("DELETE", `/api/admin/users/${encode(String(userId))}`);
}

// Models and Slots

export function getModels(): Promise<ModelsOut> {
  return request("GET", "/api/models");
}

export function setSlot(slot: Slot, patch: SlotPatch): Promise<Record<Slot, SlotOut>> {
  return request("PUT", `/api/admin/models/slots/${encode(slot)}`, { body: patch });
}

export function resetSlot(slot: Slot): Promise<Record<Slot, SlotOut>> {
  return request("DELETE", `/api/admin/models/slots/${encode(slot)}`);
}

export function setModelEnabled(modelId: string, enabled: boolean): Promise<ModelOut> {
  return request("PUT", `/api/admin/models/${encode(modelId)}`, { body: { enabled } });
}

// Conversations

export function listConversations(): Promise<ConversationOut[]> {
  return request("GET", "/api/conversations");
}

export function createConversation(input: ConversationCreate = {}): Promise<ConversationOut> {
  return request("POST", "/api/conversations", { body: input });
}

export function getConversation(id: string): Promise<ConversationDetailOut> {
  return request("GET", `/api/conversations/${encode(id)}`);
}

export function updateConversation(id: string, patch: ConversationPatch): Promise<ConversationOut> {
  return request("PATCH", `/api/conversations/${encode(id)}`, { body: patch });
}

export function deleteConversation(id: string): Promise<void> {
  return request("DELETE", `/api/conversations/${encode(id)}`);
}

const TURN_EVENTS: ReadonlySet<string> = new Set([
  "start",
  "resume",
  "retrieval",
  "guard",
  "tool_call",
  "tool_result",
  "delta",
  "notice",
  "citations",
  "usage",
  "done",
  "error",
  "approval_required",
]);

/**
 * Narrows a raw event to the contract's turn events. Unknown names, and known
 * names whose data is not a JSON object, give null so callers skip them.
 */
export function toTurnEvent(event: SSEEvent): TurnEvent | null {
  if (!TURN_EVENTS.has(event.event)) return null;
  if (typeof event.data !== "object" || event.data === null) return null;
  return event as TurnEvent;
}

/**
 * Sends one user message and yields the server-sent events of the answer.
 * Unknown event names are yielded as-is so callers can ignore them.
 */
export function streamTurn(
  conversationId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, undefined> {
  return openStream(`/api/conversations/${encode(conversationId)}/messages`, { content }, signal);
}

function approvalPath(conversationId: string, approvalId: string): string {
  return `/api/conversations/${encode(conversationId)}/approvals/${encode(approvalId)}`;
}

/**
 * Approves or rejects the Approval a turn waits for (M3). The answer is a
 * stream that continues the same assistant message: `resume`, then events as
 * in a turn, ending with `done`, `error` or another `approval_required`.
 */
export function streamApprovalDecision(
  conversationId: string,
  approvalId: string,
  decision: ApprovalDecision,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, undefined> {
  return openStream(approvalPath(conversationId, approvalId), { decision }, signal);
}

/** Continues a turn after an admin decided its Approval or the Approval expired (M3). */
export function streamApprovalContinue(
  conversationId: string,
  approvalId: string,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, undefined> {
  return openStream(`${approvalPath(conversationId, approvalId)}/continue`, undefined, signal);
}

// Usage

export function getMyUsage(): Promise<UsageOut> {
  return request("GET", "/api/usage/me");
}

export function getAdminUsage(): Promise<AdminUsageOut> {
  return request("GET", "/api/admin/usage");
}

// Knowledge Base (M2)

export function getKnowledgeStatus(): Promise<KnowledgeStatusOut> {
  return request("GET", "/api/knowledge/status");
}

/** The caller's uploads (newest first), then shared Sources (curated, then app_docs). */
export function listSources(): Promise<SourceOut[]> {
  return request("GET", "/api/knowledge/sources");
}

/** Uploads one file as the multipart field `file`. */
export function uploadSource(file: File): Promise<SourceOut> {
  const form = new FormData();
  form.append("file", file);
  return request("POST", "/api/knowledge/uploads", { form });
}

/** Deletes one of the caller's uploads; shared Sources answer 403. */
export function deleteSource(id: string): Promise<void> {
  return request("DELETE", `/api/knowledge/sources/${encode(id)}`);
}

export function getPassage(id: string): Promise<PassageOut> {
  return request("GET", `/api/knowledge/passages/${encode(id)}`);
}

// Project Profile (M2)

export function getProfile(): Promise<ProfileOut> {
  return request("GET", "/api/profile");
}

export function saveProfile(input: ProfileIn): Promise<ProfileOut> {
  return request("PUT", "/api/profile", { body: input });
}

export function deleteProfile(): Promise<void> {
  return request("DELETE", "/api/profile");
}

/** (M7) What a Dependency File contains; nothing is saved. */
export function previewDependencyFile(input: DependencyFileIn): Promise<DependencyFileOut> {
  return request("POST", "/api/profile/dependency-file/preview", { body: input });
}

/** (M7) Merges (or with `replace`, sets) the profile's packages from a Dependency File. */
export function importDependencyFile(input: DependencyImportIn): Promise<ProfileOut> {
  return request("POST", "/api/profile/dependency-file/import", { body: input });
}

// Help (M2)

export function getHelpDocs(): Promise<HelpDocOut[]> {
  return request("GET", "/api/help/docs");
}

// Targets (M4)

/** The caller's own Targets, newest first. */
export function listTargets(): Promise<TargetOut[]> {
  return request("GET", "/api/targets");
}

/** Registers a loopback Target; `422` for a non-loopback URL, `409` for a duplicate. */
export function createTarget(input: TargetCreateIn): Promise<TargetOut> {
  return request("POST", "/api/targets", { body: input });
}

/** Renames a Target or sets/clears its profile (`profile: null` clears it). */
export function updateTarget(id: string, patch: TargetUpdateIn): Promise<TargetOut> {
  return request("PATCH", `/api/targets/${encode(id)}`, { body: patch });
}

export function deleteTarget(id: string): Promise<void> {
  return request("DELETE", `/api/targets/${encode(id)}`);
}

// Tools and Reports (M3)

/** The caller's own Reports, newest first. */
export function listReports(): Promise<ReportOut[]> {
  return request("GET", "/api/reports");
}

export function getReport(id: string): Promise<ReportDetailOut> {
  return request("GET", `/api/reports/${encode(id)}`);
}

/** A same-origin link; the cookie authenticates it and a GET needs no CSRF token. */
export function reportDownloadUrl(id: string): string {
  return `/api/reports/${encode(id)}/download`;
}

export function deleteReport(id: string): Promise<void> {
  return request("DELETE", `/api/reports/${encode(id)}`);
}

// Admin controls (M3)

/** Every Tool with its effective policy. */
export function listAdminTools(): Promise<ToolOut[]> {
  return request("GET", "/api/admin/tools");
}

export function updateTool(name: string, patch: ToolPolicyPatch): Promise<ToolOut> {
  return request("PUT", `/api/admin/tools/${encode(name)}`, { body: patch });
}

export interface ApprovalFilters {
  status?: ApprovalStatus;
  approver?: Approver;
}

/** Approvals, newest first. */
export function listApprovals(filters: ApprovalFilters = {}): Promise<ApprovalOut[]> {
  return request("GET", withQuery("/api/admin/approvals", { status: filters.status, approver: filters.approver }));
}

/** An admin decides an Approval whose approver is "admin". */
export function decideApproval(id: string, decision: ApprovalDecision): Promise<ApprovalOut> {
  return request("POST", `/api/admin/approvals/${encode(id)}`, { body: { decision } });
}

export interface ToolCallAuditFilters {
  limit?: number;
  tool?: string;
  decision?: ToolDecision;
}

/** Every Gateway decision, newest first. */
export function listToolCallRecords(filters: ToolCallAuditFilters = {}): Promise<ToolCallRecordOut[]> {
  return request(
    "GET",
    withQuery("/api/admin/audit/tool-calls", { limit: filters.limit, tool: filters.tool, decision: filters.decision }),
  );
}

export interface GuardEventAuditFilters {
  limit?: number;
  guard?: string;
}

/** What the Guards did, newest first. */
export function listGuardEventRecords(filters: GuardEventAuditFilters = {}): Promise<GuardEventRecordOut[]> {
  return request("GET", withQuery("/api/admin/audit/guard-events", { limit: filters.limit, guard: filters.guard }));
}

export function getAdminSettings(): Promise<AdminSettingsOut> {
  return request("GET", "/api/admin/settings");
}

export function updateAdminSettings(patch: AdminSettingsPatch): Promise<AdminSettingsOut> {
  return request("PUT", "/api/admin/settings", { body: patch });
}

// Admin: Plugins (M5). Plugins and their commands live in plugins/catalog.yaml
// on the server: there is deliberately no call that adds one or sets a command.

/** The catalog: entries in file order, then stored Plugins no longer in it. */
export function listPlugins(): Promise<PluginCatalogOut> {
  return request("GET", "/api/admin/plugins");
}

/** One Plugin with its current and accepted Tool definitions and the changes between them. */
export function getPlugin(id: string): Promise<PluginDetailOut> {
  return request("GET", `/api/admin/plugins/${encode(id)}`);
}

/**
 * Starts the server and lists its Tools (about a second). A failed listing is
 * `status: "error"` with `last_error`, not an HTTP error.
 */
export function refreshPlugin(id: string): Promise<PluginDetailOut> {
  return request("POST", `/api/admin/plugins/${encode(id)}/refresh`);
}

/** Enables or disables a Plugin; enabling also lists its Tools. Nothing else can be set. */
export function setPluginEnabled(id: string, enabled: boolean): Promise<PluginDetailOut> {
  const body: PluginUpdateIn = { enabled };
  return request("PUT", `/api/admin/plugins/${encode(id)}`, { body });
}

/**
 * Accepts the definitions the admin reviewed, named by their digest (the
 * `current_tools_digest` shown). `409` when it is no longer the current one.
 */
export function acceptPlugin(id: string, digest: string): Promise<PluginDetailOut> {
  const body: PluginAcceptIn = { digest };
  return request("POST", `/api/admin/plugins/${encode(id)}/accept`, { body });
}

// Feedback (M6). Capture only: stored with the answer's trace id, sent to the
// trace as a score and shown to admins; it changes nothing else.

/**
 * Sets or changes the caller's Feedback on their own finished answer. The PUT
 * replaces it: a body without a comment clears the comment. `409` while the
 * answer streams or waits for an Approval.
 */
export function setFeedback(messageId: string, input: FeedbackIn): Promise<FeedbackOut> {
  return request("PUT", `/api/messages/${encode(messageId)}/feedback`, { body: input });
}

export function deleteFeedback(messageId: string): Promise<void> {
  return request("DELETE", `/api/messages/${encode(messageId)}/feedback`);
}

// Admin: Feedback and Evaluation Cases (M6)

export interface FeedbackFilters {
  /** Only thumbs up (1) or down (-1). */
  value?: FeedbackValue;
  limit?: number;
}

/** The totals and the Feedback, newest first. */
export function getFeedbackDashboard(filters: FeedbackFilters = {}): Promise<FeedbackDashboardOut> {
  return request("GET", withQuery("/api/admin/feedback", { value: filters.value, limit: filters.limit }));
}

/**
 * Turns an answer with Feedback into an Evaluation Case that the next
 * evaluation run includes. `409` when this Feedback already became one, `422`
 * for a missing expected answer or Tool, or an unknown Tool.
 */
export function createEvaluationCase(feedbackId: string, input: EvaluationCaseIn): Promise<EvaluationCaseOut> {
  return request("POST", `/api/admin/feedback/${encode(feedbackId)}/evaluation-case`, { body: input });
}

/** The cases admins added (authored cases live in eval/ on the server). */
export function listEvaluationCases(): Promise<EvaluationCaseOut[]> {
  return request("GET", "/api/admin/evaluation-cases");
}

/** The Feedback it came from stays, unlinked. */
export function deleteEvaluationCase(id: string): Promise<void> {
  return request("DELETE", `/api/admin/evaluation-cases/${encode(id)}`);
}

// Admin: evaluation (M6). A run executes in a separate process on the server
// and takes minutes; poll the runs while one is queued or running.

export function getEvalDatasets(): Promise<EvalDatasetsOut> {
  return request("GET", "/api/admin/eval/datasets");
}

/** What a run would cost, at OpenRouter's listed prices (zero for local Models). */
export function estimateEval(input: EvalEstimateIn): Promise<EvalEstimateOut> {
  return request("POST", "/api/admin/eval/estimate", { body: input });
}

/**
 * Starts one run per suite after the admin confirmed `confirm_cost_usd`, the
 * total shown. `409` when the estimate changed since (review it again) or
 * another run is queued or running.
 */
export function startEvalRuns(input: EvalRunIn): Promise<EvalRunOut[]> {
  return request("POST", "/api/admin/eval/runs", { body: input });
}

/** Newest first; a run whose process disappeared is reported failed. */
export function listEvalRuns(): Promise<EvalRunOut[]> {
  return request("GET", "/api/admin/eval/runs");
}

/** One run with its Markdown report. */
export function getEvalRun(id: string): Promise<EvalRunDetailOut> {
  return request("GET", `/api/admin/eval/runs/${encode(id)}`);
}
