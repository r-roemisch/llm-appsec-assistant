// The only module that talks to the backend. Every call goes through `send`,
// which applies the rules from docs/API.md: same-origin cookies, the CSRF
// header on state-changing requests (not on login), and session reset on 401.

import { emitUnauthorized, session } from "@/lib/session";
import { parseSSE, type SSEEvent } from "@/lib/sse";
import type {
  AdminUsageOut,
  ConversationDetailOut,
  ConversationOut,
  HealthOut,
  ModelOut,
  ModelsOut,
  Role,
  SessionOut,
  Slot,
  SlotOut,
  SlotPatch,
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
  body?: unknown;
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
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
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

export function createConversation(input: { model_id?: string; title?: string } = {}): Promise<ConversationOut> {
  return request("POST", "/api/conversations", { body: input });
}

export function getConversation(id: string): Promise<ConversationDetailOut> {
  return request("GET", `/api/conversations/${encode(id)}`);
}

export function updateConversation(
  id: string,
  patch: { title?: string; model_id?: string },
): Promise<ConversationOut> {
  return request("PATCH", `/api/conversations/${encode(id)}`, { body: patch });
}

export function deleteConversation(id: string): Promise<void> {
  return request("DELETE", `/api/conversations/${encode(id)}`);
}

const TURN_EVENTS: ReadonlySet<string> = new Set(["start", "delta", "usage", "done", "error"]);

/** Narrows a raw event to the contract's turn events; unknown names give null. */
export function toTurnEvent(event: SSEEvent): TurnEvent | null {
  return TURN_EVENTS.has(event.event) ? (event as TurnEvent) : null;
}

/**
 * Sends one user message and yields the server-sent events of the answer.
 * Unknown event names are yielded as-is so callers can ignore them.
 */
export async function* streamTurn(
  conversationId: string,
  content: string,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent, void, undefined> {
  const response = await send("POST", `/api/conversations/${encode(conversationId)}/messages`, {
    body: { content },
    signal,
    accept: "text/event-stream",
  });
  if (!response.body) throw new ApiError(0, "The server sent an empty stream");
  yield* parseSSE(response.body, signal);
}

// Usage

export function getMyUsage(): Promise<UsageOut> {
  return request("GET", "/api/usage/me");
}

export function getAdminUsage(): Promise<AdminUsageOut> {
  return request("GET", "/api/admin/usage");
}
