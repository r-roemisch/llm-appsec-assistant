# Rampart frontend

The React single-page app for Rampart, an assistant for reviewing the security of LLM applications. It is only a client of the backend's JSON and server-sent-event API; every rule is enforced server-side (see `docs/adr/0001-react-spa-on-fastapi.md`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on http://127.0.0.1:5173, proxying `/api` to the backend on http://127.0.0.1:8000 |
| `npm run build` | type check (`tsc -b`) then production build into `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run test` | Vitest (jsdom, Testing Library) |
| `npm run preview` | serve the production build locally |

Stack: React 19, Vite 8, TypeScript 6, Tailwind CSS 4, shadcn/ui (Radix), React Router 8, TanStack Query 5, react-markdown with remark-gfm, Vitest.

## The API contract

`docs/API.md` at the repository root is the contract. `src/lib/api.ts` is the only module that calls the backend: it sends `credentials: "same-origin"`, keeps the CSRF token from the last `SessionOut` in memory (never in storage) and attaches it as `X-CSRF-Token` to POST, PUT, PATCH and DELETE (not to login), URL-encodes Model ids, and on any 401 outside login clears the session and sends the app to `/login`. After a password change it reads `/api/auth/me` again, because the server starts a new session with a new CSRF token; Sign out drops the session only once the server confirms it (or answers 401), and otherwise says it could not sign out. Uploads go out as `multipart/form-data` (field `file`) with the CSRF header; the browser sets the `Content-Type` boundary. The admin Plugin calls (M5) follow the same rules: `PUT /api/admin/plugins/{id}` sends only `{enabled}`, refresh is a POST without a body (still with the CSRF header), and accept sends `{digest}`, the `current_tools_digest` of the definitions on screen; a `409` there means they changed since the review, so the detail is fetched again and nothing is accepted until the admin confirms once more. The M6 calls follow the same rules too: `PUT /api/messages/{id}/feedback` replaces the caller's Feedback (`{value}` alone clears the comment) and `DELETE` removes it; `GET /api/admin/feedback` takes `?value=1|-1&limit=`; the evaluation estimate is a POST (so it carries the CSRF header), and `POST /api/admin/eval/runs` sends the suite and limit that were estimated plus `confirm_cost_usd`, the `total_usd` on screen (`null` when the cost is unknown). A `409` there (the estimate moved, or another run is active) is shown as it came and the estimate is fetched again, so a run starts only after a confirm of the current total. `src/lib/sse.ts` parses the event stream of `POST /api/conversations/{id}/messages` and of the Approval endpoints; `src/lib/live-turn.ts` drives one streaming turn (the `retrieval`, `citations`, `guard`, `tool_call`, `tool_result` and `notice` events, ignoring names it does not know) and reconciles the TanStack Query cache when it ends with `done`, `error` or `approval_required`. A decision on an Approval (`POST .../approvals/{id}`, or `.../continue` after an admin decided or it expired) starts a resumed stream that continues the same assistant message: its text and Tool calls (merged by call id) grow from the stored ones, and the message is replaced in place when the stream ends.

