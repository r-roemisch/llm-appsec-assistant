# Rampart admin guide

This guide is for administrators: accounts, models, the Knowledge Base, usage and tracing,
Tools and Approvals, Guards, the audit log, settings and Plugins.

## Accounts

There is no sign-up page. Create accounts on the Admin page (Users) or with the command line:

- `uv run rampart init` creates the database and the first admin account.
- `uv run rampart user create <name>` creates a user; add `--role admin` for an admin.
- `uv run rampart user reset-password <name>` sets a new password and signs the account out.
- `uv run rampart user list` lists accounts.

Deleting a user on the Admin page also deletes their conversations (with their saved
conversation state), uploads and Project Profile. You cannot delete your own account.

Sign-in is throttled: after five failed sign-ins for one username, or thirty from one client
address, within fifteen minutes, further attempts get "429 Too Many Requests" with a
Retry-After header until the oldest failure leaves the window. The password is not checked
meanwhile, and refused attempts are not counted, so the block ends on its own. Resetting a
user's password (Admin page or `rampart user reset-password`) ends it at once. The limits are
`RAMPART_LOGIN_MAX_FAILURES_PER_USER`, `RAMPART_LOGIN_MAX_FAILURES_PER_CLIENT` and
`RAMPART_LOGIN_WINDOW_MINUTES`. Behind a reverse proxy every request seems to come from the
proxy; set `RAMPART_TRUST_PROXY_HEADERS=true` only if the proxy sets `X-Forwarded-For`, or a
client could choose its own address. Each block is logged by the `rampart.auth` logger.

## Models and Slots

`models.yaml` in the repository root is the model catalog. Each entry has an id, a provider
(`openrouter` for hosted models, `ollama` for local ones), a display name, a kind (`chat` or
`embedding`) and a tier (`cheap` or `powerful`). API keys never go in this file; they live
in `.env`.

A Slot is a job a model is assigned to:

- `chat`: the default model for new conversations; its temperature and max tokens apply to
  every chat model.
- `grader`: decides whether a turn should search the Knowledge Base, grades which retrieved
  passages are relevant, and rewrites a search query that found nothing.
- `judge`: scores answers in `rampart eval` (default `openai/gpt-6.1-sol`, the powerful tier;
  the OpenRouter workspace this was built with blocks `anthropic/claude-opus-5.5`).
- `embedding`: turns passages and search queries into vectors for meaning-based search.

Local models run through Ollama. Rampart gives them a 16k-token context window
(`RAMPART_OLLAMA_NUM_CTX`), because Ollama's default of 4096 tokens silently drops the start
of longer prompts, where the system prompt sits. Local models do not think before routing,
grading or rewriting, and by default not before answering either: on a computer without a GPU
thinking makes a turn many times slower. Set `RAMPART_OLLAMA_THINKING=true` in `.env` to let
local answers think. With a local model in both the chat and the grader Slot and no OpenRouter
key, Rampart runs entirely offline with keyword search.

The defaults come from `models.yaml`. On the Admin page (Models) you can assign another
catalog model to any Slot, set temperature and max tokens, and reset a Slot to its default;
overrides are stored in the database. You can also disable a model so that users cannot pick
it; a model that a Slot uses cannot be disabled until the Slot is reassigned.

## The Knowledge Base

Rampart answers from a Knowledge Base of Sources split into passages. Load it with:

- `uv run rampart ingest` fetches the OWASP Top 10 for LLM Applications 2025 and MITRE ATLAS
  (both pinned to a fixed commit, so the content is reproducible) and the NIST AI RMF
  publications AI 100-1 and AI 600-1 from their official locations, and stores Rampart's
  primers and guides. The licenses are recorded on each Source and shown with citations.
- `uv run rampart ingest --fixtures` works offline: it stores synthetic fixture Sources
  instead of fetching, plus the primers and guides. `rampart demo` does this for you.
- `--no-embed` skips embeddings; search is then keyword-only until the next ingest.

Running `rampart ingest` again updates changed Sources, leaves unchanged ones alone, and
embeds every passage that has no vector for the current embedding model. Nothing at runtime
can add a URL to fetch: the locations are fixed in the code, and the assistant has no tool
that fetches web pages.

