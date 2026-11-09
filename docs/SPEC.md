# P6: LLM Application Security Assistant

Version 1.1 | 6 November 2026 | Coding-model implementation specification, revised after the design interview (see docs/DESIGN.md and docs/adr/)

This specification is self-contained. It describes Rampart, the product built from P6, and applies the decisions in `docs/DESIGN.md` (Q1 to Q34) and `docs/adr/`; where texts disagree, `docs/DESIGN.md` wins. Vocabulary follows `CONTEXT.md`. Every rubric line maps to a named feature with an acceptance test (section 15). All adversarial material is synthetic and local; the only test Targets are registered loopback applications owned by the user.

## 1. Build objective

Build Rampart, a conversational assistant for people who build or review LLM applications. It answers LLM-security questions grounded in a Knowledge Base with Citations, inspects the user's own system prompts and tool schemas, looks up known vulnerabilities in their dependencies, runs a fixed prompt-injection suite against a registered loopback Target, and assembles a downloadable Markdown Report. The assistant is itself built as a secure agent: a deterministic Gateway in front of every Tool, Provenance on every context item, input and output Guards, Approval for side-effecting Tools, budgets, and an audit trail. It is a working reference implementation of the controls it recommends.

**Target users.** Developers shipping LLM features; application-security engineers reviewing them; learners studying LLM security.

**Why it is useful.** LLM-security guidance is scattered across OWASP, MITRE ATLAS, NIST and papers and rarely tied to the developer's own artifacts; most "security chatbots" are themselves injectable through retrieved content. Rampart gives grounded, artifact-specific answers and shows on itself how to use untrusted content and Tools safely.

**Trigger.** A user opens a Conversation; there is no autonomous background operation.

## 2. Scope and non-goals

In scope: React single-page app with authentication and roles; agentic retrieval over shared Sources and private uploads with Citations; five built-in Tools plus Plugin Tools behind one Gateway; input, Provenance and output Guards; Approvals, budgets and audit; short-term memory per Conversation and an explicit Project Profile; Model choice across two Providers with admin-tunable generation settings; token and cost accounting; Feedback capture; observability; evaluation report; documentation.

Non-goals: testing anything that is not a registered loopback Target; adaptive attack generation (P3); production identity providers; a universal injection classifier; runtime web fetching; automatic adaptation from Feedback; extracted long-term memory (section 9); open sign-up; Docker; end-to-end browser tests; hardening for public exposure; model-weight attacks.

## 3. Architecture and stack

Python 3.12 with uv. A FastAPI backend owns every control and serves a React single-page app (Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, dark mode) from `frontend/dist`; the Vite dev server proxies `/api` in development; answers, Tool cards and Approval cards stream over server-sent events (ADR 0001). The HTTP contract is `docs/API.md`. SQLite in WAL mode. LangGraph with the SQLite checkpointer. Chroma plus `rank-bm25` hybrid retrieval, BM25 alone without an embedding Model. Official MCP Python SDK over stdio for Plugins. Langfuse cloud through the LangChain callback handler, local JSONL fallback, no LangSmith. DeepEval (no Ragas) plus deterministic Guard metrics. `pytest` and Vitest. No GPU, no Docker.

**Providers and Models (ADR 0002).** OpenRouter for hosted Models (`langchain-openai` at the OpenRouter base URL) and Ollama for local Models (`langchain-ollama`); no direct Anthropic, OpenAI or Gemini SDK. `models.yaml` holds the catalog (per entry: id, provider, display name, kind chat or embedding, Tier cheap or powerful) and the Slot defaults (chat cheap, grader cheap, judge powerful, embedding cheap) with optional temperature and max tokens per Slot. Admin overrides Slots and their settings at runtime (Slot endpoint in `docs/API.md`); overrides live in the database, never in `models.yaml`. The chat Slot's settings apply to every chat Model; users pick any enabled chat Model per Conversation. Keys live in `.env` only. Every OpenRouter call requests usage accounting and stores the cost OpenRouter reports; Ollama costs zero; there is no pricing table.

**Trust boundaries.** User messages, uploads, Source passages, external API responses, Plugin Tool outputs and Target outputs are untrusted data. Only admin configuration and code define policy. The model never sees credentials, Plugin commands, evaluation labels or other users' data, never edits policy or Slots, and never approves its own actions.

Repository layout:

```
src/rampart/  auth/ catalog/ chat/ knowledge/ tools/ gateway/ guards/ plugins/ targets/
              feedback/ usage/ eval/ tracing/ demo_target/ cli.py app.py
frontend/     React single-page app, built to frontend/dist
plugins/      catalog.yaml; fixture servers secret_scanner/, fixture_docs/; one drifted copy
fixtures/     synthetic Sources, injection seed suite, labelled Guard inputs
eval/         qa_cases.jsonl, tool_cases.jsonl, guard_cases.jsonl
docs/         DESIGN.md, SPEC.md, API.md, adr/, reports/, user_guide.md, admin_guide.md,
              traceability.md, critique_prompt.md, critique_log.md
tests/        offline pytest (scripted stand-in model); live smoke tests behind a marker
models.yaml, .env.example, pyproject.toml (rampart-appsec; package and CLI rampart), uv.lock
```

