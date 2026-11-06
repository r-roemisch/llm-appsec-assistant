# Rampart

Rampart is a chat assistant for people who build or review applications on large language
models: developers shipping LLM features, application-security engineers reviewing them, and
learners studying LLM security. It answers LLM-security questions with citations from a curated
Knowledge Base, inspects your own system prompts and tool schemas, looks up known vulnerabilities
in your dependencies, runs a fixed prompt-injection test suite against a registered local target,
and assembles a Markdown report. It is built as the secure agent it recommends: every tool call
passes a deterministic gateway, untrusted content is labelled, approvals are bound to exact
arguments, and every turn is traced and priced.

**Status: milestone M1 of 6 (foundation).** Working today: accounts and roles, streaming chat
with a per-conversation model choice, a model catalog with admin-controlled slots and generation
settings, per-request cost from OpenRouter, Langfuse tracing with a local fallback, and the React
interface. Knowledge, the gateway, guards, injection tests, plugins and evaluation follow in
M2 to M6 (see `docs/DESIGN.md` and `docs/SPEC.md`).

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
uv run rampart serve            # http://127.0.0.1:8000
```

Sign in with the admin account, open **Admin** to create user accounts (there is no sign-up
page), then start a conversation. The model picker in the composer lists every enabled chat
model; models whose provider is not configured are marked unavailable.

For a throwaway setup with both accounts created and printed:

```bash
uv run rampart demo             # prints the URL, admin and demo logins, then serves
```

Local models: `ollama pull qwen3:8b` makes the default local entry in `models.yaml` available.
If you prefer another Ollama model, add it to `models.yaml` with an `ollama/` prefix.

## Everyday commands

| Task | Command |
|---|---|
| Backend with auto-reload | `uv run rampart serve --reload` |
| Frontend dev server (proxies `/api` to port 8000) | `cd frontend && npm run dev` |
| Backend tests (offline, scripted model) | `uv run pytest` |
| Backend lint, format check, types | `uv run ruff check src tests && uv run ruff format --check src && uv run pyright src` |
| Frontend type check, lint, tests, build | `cd frontend && npm run typecheck && npm run lint && npm test && npm run build` |
| Manage accounts | `uv run rampart user create <name>`, `uv run rampart user reset-password <name>`, `uv run rampart user list` |

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

`models.yaml` is the model catalog: each entry has an id, provider (`openrouter` or `ollama`),
display name, kind (`chat` or `embedding`) and tier (`cheap` or `powerful`), and the file sets the
default model for each slot (chat, grader, judge, embedding) with optional temperature and
max-tokens settings. Admins can override slots at runtime in the UI; overrides are stored in the
database and can be reset to the file defaults.

## Models and cost

Rampart talks to two providers only: OpenRouter for hosted models and Ollama for local ones.
The cost of every hosted turn is the figure OpenRouter reports for that request (usage
accounting), not a price table; Ollama turns cost zero. Costs are shown per message, per
conversation and per user, and in the admin usage view per user and per model.

## Tracing

Every turn is one trace. With Langfuse keys, traces go to Langfuse through the LangChain callback
handler and carry the user id, conversation id and model. Without keys, one JSON line per turn is
appended to `data/traces/<date>.jsonl`. The trace id is stored on the assistant message either way.

## Project layout

```
src/rampart/        backend package and `rampart` CLI
  auth/             accounts, sessions, roles
  catalog/          models.yaml, provider availability, slot overrides
  chat/             LangGraph graph, turn engine, streaming service, OpenRouter cost capture
  usage/            token and cost totals
  tracing/          Langfuse and JSONL tracers
frontend/           React single-page app (Vite, TypeScript, Tailwind, shadcn/ui)
docs/               DESIGN.md (decisions), SPEC.md (specification), API.md (contract),
                    adr/ (decision records), reports/ (milestone reports)
tests/              offline pytest suite with a scripted stand-in model
models.yaml         model catalog and slot defaults
```

## Documentation

- `docs/DESIGN.md`: the design record and decision log behind the build
- `docs/SPEC.md`: the implementation specification (requirements, acceptance tests, milestones)
- `docs/API.md`: the HTTP and server-sent-event contract
- `docs/adr/`: architecture decision records
- `docs/reports/`: a report with test results after each milestone

## License

MIT, see `LICENSE`. Fetched reference sources keep their own license notes (from M2 on).
