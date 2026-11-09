# Rampart: design record

**Historical record (status note, 2026-11-09).** This is the design interview as it stood on
2026-11-05, kept unchanged below. The user confirmed it on 2026-11-06, `docs/SPEC.md` (version
1.1) was revised from it, and all six milestones were built afterwards. For current behaviour
read `docs/SPEC.md`, `docs/API.md` and the guides; where this record and later decisions differ
(recorded in `docs/SPEC.md` section 20 and the milestone reports), the later decisions apply.

**Status (2026-11-05).** Design interview complete: 34 questions asked over four rounds, all answered. The shared understanding below was presented to the user, who had to leave before confirming it. Nothing has been built. `CONTEXT.md` in the repository root holds the glossary (20 terms). The original specification is `../P6_llm_application_security_assistant.md` (version 1.0) and will be revised to version 1.1 once the user confirms.

**Resume steps.**

1. User confirms or corrects the shared understanding below.
2. Write three decision records in `docs/adr/`: 0001 React single-page app split from the FastAPI backend; 0002 OpenRouter plus Ollama as the only Providers instead of direct vendor SDKs; 0003 authorization by deterministic Gateway rather than by asking a model.
3. Revise the P6 specification to version 1.1 with the decisions and cuts listed here.
4. Verify installed versions of Node, uv, Python and Ollama, the exact OpenRouter model identifiers, and current LangGraph, Langfuse, DeepEval and MCP SDK versions. Adjust details, not decisions.
5. Start milestone M1.

## Shared understanding

### What gets built

Rampart is a chat assistant for developers and AppSec engineers who build LLM applications. It answers LLM-security questions with Citations from a Knowledge Base, inspects the user's own system prompts and tool schemas, looks up dependency vulnerabilities on OSV.dev, runs a fixed injection test suite against a registered loopback Target, and assembles a Markdown Report. Five built-in Tools (`search_knowledge`, `analyze_prompt`, `lookup_vulnerabilities`, `run_injection_test`, `generate_report`) plus Plugin Tools, all behind the Gateway.

Cut from the specification: tone presets, the runtime web-ingestion Tool, automatic learning from Feedback, extracted long-term memory, end-to-end browser tests, Docker, open sign-up, free-form Plugin commands. Long-term memory can be added later as a contained change (one store, one extraction step, one page).

### Architecture

- Backend: FastAPI, Python 3.12, uv. SQLite in WAL mode. LangGraph with a SQLite checkpointer for Conversations. Hybrid retrieval: Chroma embeddings plus BM25 keyword search.
- Frontend: React single-page app with Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, dark mode. FastAPI serves the production build; Vite proxies API calls in development. Answers stream over server-sent events, including Tool cards and Approval cards.
- Auth: admin-created accounts (no open sign-up), roles `user` and `admin`, httpOnly session cookie with a CSRF token on state-changing requests, role checks enforced in services. Users can delete their own Conversations and uploads. `rampart init` creates the first admin; `rampart demo` seeds a demo user.
- Models: OpenRouter for hosted Models, Ollama for local ones. `models.yaml` in the repository root holds the catalog (id, Provider, display name, kind chat or embedding, Tier cheap or powerful) and the Slot defaults (chat cheap, grader cheap, judge powerful, embedding cheap). Admin can switch any Slot to another catalog entry at runtime (stored in the database); users pick any enabled chat Model. API keys live in `.env`, never in the YAML. Cost per request comes from the figure OpenRouter reports in each response; Ollama calls cost zero; no hand-maintained pricing table.
- Observability: Langfuse cloud through the LangChain callback handler; local JSONL traces when Langfuse is not configured; Feedback forwarded as Langfuse scores.
- Evaluation: DeepEval through pytest for retrieval and tool-use metrics, plus deterministic Guard precision and recall; judge Model on the powerful Slot with the cost estimated before a run. Admin can turn rated answers into Evaluation Cases.

### Controls

- Gateway (deterministic): registry membership, enabled flag, role, JSON-schema validation with no extra properties, rate limit, session budget, argument constraints (loopback-only Targets, size caps), Approval bound to the exact argument digest and consumed once, audit record. Nothing the model reads can widen policy because no Tool edits policy.
- Guards: input heuristics for injection and jailbreak patterns and pasted secrets; Provenance label on every context item (user, system, source, upload, API, plugin, target) with untrusted items delimited as data; output redaction of secret-like strings; size caps.
- Approvals: required for `run_injection_test` and for Plugin Tools by default; the requesting user approves by default; a per-Tool admin switch can require an admin instead.
- Plugins: official MCP Python SDK over stdio; catalog file only (name, command, arguments); the repository ships two authored fixture servers (a secret scanner and a read-only fixture docs server) plus a modified copy of one to demonstrate drift detection; admin enables and disables entries in the UI; a changed Tool definition blocks use until re-accepted; the model never sees commands.
- Targets: loopback URLs only; the demo Target is a small FastAPI app with secure and vulnerable profiles, a document slot, a fake export tool and a local sink; outcomes come from the Target's audit log and sink, never from model prose; a marker already present in the input marks the case contaminated.

### Knowledge