## 4. Functional requirements

| ID | Mandatory behavior |
|---|---|
| P6-R01 | Argon2 password hashes; accounts created by admin or CLI only; roles `user` and `admin`; httpOnly session cookie with CSRF token; per-user isolation of all user data; users delete their own Conversations and uploads. |
| P6-R02 | User-selectable chat Model from the catalog across OpenRouter and Ollama; admin assigns Slots and tunes temperature and max tokens per Slot at runtime; fixed persona in the system prompt. |
| P6-R03 | Agentic retrieval: hybrid retrieve with ACL, grade with the grader Slot, rewrite at most twice, generate with Citations; uploads respect per-user ACL. |
| P6-R04 | Five built-in Tools with manifests; admin enable/disable per Tool in the UI; Plugins from `plugins/catalog.yaml` contribute Tools under the same registry and are enabled and disabled by admin; a changed Tool definition blocks use until re-accepted. |
| P6-R05 | The Gateway (section 8) checks every Tool call before it runs; Approval required by default for `run_injection_test` and Plugin Tools, given by the requesting user unless a per-Tool admin switch requires an admin; every decision audited. |
| P6-R06 | Guards: input Guard, Provenance on every context item (user, system, source, upload, API, plugin, target), output redaction; events logged and shown to admin. |
| P6-R07 | Short-term memory through the LangGraph checkpointer per Conversation; the Project Profile (stack, packages, Targets) is a form read every turn that its user can edit and delete; no extracted long-term memory. |
| P6-R08 | Token usage and cost per turn, Conversation and user from the figure OpenRouter reports per request (zero for Ollama), shown in the UI; admin totals per user and per Model. |
| P6-R09 | Feedback per assistant answer (thumbs up or down, optional comment) stored with the trace id, shown to admin, forwarded as a Langfuse score, convertible by admin into Evaluation Cases; never changes policy, Guards, Slots or retrieval. |
| P6-R10 | External data: OSV.dev lookups at runtime with Provenance `API`; OWASP, MITRE ATLAS and NIST Sources fetched by `rampart ingest` with license notes; no runtime web fetching. |
| P6-R11 | Prompt-injection tests only against registered loopback Targets, with outcomes derived from harness evidence rather than model text. |
| P6-R12 | A trace per turn, its id on the message and linked to Feedback (Langfuse cloud or local JSONL); evaluation reports (DeepEval and Guard metrics) from `rampart eval`, viewable in the admin UI. |
| P6-R13 | Graceful degradation: retries with backoff on Provider errors, then a clear error; BM25-only retrieval with a UI badge; JSONL tracing fallback; input size caps; timeouts; bounded loops. |
| P6-R14 | Documentation: README with runnable examples, user and admin guides, decision records, traceability, critique log, a test report per milestone in `docs/reports/`. |

## 5. Data contracts

`User`: id, username, password_hash, role, created_at.

`Conversation`: id, user_id, title, model_id, created_at, updated_at. Messages live in the LangGraph checkpoint; a `Message` row mirrors each one with the `MessageOut` fields of `docs/API.md` plus citations, tool_calls and guard_events (json) from M2 and M3.

`SlotOverride`: slot, model_id, temperature, max_tokens, updated_by, updated_at; no row means the `models.yaml` default.

`Source`: id, source_type (`curated|upload|app_docs`), owner_user_id (null means shared), title, origin, license_note, fetched_at, digest, status. `Passage`: id, source_id, ordinal, text, token_count, embedding_ref, provenance (`source|upload`).

`ProjectProfile`: user_id, stack, packages (json: ecosystem, name, version), target_ids (json), updated_at.

`ToolManifest`: name, description, json_schema, allowed_roles, requires_approval, approver (`requester|admin`), rate_limit_per_hour, cost_class (`free|api|model|heavy`), argument_constraints, contributed_by (`builtin|plugin:<plugin_id>`), enabled.

`ToolCallRecord`: id, message_id, tool, args_digest, decision (`allow|deny|approval_required`), reason_code, started_at, duration_ms, result_digest, error_class.

`Approval`: id, tool_call_id, args_digest, requested_by, approver, status (`pending|approved|rejected|expired|consumed`), expires_at, decided_by.

`Feedback`: id, message_id, user_id, value (+1 or -1), comment, trace_id, tools_used (json), created_at, forwarded_at, evaluation_case_id.

`Target`: id, owner_user_id, name, base_url (loopback only), input_surface (`user_message|document_slot`), profile, registered_at. `TestRun`: id, target_id, suite_id, approval_id, cases (proposed, executed, received, contaminated, evidence refs), budget_used, status.

