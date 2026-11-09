# Rampart

Rampart is a chat assistant for people who build or review applications on large language
models: developers shipping LLM features, application-security engineers reviewing them, and
learners studying LLM security. It answers LLM-security questions with citations from a curated
Knowledge Base, inspects your own system prompts and tool schemas, looks up known vulnerabilities
in your dependencies, runs a fixed prompt-injection test suite against a registered local target,
and assembles a Markdown report. It applies the controls it recommends to itself: every tool call
passes a deterministic gateway, untrusted content is labelled, approvals are bound to exact
arguments, and every turn is traced and priced. It is a local review-support and learning tool,
not a security assessment; see "Scope and limits" below.

**Status: all six milestones built (M6: feedback, evaluation, CI).** Working today: accounts and roles, streaming chat
with a per-conversation model choice, a model catalog with admin-controlled slots and generation
settings, per-request cost from OpenRouter, Langfuse tracing with a local fallback, the React
interface (M1), and a Knowledge Base with the OWASP Top 10 for LLM Applications, MITRE ATLAS and
the NIST AI RMF, private uploads, agentic retrieval (routing, hybrid search, grading, at most two
query rewrites) with Citations, the Project Profile, and a help page with help mode (M2), and
the controls (M3): five Tools behind a deterministic Gateway, Approvals bound to exact
arguments, input and output Guards, an audit log, Reports, and admin Tool policy and settings;
the injection test harness with a registered loopback demo Target (M4); and Plugins (M5): MCP
servers from a catalog file whose tools join the same Gateway, off until an admin reviews and
accepts their definitions, and blocked again when those definitions drift; and (M6) Feedback
on answers with an admin dashboard and Evaluation Cases, `rampart eval` (DeepEval on real turns
plus deterministic Guard metrics, with a cost estimate first), summarised short-term memory, and
CI. `docs/traceability.md` maps every requirement and acceptance test to code and evidence.

## Scope and limits

Rampart supports a review; it does not certify anything. What each part covers, and what it
does not:

- **Prompt analysis** runs fixed rules over a system prompt or tool schemas (missing boundaries,
  embedded secrets, over-broad tools, unbounded output, missing refusal guidance). It does not
  find every weakness, and a clean result is not a guarantee.
- **Vulnerability lookup** queries OSV.dev for the packages and versions you name. It does not
  discover your dependencies or judge whether a vulnerable function is reachable.
- **The injection test** is a regression check of a fixed suite against a Target you run on the
  same machine. The demo Target is deterministic, so passing it demonstrates the harness and
  the two profiles, not a model's resistance to injection in general.
- **Citations** show where a statement came from; they do not prove the advice is right.
- **Guards** are defence in depth. The input Guard is a set of heuristics (96 % recall on the
  inputs written with it, 40 % on held-out ones); the enforcement point is the deterministic
  Gateway. Secret redaction matches credential-shaped strings; it cannot know every secret.
- **Plugins** are trusted local programs: Rampart limits their environment and working folder
  and pins their reviewed definitions, but does not sandbox them.
- **Deployment**: Rampart is built for one machine and a small team behind it. On a shared host,
  "loopback" is the server's own machine, so any user could point a Target at another local
  service; there, switch `run_injection_test` to administrator approval (Admin, Tools).
- **Evaluation** uses small authored datasets (see `eval/README.md`) and an LLM judge that has
  not been calibrated against human ratings; scores describe these cases, nothing broader.

## Requirements

