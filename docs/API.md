# Rampart HTTP API

Version: milestone M1 (2026-11-06). Every path is prefixed with `/api`. The backend is FastAPI; the frontend is a React single-page app that only uses this contract. Later milestones add endpoints and server-sent events; they never change the shapes below without a note in this file.

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
}

type MessageStatus = "complete" | "streaming" | "error";

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
}

interface ConversationDetailOut {
  conversation: ConversationOut;
  messages: MessageOut[];         // chronological
}

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
| POST | `/api/conversations` | `{model_id?, title?}` | `201 ConversationOut`; default Model is the chat Slot; `422` when the Model is not an enabled chat Model |
| GET | `/api/conversations/{id}` | | `ConversationDetailOut` |
| PATCH | `/api/conversations/{id}` | `{title?, model_id?}` | `200 ConversationOut` |
| DELETE | `/api/conversations/{id}` | | `204` |
| POST | `/api/conversations/{id}/messages` | `{content}` | `200` stream `text/event-stream` (below); `409` when a turn is already streaming; `422` when content is empty or longer than 32 000 characters |

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

Later milestones add `tool_call`, `tool_result`, `approval_required`, `citations` and `guard` events between `start` and `done`; a client must ignore event names it does not know.

### Usage

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/usage/me` | session | `UsageOut` for the caller |
| GET | `/api/admin/usage` | admin | `AdminUsageOut` for everyone |

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