- `rampart ingest` fetches OWASP Top 10 for LLM Applications, MITRE ATLAS techniques and NIST AI RMF with license notes, plus authored primers on prompt injection, tool-use safety and RAG access control. Synthetic fixture Sources carry the offline tests.
- Uploads (PDF, Markdown, text) are private to the uploading user.
- Agentic retrieval: retrieve (hybrid, ACL), grade passages with the grader Slot, rewrite the query at most twice, generate with Citations.
- Project Profile form (stack, packages, Targets) is read every turn. Static help page plus a help source filter over the app's own docs.

### Feedback and evaluation

- Feedback is capture only: thumbs up or down with optional comment on each answer, stored with the trace id, shown to admin, forwarded to Langfuse, convertible into Evaluation Cases. No automatic adaptation.
- Datasets authored in the repository and unreadable by the assistant at runtime: about 30 question cases, about 20 tool-use cases, about 100 labelled Guard inputs.

### Delivery

- Repository `third_sub/llm-appsec-assistant`, pushed to GitHub, MIT license. Python import package and CLI `rampart`; distribution name `rampart-appsec` (the bare name is taken on PyPI; nothing is published, so the import name stays). Fetched Sources keep their own license notes.
- CI: offline pytest suite with a scripted stand-in model; live smoke tests behind a marker that need keys; frontend type check, lint, production build and a few Vitest tests. No end-to-end browser tests in version one.
- `rampart demo`: creates admin and demo user, ingests fixture Sources, starts the demo Target in the vulnerable profile and registers it, starts the app, prints the URL and logins.
- Milestones: M1 foundation (backend, auth, SPA shell, chat with streaming, model config, cost, Langfuse); M2 knowledge (ingestion, uploads, agentic retrieval with Citations, Project Profile, help page); M3 controls (Gateway, Guards, Approvals, prompt analysis, vulnerability lookup, Report); M4 injection tests and demo Target; M5 Plugins; M6 feedback, evaluation report, CI, documentation, decision records. The hard rubric is fully met after M3. A report with test results follows each milestone.

## Decision log

| # | Topic | Decision |
|---|---|---|
| Q1 | UI stack | FastAPI backend plus React, Vite, TypeScript single-page app (user wants a nice UI) |
| Q2 | Feedback | Capture only; no automatic learning |
| Q3 | Memory | Checkpointer per Conversation plus explicit Project Profile; long-term memory maybe later |
| Q4 | MCP plugins | Keep, as milestone M5 |
| Q5 | Web ingestion | Setup CLI and uploads only; no runtime fetch Tool |
| Q6 | Injection tests | Keep, fixed suite only |
| Q7 | Tone and help | Cut tone presets; keep static help page and help source filter |
| Q8 | Providers | OpenRouter for hosted Models, Ollama for local |
| Q9 | Observability | Langfuse cloud, local JSONL fallback |
| Q10 | Evaluation library | DeepEval alone plus deterministic Guard metrics |
| Q11 | Database | SQLite in WAL mode |
| Q12 | Repository | `third_sub/llm-appsec-assistant`, GitHub, CI |
| Q13 | Tooling | uv, Python 3.12 |
| Q14 | Docker | None for the app |
| Q15 | Corpus | Fetch official OWASP, MITRE ATLAS, NIST at setup; fixtures for tests |
| Q16 | Vocabulary 1 | Tool, Plugin, Gateway, Guard, Approval, Target, Finding, Report |
| Q17 | Frontend toolkit | Tailwind, shadcn/ui, React Router, TanStack Query, dark mode; FastAPI serves build |
| Q18 | Login | Session cookie, httpOnly, CSRF token |
| Q19 | Streaming | Server-sent events |
| Q20 | Default Models | One Claude and one GPT via OpenRouter, one Ollama Model; `models.yaml` with cheap and powerful Tiers |
| Q21 | Embeddings | OpenRouter embeddings, cheap Model; Ollama embeddings offline; BM25 always, hybrid |
| Q22 | Cost | Use the cost OpenRouter reports per request |
| Q23 | Judge | Powerful Slot via OpenRouter, cost estimate first |
| Q24 | Vocabulary 2 | Conversation, Knowledge Base, Source, Provenance, Citation |
| Q25 | Decision records | Three ADRs after confirmation |
| Q26 | Model config file | Catalog plus Slots in `models.yaml`; admin runtime overrides; keys in `.env` |
| Q27 | Accounts | Admin-created only; seeded demo user |
| Q28 | Approvals | Requesting user by default; per-Tool admin switch |
| Q29 | Demo | One-command `rampart demo` |
| Q30 | Plugin registration | Catalog file only; no free-form commands in the UI |
| Q31 | Tests and CI | Offline pytest plus live smoke marker; frontend type check, lint, build, few Vitest tests; no end-to-end |
| Q32 | Name | `rampart` for package and CLI; distribution `rampart-appsec`; repository name unchanged |
| Q33 | Milestones | M1 to M6 as listed above |
| Q34 | Vocabulary 3 | Tier, Slot, Feedback, Evaluation Case |

## Facts verified during the interview

- OpenRouter offers an OpenAI-compatible embeddings endpoint: https://openrouter.ai/docs/api-reference/embeddings
- OpenRouter reports the charged cost of each request in the response usage data: https://openrouter.ai/docs/use-cases/usage-accounting
- PyPI: `rampart`, `parapet` and `moat` are taken; `rampart-appsec` and `rampart-ai` are free; no `rampart` command exists on the user's machine.
- Not yet verified (declined lookups, to do at build start): installed Node, uv, Python and Ollama versions; which API keys exist in the environment; exact OpenRouter model identifiers; library versions.