Search combines embeddings with keyword (BM25) search. Without an available embedding model,
for example when OpenRouter is not configured or the local embedding model is not pulled,
search falls back to keywords only and answers show a "keyword search only" badge. If you
assign a different model to the embedding Slot, run `rampart ingest` again so that the
passages get vectors from the new model; until then search is keyword-only.

Users' uploads are private to their owner. Administrators cannot list, search or read other
users' uploads through the application.

## Usage and costs

The Admin page (Usage) shows tokens and costs for everyone, per user and per model. A turn can
use several models: the grader for routing, grading and rewriting, the embedding model for
the search query, and the chat model for the answer. Each call is recorded under its own
model, so the per-model view shows what the grader and embedding models cost. Costs are the
amounts OpenRouter reports per request; local Ollama models cost nothing. A turn whose
provider reported no cost shows its cost as unknown.

Embedding the Knowledge Base during `rampart ingest` is printed by the command and is not
part of any user's usage.

## Tracing

With `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_HOST` set in `.env`, every turn
becomes a Langfuse trace with the user id, the conversation id and the model, and the route,
search queries and model calls as metadata. Rampart also appends one JSON line per turn to
`data/traces/<date>.jsonl`, always: without Langfuse that is the trace, with Langfuse it is a copy
under the same trace id, so traces survive a Langfuse outage. The trace id is stored on each
assistant message, and Feedback becomes a `user_feedback` score on it (in Langfuse and in the
JSONL file).

Local trace files are kept until you delete them: `uv run rampart traces prune --older-than 30`
deletes the files older than 30 days (`--dry-run` lists them first), and
`RAMPART_TRACE_RETENTION_DAYS=30` does the same each time the server starts. Langfuse keeps
its copy under the retention setting of your Langfuse project. `docs/data_flows.md` lists every
place Rampart stores data or sends it, what is redacted first and how long it is kept.

## Tools and the Gateway

Five built-in tools exist: `search_knowledge`, `analyze_prompt`, `lookup_vulnerabilities`,
`generate_report` and `run_injection_test`. Every call passes the Gateway, in this order:
registered tool, enabled, allowed for the caller's role, arguments valid against the tool's
schema with no undeclared properties, the per-turn limit of tool calls, the hourly rate limit
per user, the conversation's token budget, tool-specific constraints (the injection test only
accepts the caller's registered loopback Targets; a report only covers the caller's own
conversation), and an Approval when the tool needs one. The model never sees or edits this
policy, and no tool can change it.

On the Admin page (Tools) you can enable or disable each tool, set its hourly rate limit, and
switch who approves its calls: the requesting user (default) or an administrator. A disabled
tool is no longer offered to the model, and a call to it is denied. Note that
`search_knowledge` is the model's *extra* search; the retrieval step every turn runs before
answering is part of answering, not a tool, and is not switched off with it (it applies the
same access rules). Plugin tools (see Plugins)
appear here once accepted, disabled until you enable them; when their Plugin is disabled,
drifted or missing they are blocked whatever their switch says.

## Approvals

`run_injection_test` and every Plugin tool always need an Approval. On a server several
people use, switch `run_injection_test` to administrator approval: a loopback Target is the
server's own machine, so a user could otherwise point the suite at another local service.
Approvals are checked again when a turn resumes (a tool disabled or a Plugin drifted in the
meantime is denied), and an Approval is consumed before its call runs, so a crash can lose a
run but never repeat one. Approvals are bound to the digest of the exact
arguments, expire (15 minutes, or 24 hours when an administrator must approve) and are used
once. When a tool is switched to administrator approval, its pending requests appear on the
Admin page (Approvals); approve or reject them there, and the user continues the conversation.
An administrator cannot approve a call that the requesting user is meant to decide.

## Guards