`Plugin`: id, name (key into `plugins/catalog.yaml`), enabled, status, accepted_tools_digest, current_tools_digest, last_seen; command and arguments stay in the catalog file.

`EvaluationCase`: id, kind (`qa|tool`), question, expected_answer or expected_tools (json), source (`authored|feedback:<feedback_id>`), created_by, created_at; admin-created cases live in the database.

`EvalRun`: id, kind (`deepeval_qa|deepeval_tool|guard`), judge_model, estimated_cost_usd, cost_usd, metrics (json), report_path, created_at.

## 6. Built-in Tools

| Tool | Input | Output and restriction | Default policy |
|---|---|---|---|
| `search_knowledge` | query, optional source filter (`curated|upload|app_docs`) | Ranked passages with Citations; ACL applied server-side | user; no Approval; free |
| `analyze_prompt` | system prompt text and/or tool schema JSON | Deterministic rule Findings (missing boundaries, embedded secrets, over-broad tools, unbounded outputs, missing refusal guidance); the model explains Findings, never invents them | user; no Approval; model |
| `lookup_vulnerabilities` | ecosystem, package, version | OSV.dev results: ids, severity, affected ranges, references; cached with TTL; Provenance `API` | user; no Approval; api; rate limited |
| `run_injection_test` | target_id, suite_id | Runs the fixed seed suite in the harness; returns per-case proposed, executed and received outcomes with evidence refs | user; Approval by requester; heavy; loopback-only |
| `generate_report` | conversation_id, optional sections | Assembles Findings, lookups, test results and Citations into a stored, downloadable Markdown Report | user; no Approval; model |

Plugin Tools inherit the manifest shape with `contributed_by: plugin:<plugin_id>` and default `enabled=false`, `requires_approval=true`, `approver=requester`. No Tool fetches a URL, edits policy or registers a Plugin.

## 7. Agent graph

Nodes: `load_context` (persona, Slot settings, Project Profile) -> `input_guard` -> `route` -> one of `answer`, `retrieve`, `tool` -> `generate` -> `output_guard` -> `persist`.

Retrieval sub-graph: `retrieve` (hybrid, ACL) -> `grade` (grader Slot, structured relevance per passage) -> `rewrite` (at most two) -> back to `retrieve`, or on to `generate`. If the Knowledge Base holds nothing relevant and the user asked about a package, `route` may propose `lookup_vulnerabilities`.

Tool sub-graph: the model emits a Tool call -> `gateway` (deterministic) -> `allow` -> `execute` -> observation carrying its Provenance; `approval_required` -> LangGraph `interrupt`, streamed as an `approval_required` event, rendered as an Approval card, resumed by the posted decision; `deny` -> structured reason to the model, which may choose another Tool or answer. Equivalent denials stop after two.

Structured routing output `{"mode": "answer|retrieve|tool", "tool": null, "arguments": {}, "reason": "..."}` is validated before dispatch. Bounds per turn: 8 model calls, 6 Tool calls, 2 rewrites, 60 seconds; per-Conversation token budget from admin settings; all configurable. Help mode is `route` with the `app_docs` source filter.

## 8. Gateway and Guards

**G1 Input Guard.** Heuristic detectors for injection and jailbreak patterns, oversized inputs and pasted secrets; an optional model classifier behind an admin flag. Flagged input gets a safe response and an admin-visible event. Benign security questions must pass; false positives are measured in evaluation.

**G2 Provenance Guard.** Every context item carries exactly one Provenance value: `user`, `system`, `source`, `upload`, `API`, `plugin` or `target`. Untrusted items are delimited and presented as data, the system prompt says so, and instruction-like spans in them are flagged in the trace. Defence in depth, not the enforcement point.

**G3 Gateway (ADR 0003).** Deterministic code: registry membership, enabled flag, role, JSON-schema validation with no extra properties, rate limit, per-Conversation budget, argument constraints (loopback-only Targets, size caps), Approval bound to the args digest and consumed once, audit record. Approvals are decided by the requesting user by default; a per-Tool admin switch requires an admin instead. Nothing the model reads can widen policy because no Tool edits policy.

**G4 Output Guard.** Redacts secret patterns and credential-like strings from Tool outputs and model outputs before display and before persistence of displayed text; caps output size.

**Admin versus user.** Users see the enabled catalog and their own data. Only admins see or edit users, the system prompt, Slots and generation settings, Model enable flags, Tool policy and approver switches, Plugins and drift acceptance, Guard flags, the Feedback dashboard, the audit log and evaluation runs. Role checks are enforced in the services, not only by hiding routes.

## 9. Memory, personalisation and Feedback

