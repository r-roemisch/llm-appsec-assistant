# Data flows

Where Rampart keeps data, where it sends data, what is redacted first, and how long each thing
lives. Written for M7 from the code, in answer to the critique's request for a data-flow
inventory (`docs/critique_log.md`, point 5).

**Redaction** below always means the same detector (`src/rampart/guards/secrets.py`): it
replaces credential-shaped strings such as API keys, tokens, private keys and passwords in
connection strings. It cannot recognise a secret that looks like ordinary text.

## Where data enters

| Entry | Redacted before it is stored or sent on |
|---|---|
| A user's chat message | Yes, before storage, the checkpoint, the trace and any Model call |
| An upload (PDF, Markdown, text) | Yes, before indexing, so before any embedding or prompt |
| The Project Profile (stack, packages) | Yes, on save |
| A Dependency File import | Only package names and versions are kept; the file itself is not stored |
| A Feedback comment | Yes, on save |
| Model output | Yes, while it streams and before it is stored |
| Tool output | Yes, before the Model reads it and before the audit record |
| Plugin output | Yes, as Tool output |
| `rampart ingest` (OWASP, MITRE ATLAS, NIST) | No; public documents |

## Stores on this machine

All under the data directory (`RAMPART_DATA_DIR`, default `data/`), except the evaluation
reports.

| Store | What it holds | How long |
|---|---|---|
| `rampart.sqlite3`: users, sessions | Usernames, Argon2 password hashes, hashed session tokens | Sessions end after 7 days, at sign-out or at a password change; accounts until an admin deletes them |
| `rampart.sqlite3`: login failures | Username as typed and client address of each failed sign-in | Deleted once older than the throttling window (15 minutes) on the next failure; a password change deletes the account's rows |
| `rampart.sqlite3`: Conversations, messages, Model calls, Feedback | Redacted messages, cost and usage, ratings and redacted comments | Until the user deletes the Conversation or an admin deletes the account |
| `checkpoints.sqlite3` | LangGraph state per Conversation: redacted messages, a summary of older turns | Deleted with the Conversation, or with the account |
| `rampart.sqlite3`: Sources, passages; `chroma/` | Shared Sources and each user's redacted uploads, their passages and embeddings | Uploads until the owner deletes them or the account is deleted; shared Sources until the next `rampart ingest` changes them |
| `rampart.sqlite3`: Project Profile, Targets | Redacted stack text, packages, loopback Target addresses | Until the user deletes them or the account is deleted |
| `rampart.sqlite3`: Tool-call audit | Tool, redacted arguments (long strings shortened), decision, redacted result | Kept. Deleting a Conversation or an account nulls the reference, the row stays |
| `rampart.sqlite3`: Approvals | Tool, redacted arguments, digest, decision | Deleted with the Conversation or the requesting account |
| `rampart.sqlite3`: Guard events | Which Guard acted, a category and a short snippet of redacted text; for a passage from a private upload only the fact that it was flagged, not its name or text (the owner's own message record keeps those) | Kept. Deleting an account or a message nulls the reference |
| `rampart.sqlite3`: Reports | Markdown assembled from Findings, lookups, tests, Citations and redacted answers | Deleted with the account; kept if only the Conversation is deleted |
| `rampart.sqlite3`: OSV.dev cache | Package, version, OSV.dev's answer | Fresh for 6 hours; older answers are kept as a stale fallback for when OSV.dev is unreachable |
| `rampart.sqlite3`: Evaluation Cases, evaluation runs | Redacted question and answer from rated answers, scores | Kept; an admin deletes cases |
| `traces/<date>.jsonl` | One line per turn: user id, Conversation id, Model, redacted input and output, usage, timings | Kept until `rampart traces prune --older-than DAYS`, or automatically at server start when `RAMPART_TRACE_RETENTION_DAYS` is set |
| `eval/` | A snapshot of the database and vector store for one evaluation run | Deleted when the run ends |
| `plugins/<plugin>/stderr.log` | What a Plugin process wrote to stderr | Started afresh once it passes 1 MB |
| `docs/reports/eval/` (repository) | Evaluation reports: case ids, scores, Model names, costs | Kept; they are committed evidence |

## Data leaving this machine

| Destination | What is sent | When |
|---|---|---|
| OpenRouter (hosted Models) | The system prompt, the Project Profile, redacted history and question, retrieved passages, Tool output | Every hosted chat, grader, judge and summary call |
| OpenRouter (embeddings) | Passage text at ingest and upload; the search query each turn | Only when an OpenRouter embedding Model holds the embedding Slot |
| Ollama | The same as OpenRouter | Only for local Models; normally on this machine |
| Langfuse | The trace of each turn, with every value passed through the same redaction; Feedback scores | Only when Langfuse keys are set. Langfuse keeps it under the project's own retention setting |
| OSV.dev | Ecosystem, package name and version | Each vulnerability lookup or dependency check that misses the cache |
| A registered Target | The fixed test suite and a random Sentinel for the run | Each approved injection test; loopback only |
| A Plugin process | The Tool arguments the Model produced | Each approved Plugin call; the process runs locally with a minimal environment and no Rampart credentials |

## Known limits

- Deleting a Conversation keeps its audit rows and trace lines, by design: they are the record of
  what the assistant did. They hold redacted text and ids, not the conversation as shown.
- Deleting an account keeps the trace lines that name its user id until they are pruned.
- Nothing encrypts the data directory; protect it with file permissions.
- Credentials in `.env` are read at start and never written to any store above.