- **Input (G1).** Secrets are always removed from user messages before storage or any model
  call. Heuristic rules block messages that read as attempts to override Rampart's
  instructions, extract its configuration, adopt an unrestricted persona or misuse tools,
  unless the text is quoted or asked about. On the development set the rules are tuned on
  (`eval/guard_cases.jsonl`, 134 inputs) they block every attack with no false alarms; on the
  Holdout Set written in M7 before the last tuning (`eval/guard_holdout.jsonl`) they block only
  2 of 15 attacks, again with no false alarms. Rules match wording, and new wording slips past.
  The optional model classifier (Settings) asks the grader model as well, one extra call per
  turn that the rules let through: on the Holdout Set it caught 14 of 15 attacks with no false
  alarm, at about $0.00005 a call with the default grader. Measure it on your own Models with
  `rampart eval --suite guard --classifier`. Turning the heuristics off keeps secret
  redaction.
- **Provenance (G2).** Every passage and tool result reaches the model as delimited, labelled
  data. Passages and tool output that contain instructions aimed at AI assistants are flagged,
  including passages the grader reads and then drops.
- **Gateway (G3).** Described above; it is the enforcement point, the other Guards are defence
  in depth.
- **Output (G4).** Secrets are removed from answers while they stream and from tool output
  before the model or anyone sees it.

## Audit

The Admin page (Audit) lists every Gateway decision (tool, user, decision, reason, argument
digest, redacted arguments, duration) and every Guard event. Audit records outlive deleted
conversations and accounts.

## Settings

On the Admin page (Settings):

- **Persona**: the first part of every system prompt (50 to 8000 characters; restore the
  default at any time). The security rules Rampart appends (untrusted data, tool rules,
  citations) are not part of the persona and cannot be edited.
- **Conversation token budget**: the total tokens one conversation may use (default 200,000).
  A conversation over budget gets a notice instead of a model call.
- **Input guard** and **input classifier**: the switches described under Guards.

## Plugins

A Plugin is an MCP server whose tools Rampart may offer to the model. Rampart talks to it with
the official MCP Python SDK over stdio: for each listing and each call it starts the server's
process, uses it and stops it.

**The catalog file is the only place Plugins are defined.** `plugins/catalog.yaml` (or the file
`RAMPART_PLUGINS_CATALOG` points to) lists each server's id, title, description, command and
arguments. Nothing in the UI, the API or a conversation can add a Plugin or change a command.
Rampart re-reads the file when it changes. `{python}` in a command means the interpreter running
Rampart and `{plugins_dir}` the `plugins/` folder. Two fixture servers ship with Rampart:
`secret_scanner` (finds credential-like strings in text and reports them masked) and
`fixture_docs` (read-only access to a few synthetic notes, one of which carries a planted
instruction to show how Plugin output is treated).