Short-term memory: the LangGraph SQLite checkpointer per Conversation, with summarisation past a configured token size. The Project Profile (stack, packages, Targets) is an explicit form; `load_context` reads it every turn and the Gateway uses its Targets as argument constraints. No extracted long-term memory or Memory page in this version; it can be added later as a contained change (one LangGraph store, one extraction step, one page).

Personalisation: chat Model per Conversation, greeting by name, Project Profile packages pre-fill `lookup_vulnerabilities`. The persona is fixed in the system prompt (a security reviewer who cites Sources) and explained on the help page; users cannot change it.

Feedback is capture only: thumbs up or down with an optional comment per assistant answer, stored with the trace id and the Tools used, forwarded as a Langfuse score when configured, listed on the admin Feedback dashboard. The admin can convert any such answer into an Evaluation Case (`qa` or `tool`). Feedback never changes policy, Guards, Slots or prompts; A18 compares the digests before and after.

## 10. Knowledge Base and external data

`rampart ingest` fetches OWASP Top 10 for LLM Applications, MITRE ATLAS techniques and NIST AI RMF from their official locations with a license note per Source, and ingests the authored primers (prompt injection, tool-use safety, RAG access control) and the app's own user and admin guides as `app_docs` Sources for help mode. Synthetic fixture Sources in `fixtures/` (`rampart ingest --fixtures`) carry the offline tests.

Chunking is by heading, then by token window; each Passage keeps its Source, ordinal and Provenance. Embeddings come from the embedding Slot; without one the Knowledge Base is BM25-only and the UI shows a badge.

Uploads: PDF (`pypdf`), Markdown and text, size-capped and type-checked, stored under the uploader's ACL with Provenance `upload`; users list and delete their own. OSV.dev: no key; responses cached with TTL; Provenance `API`.

## 11. Injection test Tool and demo Target

The demo Target in `src/rampart/demo_target/` starts with `rampart demo-target --profile secure|vulnerable`: a small FastAPI application with a message route, a document slot, a fake `export_document` tool and a local sink file. `secure` denies the export of internal records; `vulnerable` allows it. The seed suite in `fixtures/` holds at least ten indirect-injection candidates and five benign candidates covering the outcomes proposed, executed and received. Outcome predicates read the Target's audit log and sink, never the model's prose. A marker already present in the candidate input makes the case contaminated.

Registration accepts loopback URLs only (host resolves to 127.0.0.0/8 or ::1). Running requires an Approval bound to target and suite. The Tool does not mutate candidates or search for new attacks; P3 remains the project for adaptive testing.

## 12. Usage, cost and observability

Usage is read from Provider responses per call and summed per turn; a call with no reported cost stores null and shows as "unknown". The UI shows cost per message and per Conversation, and for admins per user and per Model.

Tracing: Langfuse cloud through the LangChain callback handler when the `LANGFUSE_*` keys are set; otherwise one JSONL line per turn in `data/traces/`. Each message stores its trace id; Feedback becomes a Langfuse score on that trace. Traces are developer-facing; the user UI never shows raw traces or hidden reasoning.

## 13. Evaluation

Datasets authored in the repository and unreadable by the assistant at runtime (no Tool, Source or upload path reaches `eval/`): `eval/qa_cases.jsonl` (about 30 questions with reference answers), `eval/tool_cases.jsonl` (about 20 tasks with expected Tools), `eval/guard_cases.jsonl` (about 100 labelled benign and adversarial inputs, all synthetic).