- Python 3.12 and [uv](https://docs.astral.sh/uv/)
- Node 22 and npm (to build the interface)
- An [OpenRouter](https://openrouter.ai/) API key for hosted models, or
  [Ollama](https://ollama.com/) with a pulled model for local ones (or both)
- Optional: a [Langfuse](https://langfuse.com/) project for traces; without keys Rampart writes
  JSONL traces to `data/traces/`

## Quick start

```bash
cp .env.example .env            # put your OPENROUTER_API_KEY in .env
uv sync                         # backend dependencies into .venv
(cd frontend && npm ci && npm run build)
uv run rampart init             # creates data/rampart.sqlite3 and the first admin (prompts)
uv run rampart ingest           # fetches OWASP, MITRE ATLAS, NIST; embeds them (about $0.004)
uv run rampart serve            # http://127.0.0.1:8000
```

Sign in with the admin account, open **Admin** to create user accounts (there is no sign-up
page), then start a conversation. The model picker in the composer lists every enabled chat
model; models whose provider is not configured are marked unavailable.

For a throwaway setup with both accounts created and printed:

```bash
uv run rampart demo             # offline Knowledge Base + a registered demo Target, then serves
```

`rampart demo` uses the synthetic fixtures plus Rampart's primers and guides, so it needs no
network for the Knowledge Base; run `rampart ingest` afterwards to add the official Sources.

Local models: the catalog lists `qwen3:8b` and `huihui_ai/Qwen3.8-abliterated` (27B, a variant
with its refusal training removed); `ollama pull <name>` makes an entry available. If you prefer
another Ollama model, add it to `models.yaml` with an `ollama/` prefix. Rampart
runs local models with a 16k-token context (Ollama's 4k default would cut the system prompt off
long retrieval prompts) and without thinking, which on a CPU is many times slower; set
`RAMPART_OLLAMA_THINKING=true` to let local answers think. Assign the local model to the grader
slot as well, and with no OpenRouter key a turn runs entirely on your machine (keyword search,
no embeddings unless `nomic-embed-text` is pulled and assigned to the embedding slot).

## Everyday commands

| Task | Command |
|---|---|
| Backend with auto-reload | `uv run rampart serve --reload` |
| Load or refresh the Knowledge Base | `uv run rampart ingest` (`--fixtures` offline, `--no-embed` keyword-only) |
| Run a demo Target to test against | `uv run rampart demo-target --profile vulnerable` (or `secure`) |
| Frontend dev server (proxies `/api` to port 8000) | `cd frontend && npm run dev` |
| Backend tests (offline, scripted model) | `uv run pytest` |
| Backend lint, format check, types | `uv run ruff check src tests && uv run ruff format --check src && uv run pyright src` |
| Frontend type check, lint, tests, build | `cd frontend && npm run typecheck && npm run lint && npm test && npm run build` |
| Manage accounts | `uv run rampart user create <name>`, `uv run rampart user reset-password <name>`, `uv run rampart user list` |
| Evaluate (shows the cost and asks first) | `uv run rampart eval --suite guard` (free), `--suite tool`, `--suite qa --limit 3`, `--suite all` |
| Live smoke tests (need keys; cost cents) | `uv run --env-file .env pytest -m live` |

The API is documented in `docs/API.md`; the interactive reference is served at `/api/docs`.

## Configuration

Secrets and provider settings live in `.env` (never committed); see `.env.example`:

| Variable | Meaning |
|---|---|
| `OPENROUTER_API_KEY` | Enables every `openrouter` model in the catalog |
| `OLLAMA_HOST` | Local Ollama address, default `http://127.0.0.1:11434` |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` | Langfuse tracing; leave empty for JSONL traces |
| `RAMPART_DATA_DIR` | Database, checkpoints and traces, default `data/` |
| `RAMPART_MODELS_FILE` | Catalog file, default `models.yaml` |
| `RAMPART_HOST`, `RAMPART_PORT` | Bind address for `rampart serve` |
| `RAMPART_COOKIE_SECURE` | Set `true` behind HTTPS |
| `RAMPART_MAX_UPLOAD_BYTES`, `RAMPART_MAX_UPLOADS_PER_USER` | Upload limits, default 5 MB and 50 per user |
| `RAMPART_RETRIEVAL_K`, `RAMPART_MAX_REWRITES` | Passages per search (6) and query rewrites per turn (2) |
| `RAMPART_OLLAMA_NUM_CTX`, `RAMPART_OLLAMA_THINKING` | Context window of local models (16384) and whether local answers think (`false`) |
| `RAMPART_PLUGINS_CATALOG` | Plugin catalog file, default `plugins/catalog.yaml` |
| `RAMPART_HISTORY_SUMMARY_TOKENS`, `RAMPART_HISTORY_KEEP_TURNS` | When to summarise older turns (6000 estimated tokens) and how many user turns stay word for word (3) |
| `RAMPART_EVAL_REPORTS_DIR` | Where `rampart eval` writes reports, default `docs/reports/eval/` |

`models.yaml` is the model catalog: each entry has an id, provider (`openrouter` or `ollama`),
display name, kind (`chat` or `embedding`) and tier (`cheap` or `powerful`), and the file sets the
default model for each slot (chat, grader, judge, embedding) with optional temperature and
max-tokens settings. Admins can override slots at runtime in the UI; overrides are stored in the
database and can be reset to the file defaults.

## Models and cost

Rampart talks to two providers only: OpenRouter for hosted models and Ollama for local ones.
The cost of every hosted call is the figure OpenRouter reports for that request (usage
accounting), not a price table; Ollama calls cost zero. A turn can make several calls: the
grader slot decides whether to search, grades the retrieved passages and rewrites a weak query,
the embedding slot embeds the query, and the chat model answers. The message shows the total;
each call is recorded under its own model, so the admin usage view per model is exact. Costs
are shown per message, per conversation and per user. With GPT-6 Luna as chat and grader model,
a turn that searches costs about $0.0003 to $0.0009.

## Knowledge Base

`rampart ingest` loads the OWASP Top 10 for LLM Applications 2025 (CC BY-SA 4.0) and MITRE
ATLAS techniques, mitigations and case studies (Apache 2.0), both pinned to a fixed commit, and
the NIST AI RMF publications AI 100-1 and AI 600-1 (U.S. Government works), plus three primers
written for Rampart and its user and admin guides. Each Source records its origin and license,
and citations show them. Passages are found by hybrid search (Chroma embeddings plus BM25) or,
without an embedding model, by BM25 alone with a "keyword search only" badge. Users can upload
PDF, Markdown and text files; uploads are visible only to their owner, in listings, search and
citations. Retrieved text reaches the model as delimited, untrusted data.

## Security controls

Rampart is built as the secure agent it recommends (ADR 0003):

- **Gateway.** Every Tool call passes one deterministic check: registered, enabled, role,
  JSON-schema validation with no undeclared arguments, per-turn and hourly limits, the
  conversation's token budget, argument constraints (injection tests only against the caller's
  registered loopback Targets), and an Approval bound to the argument digest, consumed once.
  Every decision is audited. No Tool can change policy.
- **Approvals.** `run_injection_test` pauses the turn (a LangGraph interrupt) until the
  requesting user, or an admin when switched, approves the exact call.
- **Guards.** Secrets are removed from user messages before any model call and from answers and
  Tool output while they stream; attack-like messages get a fixed reply without a model call
  unless quoted or asked about; passages and Tool output reach the model as delimited,
  Provenance-labelled data, and instructions aimed at AI assistants in them are flagged. Rates
  on the labelled guard sets are in `docs/reports/m3.md`.
- **Tools.** `search_knowledge`, `analyze_prompt` (deterministic rules over a system prompt or
  tool schemas), `lookup_vulnerabilities` (OSV.dev, cached), `generate_report` (a stored Markdown
  Report), `run_injection_test` (runs the fixed suite against a registered loopback Target).
- **Injection tests (M4).** A registered Target must resolve to a loopback address, checked at
  registration and again by the Gateway. The fixed `seed-v1` suite drives the Target and reads
  each outcome (proposed, executed, received) from the Target's own audit log and sink, never
  from its replies; a candidate that already contains the marker is flagged contaminated. The
  demo Target (`rampart demo-target`) ships secure and vulnerable profiles.
- **Plugins (M5).** MCP servers listed in `plugins/catalog.yaml`, reached with the official MCP
  Python SDK over stdio; no command ever comes from the UI or the model. Enabling lists a
  server's tools; an admin reviews them (with warnings for instruction-like text, names that
  match built-ins, open schemas) and accepts that exact set, bound to its digest. Their tools
  then appear as `<plugin>__<tool>`, disabled, and every call needs an Approval. Rampart lists
  the tools again before every call: any change to what the model reads or may send blocks the
  Plugin until accepted again. Plugin processes get no Rampart credentials, and their output is
  untrusted data. Two fixture servers ship (a secret scanner and a read-only docs server), plus a
  drifted copy to demonstrate drift detection.

## Tracing

Every turn is one trace. With Langfuse keys, traces go to Langfuse through the LangChain callback
handler and carry the user id, conversation id and model. One JSON line per turn is appended to
`data/traces/<date>.jsonl` in every case (with Langfuse it is a copy under the same trace id, so a
trace survives when Langfuse cannot be reached). The trace id is stored on the assistant message,
and Feedback on an answer becomes a `user_feedback` score on its trace.

## Feedback and evaluation

Users rate answers (thumbs up or down, optional comment). Feedback is capture only: it is stored
with the trace id and the Tools used, sent to the trace as a score, and listed for admins, who can
turn an answer into an Evaluation Case. Nothing changes Rampart's behaviour automatically; a test
proves the policy and Guard digests are unchanged by Feedback.

`rampart eval` runs three suites on the datasets in `eval/` (never readable at runtime):

| Suite | What it measures | Cost |
|---|---|---|
| `guard` | Precision and recall of the input Guard on 104 labelled inputs, plus 30 held out | free, deterministic |
| `tool` | DeepEval tool correctness: did a real turn call the expected Tools (20 tasks) | cents (Rampart's own calls) |
| `qa` | DeepEval faithfulness, answer relevancy, contextual precision and recall on real turns (30 questions), judged by the judge Slot | about $2 at list prices for all 30 |

It shows an estimate at OpenRouter's listed prices and waits for a yes; turns run on a snapshot
of the database, so evaluation never adds Conversations or usage to the real data. Reports (Markdown
and JSON) go to `docs/reports/eval/` and appear on the admin page, which can start runs too.

## Project layout

```
src/rampart/        backend package and `rampart` CLI
  auth/             accounts, sessions, roles
  catalog/          models.yaml, provider availability, slot overrides
  chat/             LangGraph turn graph (input guard, route, retrieve, grade, rewrite,
                    generate, tools), prompts, turn engine, streaming service, usage ledger
  gateway/          the Gateway, argument constraints, Approvals
  guards/           secret redaction (also while streaming), input heuristics, untrusted-text scan
  tools/            Tool registry and manifests, built-in Tools, OSV.dev client, Reports
  admin/            admin settings (persona, budget, Guard flags) and admin endpoints
  targets/          Target registration (loopback-only), the injection test runner and suites
  demo_target/      a small loopback app with secure and vulnerable profiles, for testing
  plugins/          the Plugin catalog, MCP stdio client, digests and drift, Plugin Tools
  feedback/         Feedback capture, the admin dashboard, conversion into Evaluation Cases
  eval/             `rampart eval`: datasets, Guard metrics, DeepEval judge and scoring, reports
  knowledge/        Sources, chunking, uploads, embeddings, Chroma and BM25 retrieval, ingest,
                    primers/ (written for Rampart)
  profile/          Project Profile
  usage/            token and cost totals
  tracing/          Langfuse and JSONL tracers
frontend/           React single-page app (Vite, TypeScript, Tailwind, shadcn/ui)
fixtures/           synthetic Sources (one deliberately poisoned); injection/ (the seed suite)
plugins/            catalog.yaml and the fixture MCP servers: secret_scanner/, fixture_docs/,
                    fixture_docs_drifted/ (a modified copy, for the drift demo)
eval/               evaluation datasets: qa_cases.jsonl (30), tool_cases.jsonl (20),
                    guard_cases.jsonl (104), guard_holdout.jsonl (30, never tuned against)
docs/               DESIGN.md (decisions), SPEC.md (specification), API.md (contract),
                    user_guide.md and admin_guide.md (also searched by help mode),
                    adr/ (decision records), reports/ (milestone reports)
tests/              offline pytest suite with a scripted stand-in model
models.yaml         model catalog and slot defaults
.github/workflows/  CI: lint, types, offline tests, the Guard report; frontend type check, lint, tests, build
```

## Documentation

- `docs/DESIGN.md`: the design record and decision log behind the build
- `docs/SPEC.md`: the implementation specification (requirements, acceptance tests, milestones)
- `docs/API.md`: the HTTP and server-sent-event contract
- `docs/user_guide.md`, `docs/admin_guide.md`: how to use and run Rampart (help mode answers from these)
- `docs/adr/`: architecture decision records
- `docs/reports/`: a report with test results after each milestone; `docs/reports/eval/`: evaluation reports
- `docs/traceability.md`: every requirement, acceptance test and rubric line, with links to code and evidence
- `docs/critique_prompt.md`, `docs/critique_log.md`: an outside model's critique of the project and what was done about it

## License

MIT, see `LICENSE`. Fetched reference Sources are not stored in the repository; they keep their
own licenses (OWASP: CC BY-SA 4.0; MITRE ATLAS: Apache 2.0; NIST: U.S. Government work), recorded
on each Source and shown with citations.