**What a Plugin process gets.** Only a minimal environment (PATH, HOME, USER and a few more):
none of Rampart's keys. It runs in its own folder, `data/plugins/<id>/`, with its stderr in
`stderr.log` there. Rampart offers it nothing back: no sampling (it cannot use Rampart's models),
no elicitation (it cannot ask the user anything), no roots. It is still a program running with
Rampart's operating-system user, so only list servers you would run yourself.

**Enabling and accepting** (Admin page, Plugins):

1. Enable the Plugin. Rampart starts the server and lists its tools; the status becomes
   *needs review*. Nothing is offered to the model yet.
2. Open it and review every tool: name, description, input schema. Warnings point out
   tool poisoning (instruction-like text anywhere the model reads, or a description that tells
   the model when to use tools: call it first, for every question, instead of other tools, or
   keep something from the user), a name that matches a built-in tool, a schema that explicitly
   accepts undeclared properties, and definitions Rampart cannot use. Rampart closes every input
   schema anyway: the model can only send declared properties. An honest server usually has no
   warnings, so read every one you see.
3. Accept. Acceptance is tied to the exact definitions you reviewed (their digest); if they
   changed in between, Rampart refuses and shows the new ones.
4. On the Tools tab the Plugin's tools now appear as `<plugin>__<tool>`, contributed by
   `plugin:<plugin>`, **disabled**. Enable the ones you want. Every call needs the requesting
   user's Approval; you can switch a tool to administrator approval as for built-in tools.

A Plugin's tool output reaches the model as untrusted data with Provenance `plugin`: secrets are
redacted, instruction-like text is flagged as a Guard event, and the model is told it is data.

**Drift.** Before every call Rampart lists the server's tools again and compares their digest
with the accepted one; Refresh does the same on demand. If anything the model reads or may send
changed (a name, description, schema or annotation), the Plugin is *drifted*: its tools are
blocked and the Gateway denies them with `plugin_drift` until you review the changes (shown tool
by tool, field by field) and accept again. To see it, accept `fixture_docs`, then point its entry
in the catalog at `{plugins_dir}/fixture_docs_drifted/server.py` (the line is in the file, as a
comment) and refresh. Drift detection sees the definitions a server announces, not its code: a
server can change what a tool does without changing how it describes it, so pin the command to
code you have reviewed.

Disabling a Plugin blocks its tools (`plugin_disabled`); a Plugin removed from the catalog file
shows as *missing* and its tools are blocked (`plugin_missing`). A server that fails to start
shows as *error* with the reason; its accepted tools are not blocked, but each call fails until
it starts again.

## Feedback and Evaluation Cases

The Admin page (Feedback) lists every rating with the question, the answer, the comment (secrets
redacted), the model, the Tools used, the trace id and whether the score reached Langfuse or the
local trace log. Feedback is capture only: no policy, Guard, Slot, prompt or retrieval setting
reads it, and a test compares their digests before and after a thumbs down. It is deleted with
its Conversation.

To act on an answer, make it an Evaluation Case: choose `qa` (write the reference answer it
should have given; the dialog starts from the actual answer, so correct it) or `tool` (choose the
Tools it should have called). The case keeps its own copy of the question and joins the next
evaluation run. Reports name such cases by id only, because their questions came from users.

## Evaluation

`rampart eval --suite qa|tool|guard|all [--limit N]` (or Admin page, Evaluation) runs:

- `guard`: the input Guard's precision, recall and false-positive rate on `eval/guard_cases.jsonl`
  (the development set, 134 inputs) and `eval/guard_holdout.jsonl` (the Holdout Set, 30, never
  used to tune the rules). Free and deterministic; CI runs it on every push. With `--classifier`
  the grader Slot's model classifier also judges every input once (under a cent with the default
  grader), and the report adds the classifier alone and combined with the rules, as the runtime
  applies them when the Settings flag is on.
- `tool`: real turns on the 24 tasks in `eval/tool_cases.jsonl`. DeepEval's tool correctness
  (every expected Tool called; a task that expects none passes only if none was called), plus
  three deterministic checks: the structured arguments of each expected call, the Gateway's
  decision on it, and no call to a Tool the task does not expect. No judge.
- `qa`: real turns on the 30 questions in `eval/qa_cases.jsonl`, scored by DeepEval's
  faithfulness, answer relevancy, contextual precision and contextual recall, with the judge Slot
  as the judge (pass at 0.7). A metric that does not apply (nothing was retrieved) is reported as
  skipped, never guessed.

Before a run Rampart shows an estimate at OpenRouter's listed prices (zero for local Models) and
waits for a yes; the report puts the estimate next to what the Providers reported. With the
default Slots the full `qa` suite is estimated at about $2 and has cost less than half of that in
practice; `--limit` runs the first N cases. The judge is checked with one tiny request before any
turn is paid for. Turns run as a throwaway user on a snapshot of the database and the vector
store, deleted afterwards, so evaluation never adds Conversations, usage or traces to the real
data. On the Admin page the run executes in a separate process (only one at a time); the page
shows its status, metrics with their denominators, cost and the report.

Reports are Markdown and JSON in `docs/reports/eval/` (`RAMPART_EVAL_REPORTS_DIR` moves them).
DeepEval runs with its telemetry off, without reading `.env` files, and never uploads results.
Same-vendor judging (chat and judge both OpenAI) can favour that vendor's style; switch the
judge Slot if your workspace allows another vendor.

## Short-term memory

Each Conversation's model-facing history lives in the LangGraph checkpoint. Past
`RAMPART_HISTORY_SUMMARY_TOKENS` (6000 estimated tokens) the older turns are summarised by the
grader Slot and dropped from that history; the last `RAMPART_HISTORY_KEEP_TURNS` (3) user turns
always stay word for word, and a summary is presented to the model as a note, not instructions.
The messages users see are never changed. If summarising fails, the full history is kept.