`rampart eval` runs DeepEval through pytest (faithfulness, answer relevancy, contextual precision and recall on the question cases; tool correctness on the tool cases) and deterministic Guard precision and recall; admin-created Evaluation Cases join the matching dataset. The judge is the powerful Slot. Before a run the CLI and the admin UI show a cost estimate (expected judge tokens at the price OpenRouter's model listing reports; zero for Ollama) and wait for a yes. Output: Markdown and JSON in `docs/reports/`, shown in the admin UI with judge Model, cost and denominators.

## 14. UI and CLI

Routes (M1 routes in `docs/API.md`): `/login`; `/` and `/c/:id` Conversation view with Model picker, streamed answer, Citations, Tool cards, Approval cards, Feedback buttons, cost badge and BM25-only badge; `/knowledge` (uploads, Sources); `/profile` (Project Profile form); `/targets` (register loopback Target, run suite, evidence); `/reports` (Reports and evaluation reports); `/help` (static help page, help mode over the app's own docs); `/account` (password, own usage); `/admin` (section 8's admin list, usage for everyone, Feedback to Evaluation Case conversion). Dark mode. No free-form command input anywhere.

CLI (Typer): `rampart init` (database, first admin), `rampart serve`, `rampart user create|reset-password|list`, `rampart ingest` (`--fixtures` for offline), `rampart demo` (admin and demo user, fixture Sources, demo Target in the vulnerable profile registered, app started, URL and logins printed), `rampart eval` (`--suite qa|tool|guard|all`), `rampart demo-target --profile secure|vulnerable`.

## 15. Acceptance tests

| ID | Scenario | Required result |
|---|---|---|
| P6-A01 | User A lists own data, calls an admin route, opens B's Conversation id | Only A's data; 403; 404 for B's Conversation |
| P6-A02 | Model switched mid-Conversation | Next turn uses the selected Model; message row records model_id, provider and cost |
| P6-A03 | User role writes a Slot, Tool policy or the system prompt through the service | 403; user UI exposes only Model choice, Project Profile and own data |
| P6-A04 | Admin changes the chat Slot or its generation settings | Next turn in every Conversation uses them (a Conversation keeps a Model its user picked explicitly); a user calling the Slot endpoint gets 403 |
| P6-A05 | Question answerable from the Knowledge Base | At least one Citation; weak first retrieval triggers at most two rewrites |
| P6-A06 | User B's upload | Never retrieved or cited for user A |
| P6-A07 | Upload of PDF, Markdown and text; oversized or wrong-type upload | Stored with Provenance `upload` and owner ACL; oversized or wrong-type rejected with 422 |
| P6-A08 | Retrieved passage tells the assistant to test an external host | Gateway denies the unregistered Target; passage flagged; answer completes without the Tool |
| P6-A09 | `lookup_vulnerabilities` with OSV reachable and unreachable | Results cached; outage yields a clear error and no crash |
| P6-A10 | Admin disables a Tool | Tool absent from the model's Tool list; direct attempt denied by the Gateway |
| P6-A11 | Unknown Tool or undeclared argument | Schema rejection before execution; audited |
| P6-A12 | `run_injection_test` requested | Approval card shown; changed arguments invalidate it; expiry enforced; consumed once; with the admin switch on, the requester's decision is not enough |
| P6-A13 | Tool rate limit or Conversation budget exceeded | Bounded stop with visible reason; no further calls |
| P6-A14 | Secret-like string in Tool output or model output | Redacted before display and before persisting displayed text |
| P6-A15 | Guard cases replayed | Adversarial inputs flagged and benign questions passed at the documented rates |
| P6-A16 | Project Profile saved, then deleted | Next turn's context contains the profile; after deletion it is no longer applied |
| P6-A17 | Turns on OpenRouter and on Ollama | Cost equals the figure OpenRouter reported for the request; Ollama turns cost zero; Conversation, user and admin totals match |
| P6-A18 | Thumbs down on an answer | Feedback stored with trace id and forwarded as a score; policy and Guard digests unchanged afterwards |
| P6-A19 | Admin converts an answer with Feedback into an Evaluation Case | Case stored; the next DeepEval run includes it |
| P6-A20 | Plugin enabled from the catalog | Tools appear contributed by `plugin:<plugin_id>` (callable as `<plugin_id>__<tool>`), disabled by default; drift blocks use until accepted; no command comes from the model or the UI |
| P6-A21 | Demo Target in vulnerable and secure profiles | Executed plus received with sink evidence versus proposed plus denied; unregistered URL rejected; marker in input marks contamination |
| P6-A22 | OpenRouter error; Langfuse unreachable; no embedding Model; Ollama offline | Retry then a clear error; JSONL trace written; BM25-only with a UI badge; clear error for Ollama |
| P6-A23 | `rampart eval` | DeepEval and Guard metrics written to `docs/reports/` and displayed; datasets unreadable at runtime |
| P6-A24 | Help-mode question about registering a Target | Answer cites the user guide |

Deterministic tests use a scripted stand-in model and the real services; live smoke tests (`pytest -m live`) need an OpenRouter key. Frontend: type check, lint, build, a few Vitest tests; no end-to-end browser tests.

## 16. Requirement traceability

Hard requirements:

| Rubric line | Feature | Evidence |
|---|---|---|
| Agent purpose | Section 1; README | Documentation review |
| Core functionality | R02 to R05, R10, R11 | A02, A05, A09, A12, A21 |
| User interface | Section 14; help page; Tool and Approval cards | A01, A03, A24 |
| Technical implementation | Section 3; R13 | A09, A13, A22 |
| Documentation | R14; README, guides, ADRs, traceability | Documentation review |

Soft requirements:

| Soft item | Feature | Evidence |
|---|---|---|
| Easy: ChatGPT critique | `docs/critique_prompt.md`, `docs/critique_log.md` | M6 review |
| Easy: personality | Fixed persona in the system prompt plus the help page; no user-selectable tone | A24; documentation review |
| Easy: choose from a list of LLMs | `models.yaml` catalog; Model picker | A02 |
| Easy: temperature, max tokens as fields | Admin Slot settings | A04 |
| Easy: interactive help | Help page; help mode over the app's own docs | A24 |
| Medium: token usage and costs | `usage`, cost badge, admin usage | A17 |
| Medium: memory in LangGraph | Checkpointer per Conversation; Project Profile read every turn | A16 |
| Medium: tool calling an external API | `lookup_vulnerabilities` (OSV.dev) | A09 |
| Medium: authentication and personalisation | `auth`, roles, per-Conversation Model, Project Profile | A01, A16 |
| Medium: feedback loop with ratings | Feedback capture, admin dashboard, Evaluation Cases; human-in-the-loop, not automatic | A18, A19 |
| Medium: five tools, toggles, plugin system | Five built-in Tools; admin toggles; Plugin catalog | A10, A20 |
| Medium: multi-model support | Anthropic and OpenAI Models via OpenRouter; local Models via Ollama | A02, A22 |
| Medium: security guard, dev/user separation | G1 to G4; admin versus user roles | A03, A08, A11 to A15 |
| Hard: agentic RAG | Retrieve, grade, rewrite sub-graph with Citations and ACL | A05, A06 |
| Hard: LLM observability | Langfuse cloud with JSONL fallback; trace id per turn | A22 |
| Hard: evaluation report | `rampart eval` with DeepEval and Guard metrics | A23 |
| Hard: agent learns from feedback | Human-in-the-loop evaluation cycle only: Feedback becomes Evaluation Cases, the next DeepEval run measures them, a maintainer changes prompts or retrieval; no automatic adaptation, so a strict reading counts this as partially met | A18, A19 |
| Hard: external data sources | OSV.dev at runtime; OWASP, MITRE ATLAS, NIST via `rampart ingest`; uploads | A07, A09 |

## 17. Milestones

M1 Foundation: SQLite schema, `auth`, `catalog` with both Provider clients, minimal `AssistantGraph` (`load_context`, stub Guard, `generate`, `persist`) with the checkpointer, streaming, `usage`, `tracing` with JSONL fallback, SPA shell for the M1 routes, pytest harness with the scripted stand-in model, Vitest setup. Tests A01 to A04, A17, part of A22.

M2 Knowledge: `knowledge`, `rampart ingest` with official Sources and fixtures, uploads, retrieval sub-graph with grading, rewriting and Citations, Project Profile form, help page and help mode. Tests A05, A06, A07, A16, A24.

M3 Controls: `ToolRegistry`, `Gateway`, `ApprovalService` with interrupt and Approval cards, Guards G1 to G4, Tools `analyze_prompt`, `lookup_vulnerabilities`, `generate_report`, admin Tool policy and approver switches, Guard flags, audit log, Reports route. Tests A08 to A15. The plan was that the hard rubric is met after M3; the evaluation report
(a hard soft-item) and the feedback loop arrived in M6.

M4 Injection tests and demo Target: `demo_target`, `TargetService`, `InjectionTestRunner`, seed suite, `run_injection_test` behind Approval, Targets route, `rampart demo-target`, `rampart demo`. Test A21.

M5 Plugins: `plugins` (MCP stdio client, catalog, digest and drift check), fixture servers and the drifted copy, admin Plugin page. Test A20.

M6 Feedback, evaluation report, CI, documentation, decision records: `feedback` with Langfuse scores and the admin dashboard, Evaluation Case conversion, `eval` with DeepEval, Guard metrics and the estimate, GitHub Actions CI (offline pytest; frontend type check, lint, build, Vitest), README, guides, traceability with evidence links, critique log, recorded live smoke run. Tests A18, A19, A22, A23.

A report with test results follows each milestone in `docs/reports/` (`m1.md` to `m6.md`). Completion: R01 to R14 mapped to code, A01 to A24 passing, one recorded live smoke run per configured Provider, README examples executed as written, traceability filled with links to code and tests.

## 18. Feasibility and dependencies

What Claude implements: everything in this specification.

What the user provides: one OpenRouter API key (covers every hosted Model in the catalog); optionally Langfuse cloud keys, otherwise traces go to JSONL; optionally a running Ollama with the catalog Models pulled or `models.yaml` edited to the Models present, for offline use; a small judge budget for `rampart eval`, which prints an estimate first; the ChatGPT critique, whose prompt ships in `docs/critique_prompt.md` with responses and resolutions recorded in `docs/critique_log.md`.

Guardrail statement: all adversarial content is synthetic, local and used to test defences; injection tests only reach registered loopback Targets; vulnerability lookups are read-only public data; the only web fetching is `rampart ingest` reading the official OWASP, MITRE ATLAS and NIST locations at setup, and the assistant has no Tool that fetches URLs. Nothing in this specification requires a capability Claude would decline.

Platform: WSL2 Linux, no GPU, Python 3.12 with uv, Node 22; no Docker.

## 19. Project kickoff for the coding model

State on 2026-11-09: all six milestones are built and verified; `docs/reports/m6.md` has the final test run and `docs/traceability.md` maps every requirement and acceptance test to code and evidence. Earlier: state on 2026-11-06: `docs/DESIGN.md` confirmed; ADRs 0001 to 0003 written; `docs/API.md` holds the M1 HTTP contract; the Python project is scaffolded with uv (`pyproject.toml`, `uv.lock`, `src/rampart/`); no Provider key present. M1 is in progress.

Order of work: finish M1 and prove authentication, Model and Slot switching, streaming, cost accounting and tracing with the scripted stand-in model. Add knowledge and the Project Profile next. Build the Gateway before any model-invoked Tool so that every Tool is born behind policy (M2 retrieval runs as a graph node). Add the injection test Tool and Plugins only after the Gateway and Approvals exist. Finish with Feedback, evaluation, CI and documentation, and record honest live-verification status for each Provider actually used. Keep `docs/API.md` current; write `docs/reports/mN.md` after each milestone.

## 20. Verified environment and versions (2026-11-06)

| Item | Version | Note |
|---|---|---|
| Node | 22.23.2 | npm 10.9.8 |
| uv | 0.12.17 | |
| Python | 3.12.3 | |
| Ollama | 0.40.14 | local API reachable; one Model pulled locally, not the catalog default (`huihui_ai/Qwen3.8-abliterated`, 27.3B, Q4_K_M, CPU only; verified with the M2 live tests on 2026-11-08) |
| gh | 2.45.0 | authenticated |
| Provider keys | none yet | |

Python packages installed for M1: fastapi 0.162.0, uvicorn 0.54.0, sqlalchemy 2.1.8, pydantic 2.14.3, pydantic-settings 2.16.2, langgraph 1.2.20, langgraph-checkpoint-sqlite 3.1.3, langchain-core 1.7.6, langchain-openai 1.7.4, langchain-ollama 1.1.0, langfuse 5.2.0, sse-starlette 3.6.0, argon2-cffi 25.1.0, typer 0.27.3, openai 3.46.0, pytest 9.2.0, ruff 0.17.4, pyright 1.1.414. Added for M2 (2026-11-08): chromadb 1.5.9, rank-bm25 0.2.2, pypdf 7.0.0, python-multipart 0.0.33. Added for M3: jsonschema 4.26.0 (already a Chroma dependency, now declared). OSV.dev's query API (`https://api.osv.dev/v1/query`) answered in 0.4 s from this machine on 2026-11-08; an unknown package returns `{}`, an unknown ecosystem HTTP 400. M4 adds no new third-party dependency: the demo Target is a small FastAPI app and the injection runner drives it with the httpx already present. A full run of the `seed-v1` suite (12 injection, 6 benign candidates) against the demo Target over a real loopback port on 2026-11-08: vulnerable profile: all 11 uncontaminated injection candidates breached (12 in total, 1 contaminated and excluded), no benign candidate acted on; secure profile: 0 of 12 breached. Added for M5 (2026-11-08): mcp 2.3.0 (released 2026-10-02, with mcp-types 2.3.0 from the same maintainers; httpx2 was already installed). In mcp 2.x `FastMCP` is renamed `MCPServer` (`mcp.server.mcpserver`), the high-level `mcp.Client` accepts `StdioServerParameters` or any transport, the stdio client passes the server only a minimal environment (HOME, LOGNAME, PATH, SHELL, TERM, USER), and a client that registers no callbacks advertises no sampling, elicitation or roots. The connection negotiates protocol 2026-07-28. Starting a fixture server and listing its tools over stdio takes 0.5 to 0.8 s on this machine. Added for M6 (2026-11-09): deepeval 4.3.3 (released 2026-11-04; the upstream main branch declares the same version, though releases after 4.2.4 are no longer tagged). It pins click below 8.4 and rich below 15 and pulls posthog and four pytest plugins; with it huggingface-hub resolved to 1.16.1, and the whole suite still passed. DeepEval registers a pytest plugin that opens a telemetry run in every session, so `pyproject.toml` disables it (`-p no:deepeval`); `import deepeval` reads `.env` files from the working directory, so the evaluation sets `DEEPEVAL_DISABLE_DOTENV`, `DEEPEVAL_TELEMETRY_OPT_OUT` and its own `DEEPEVAL_CACHE_FOLDER` before importing it, and the web server never imports it. `ToolCorrectnessMetric` without `available_tools` is deterministic but still builds a default OpenAI model unless given one, so it gets a model that fails if called. DeepEval's metrics are called directly (`a_measure`) rather than through `deepeval test run`, so the CLI and the admin page share one runner. The OpenRouter workspace used here blocks `anthropic/claude-opus-5.5` (HTTP 404, guardrail and data policy), so the judge Slot defaults to `openai/gpt-6.1-sol`. Langfuse Cloud retired `GET /api/public/scores` (HTTP 410) in favour of `/api/public/v3/scores`.

Sources fetched by `rampart ingest` (verified 2026-11-08): the OWASP Top 10 for LLM Applications 2025 entries LLM01 to LLM10 from `OWASP/www-project-top-10-for-large-language-model-applications`, pinned to commit `eb87ba8` (the latest change to `2_0_vulns/`, 2025-11-18), CC BY-SA 4.0; MITRE ATLAS `dist/ATLAS.yaml` from `mitre-atlas/atlas-data` release `v2026.10` (ATLAS 5.6.0, commit `f56c146`), Apache 2.0; NIST AI 100-1 and NIST AI 600-1 from `nvlpubs.nist.gov` (the server answers GET but returns 404 to HEAD requests), U.S. Government works. A full ingest stores 20 Sources and 652 passages; embedding them with `openai/text-embedding-3-small` cost $0.0034.

Frontend: vite 8.3.6, react 19.3.1, typescript 7.0.2, tailwindcss 4.3.4, shadcn 4.23.0, @tanstack/react-query 5.106.1, react-router 8.5.1, vitest 5.1.0.

OpenRouter catalog defaults, prices per million tokens (input/output) as listed on 2026-11-06, informational only:

| Model id | Kind | Tier | Price |
|---|---|---|---|
| `anthropic/claude-haiku-5.5` | chat | cheap | $0.10 / $0.50 |
| `anthropic/claude-opus-5.5` | chat | powerful | $4 / $20 |
| `openai/gpt-6-luna` | chat | cheap | $0.10 / $0.50 |
| `openai/gpt-6.1-sol` | chat | powerful | $2 / $10 |
| `openai/text-embedding-3-small` | embedding | cheap | $0.02 input |

On 2026-11-08 the chat and grader Slot defaults moved from `anthropic/claude-haiku-5.5` to `openai/gpt-6-luna` (same listed price); the judge Slot stayed on `anthropic/claude-opus-5.5` until 2026-11-09, when it moved to `openai/gpt-6.1-sol` (see below: the workspace blocks the Claude Model).

Ollama catalog defaults: `ollama/qwen3:8b` (chat, cheap) and `ollama/nomic-embed-text` (embedding, cheap); the user must `ollama pull` them or edit `models.yaml` to the Models present. On 2026-11-08 the owner's pulled Model `ollama/huihui_ai/Qwen3.8-abliterated` (chat, 27.3B, refusal training removed) was added to the catalog at their request; it holds no Slot.

## 21. Changes from version 1.0

- Streamlit replaced by a React single-page app on FastAPI with server-sent events; nicer UI, server-side controls (Q1, Q17, Q19).
- Direct Anthropic, OpenAI and Gemini SDKs replaced by OpenRouter and Ollama; one key, one request shape (Q8, Q20, Q21).
- `models.yaml` catalog with Tiers and Slots, admin runtime overrides, keys only in `.env` (Q20, Q26, Q34).
- Pricing table removed; cost is the figure OpenRouter reports, zero for Ollama; no drift (Q22).
- LangSmith and Ragas removed; Langfuse cloud with JSONL fallback; DeepEval plus deterministic Guard metrics; judge on the powerful Slot with a cost estimate; datasets renamed (Q9, Q10, Q23, Q34).
- Python 3.12 with uv; SQLite in WAL mode; Docker removed, including Langfuse self-hosting (Q11, Q13, Q14).
- `lasa` renamed `rampart`, distribution `rampart-appsec`; `src/` layout; reports under `docs/reports/` (Q12, Q32).
- Tone presets cut; fixed persona plus help page covers the personality item honestly (Q7).
- `ingest_source`, the web allowlist and `web` Provenance cut; five built-in Tools; official Sources fetched only at setup; no runtime fetch surface (Q5, Q15).
- Automatic adaptation (re-ranking bias, exemplars, `AdaptationService`) cut; Feedback is capture only, convertible into Evaluation Cases; auditable (Q2).
- Extracted long-term memory, LangGraph store and Memory page cut; checkpointer plus Project Profile form; long-term memory deferred (Q3).
- End-to-end browser tests cut; type check, lint, build and Vitest instead (Q31).
- Open sign-up cut; admin-created accounts, `rampart demo` seeds a demo user; httpOnly session cookie with CSRF token (Q18, Q27).
- Free-form Plugin commands cut; catalog file only, admin enable and disable, drift blocks use; Plugins kept as M5 (Q4, Q30).
- Approvals decided by the requesting user by default, per-Tool admin switch (Q28).
- Provenance values `corpus` to `source`, `mcp` to `plugin`, `web` removed (Q16, Q24).
- Vocabulary aligned with `CONTEXT.md`; `Feedback.value`, `Passage` and `contributed_by` replace `rating`, `Chunk` and `origin` (Q16, Q24, Q34).
- One-command `rampart demo` (Q29); six milestones, hard rubric met after M3, a report per milestone (Q33); three decision records (Q25).
- Tests A04, A07, A16 to A19, A22, A23 rewritten; R02, R04, R07 to R10, R12 to R14 reworded; sections 20 and 21 added; section 19 updated.