Each answer shows its Tool calls as cards before the text (`ToolCallCard.tsx`: readable name, key arguments, collapsible JSON, the Gateway's decision, the result, a link for generated Reports), the Approval card while it waits (`ApprovalCard.tsx`: what runs, who approves, the expiry countdown, Approve and Reject or Continue), plain-language Guard notices and stop notices (`GuardNotices.tsx`; the wording lives in `src/lib/guards.ts` and `src/lib/notices.ts`). While a Conversation waits for a decision the composer is closed; a waiting admin Approval is polled every 30 seconds. A `run_injection_test` result (M4) shows its verdict badge (`InjectionResult.tsx`). A Plugin Tool (M5: named `<plugin_id>__<tool>`, `contributed_by: "plugin:<id>"`) reads as its tool part plus a "Plugin <id>" badge on both cards; the Approval card says it is third-party code running on the server, and its result reads as untrusted Plugin output (`src/lib/tools.ts` has the name helpers).

Each finished answer (status `complete` or `error`; not while it streams or waits for an Approval) ends with thumbs up and down (M6, `AnswerFeedback.tsx`): toggle buttons labelled "Helpful" and "Not helpful" with `aria-pressed` from `message.feedback`. A click saves the rating at once (an optimistic update of the cached Conversation, rolled back with a toast when the server refuses) and opens a small comment form (optional, at most 1000 characters, Save or Skip) that says every time that administrators see the rating and comment with the question and the answer, and that Feedback alone never changes how Rampart answers. The pressed thumb again removes the rating; the other thumb changes it and keeps the comment. `src/lib/feedback.ts` holds the rules.

Answers render through `src/components/conversation/Markdown.tsx` (react-markdown with remark-gfm, no raw HTML, images shown as links). Inside an answer, `[n]` markers that match a Citation become chips that open the passage (`CitedText.tsx`, which splits text nodes in the element renderers; no rehype plugin); everywhere else, and for numbers without a Citation, they stay text.

In production FastAPI serves `dist/` at `/` and falls back to `index.html` for client routes. `vite.config.ts` sets `base: "/"` and `build.outDir: "dist"`.

## Routes

| Route | Who | Page |
|---|---|---|
| `/login` | anyone | `src/pages/LoginPage.tsx`, with the health footer |
| `/` | signed in | `src/pages/ConversationPage.tsx`; the first message creates the Conversation and navigates to `/c/:id` |
| `/c/:id` | signed in | the same page showing one Conversation: retrieval progress, Citations with a Sources list, the help mode toggle, thumbs up and down on finished answers (M6) |
| `/knowledge` | signed in | `src/pages/KnowledgePage.tsx`: retrieval mode, uploads (add, delete), shared Sources with origin and license |
| `/profile` | signed in | `src/pages/ProfilePage.tsx`: the Project Profile form (stack, packages and, from M4, the Targets it covers), save and delete |
| `/targets` | signed in | `src/pages/TargetsPage.tsx` (M4): register a loopback Target (name, base URL checked as a loopback literal, input surface, expected profile), list own Targets with edit and delete, and "Run a test", which opens a new Conversation with the request drafted; the suite itself runs in the Conversation after an Approval, and its Tool card shows the verdict |
| `/help` | signed in | `src/pages/HelpPage.tsx`: the guides, and a box that starts a help-mode Conversation |
| `/reports` | signed in | `src/pages/ReportsPage.tsx`: own Reports with date and size; open, download (a same-origin link to `/api/reports/{id}/download`), delete after confirmation |
| `/reports/:id` | signed in | `src/pages/ReportPage.tsx`: one Report rendered as Markdown, with a download button |
| `/account` | signed in | `src/pages/AccountPage.tsx`: change password, own usage |
| `/admin` | admin | `src/pages/AdminPage.tsx`: users, Models and Slots, usage for everyone, Tools (enabled, approver, rate limit; Plugin Tools with a "Plugin: <id>" badge and, when blocked, why), Plugins (M5, below), Approvals waiting for an admin and recent decisions, Audit (Tool calls, Guard events), Feedback and Evaluation (M6, below), Settings (persona, token budget, input guard and classifier); a `user` sees "Not allowed" |

`src/App.tsx` holds the route table; the pages other than the Conversation view load on demand. `RequireSession` loads `GET /api/auth/me` once and redirects to `/login` when there is no session; `AppShell` is the sidebar layout around the signed-in pages, with links to the Knowledge Base, Project Profile, Targets, Reports and Help pages under "New conversation". The Admin page keeps its tab in the URL (`/admin?tab=plugins`).

The Plugins tab (`src/components/admin/PluginsTab.tsx`, M5) lists `plugins/catalog.yaml` with each Plugin's status, enabled switch (enabling lists its Tools, about a second), Tool count, last listing or error and the read-only command; it cannot add a Plugin or edit a command, because no endpoint does. A Plugin's detail (`PluginDetailDialog.tsx`, kept in the URL as `?plugin=<id>` so the Tools tab can link to it) refreshes the listing, shows each listed definition with its warnings first (`PluginReview.tsx`), the changes since acceptance with a before/after view per changed field (a word or line diff from `src/lib/plugins.ts`), and accepts after a confirm step that names the number of definitions and the warnings. Everything a Plugin's server sends is rendered as plain text or preformatted JSON.

The Feedback tab (`src/components/admin/FeedbackTab.tsx`, M6) shows the totals (ratings, helpful, not helpful, converted to cases), a filter (all, not helpful, helpful) and the latest 200 ratings: date, user, thumb, comment (plain text), the question, the answer (folded, then rendered with the Markdown component), Model, Tools used, the trace id (copyable) and where the score went (sent to Langfuse, in the local trace log, or not forwarded). "Make an Evaluation Case" opens `EvaluationCaseDialog.tsx`: kind `qa` or `tool`, the question prefilled from the user's question, for `qa` an expected answer prefilled with the answer and a hint to correct it into the reference answer, for `tool` a checklist of the Tools from `GET /api/admin/tools` prefilled with the Tools used; a `409` (already a case) or `422` shows in the dialog. A converted answer shows "Case <id>" instead.

The Evaluation tab (`src/components/admin/EvaluationTab.tsx`, M6) shows the dataset sizes, a new run (suite and an optional "first N cases", then "Estimate": a table per suite with cases, Model calls, judge calls, the judge Model and the cost, the notes and the total, then a deliberate "Run for about $X" or "Run (cost unknown)" button; a `qa` estimate says in a warning that a judge Model scores every answer and what that costs), the runs (status with a spinner while queued or running, who started it, estimated against actual cost, a compact metrics summary from `src/lib/eval.ts`, the error of a failed run) and the cases added from Feedback with delete after a confirm. The runs list is fetched every 3 seconds while a run is queued or running and not at all once every run is done or failed; a run's detail (`EvalRunDetailDialog.tsx`, kept in the URL as `?run=<id>`) shows every field and the Markdown report.

## Layout of `src/`

- `lib/` – API client, SSE parser, formatters, theme store, live-turn store, types, and small pure helpers (Citation markers, retrieval progress, upload checks, profile validation, Target checks, Tool call states and labels, Guard and stop notice wording, admin settings checks, Plugin statuses and the definition diff, Feedback rules and Evaluation Case drafts, evaluation run states and metric summaries)
- `hooks/` – TanStack Query hooks and small stores
- `components/ui/` – shadcn/ui components; `components/shell`, `conversation`, `knowledge`, `profile`, `targets`, `help`, `reports`, `admin`, `account`, `usage`, `common` – feature components
- `pages/` – one file per route
- `test/` – Vitest setup and tests

Only two things are kept in `localStorage`: the theme (`rampart.theme`) and whether the sidebar is collapsed (`rampart.sidebar`).
