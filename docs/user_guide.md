# Rampart user guide

Rampart is a chat assistant for people who build or review applications on large language
models. It answers LLM-security questions with Citations from its Knowledge Base, and it is
built as the kind of secure agent it recommends. This guide covers what you can do as a
user.

## Who Rampart is

Rampart answers as a security reviewer: precise, concrete, and honest about uncertainty. It
cites the passages it used from the Knowledge Base and says when the Knowledge Base does not
cover a question. The persona is fixed by the application; you cannot change its tone or
instructions, and text you paste is treated as data to analyse, never as instructions.

## Signing in

There is no sign-up page. An administrator creates your account and gives you a username and
a password. Change your password on the Account page; changing it signs out your other
sessions. After five wrong passwords for one username within fifteen minutes, sign-in is refused
until the window passes, even with the right password; an administrator can reset your
password to end it at once.

## Conversations

Start a conversation from the main page and type a question. The answer streams in as it is
written, and you can stop it at any time; Rampart keeps what it had written so far. Each
conversation keeps its own history, which Rampart reads on every turn; in a long conversation
Rampart keeps the last few exchanges word for word and a short summary of what came before.
Rename or delete a conversation from the list in the sidebar; deleting removes its messages (and
any Feedback on them) for good.

Pick the model for a conversation with the model picker next to the message box. The list
shows every chat model the administrator has enabled; a model marked unavailable has no
configured provider at the moment. You can switch models in the middle of a conversation;
the next answer uses the new model. Under each answer Rampart shows the model, the tokens
used, the cost and how long it took. The cost covers every model call the turn needed,
including the searches described below.

## Citations and the Knowledge Base

Before answering, Rampart decides whether the Knowledge Base can help. If so, it searches
it, checks which passages are relevant, and rewrites the search up to twice when nothing
relevant turns up. While this happens the conversation shows "Searching the Knowledge Base".

The answer cites passages with numbers in square brackets, such as [1] or [2]. The sources
under the answer list each cited passage with its document and section; open one to read the
whole passage, its origin and its license. If Rampart says the Knowledge Base did not cover
your question, the rest of that answer comes from the model's general knowledge.

The Knowledge Base holds the OWASP Top 10 for LLM Applications 2025, MITRE ATLAS techniques,
mitigations and case studies, the NIST AI Risk Management Framework and its Generative AI
Profile, short primers written for Rampart, Rampart's own guides, and your own uploads.

Search normally combines meaning-based (embedding) search with keyword search. When no
embedding model is available, Rampart uses keyword search only and marks such answers with a
"keyword search only" badge; answers still cite their sources, but searches phrased very
differently from the documents may find less.

## Uploading your own documents

Open the Knowledge Base page to upload PDF, Markdown (.md) or text (.txt) files of up to 5 MB.
Rampart checks the type from both the file name and the content, extracts the text, and
splits it into passages that it can search and cite. Scanned PDFs without a text layer and
encrypted PDFs cannot be read.

Your uploads are private: only you can search them, see them in citations, or list them.
Not even administrators can retrieve them. Delete an upload on the Knowledge Base page and its
passages disappear from search immediately. Rampart treats the content of uploads as data:
instructions inside a document are not followed.

## Project Profile

The Project Profile tells Rampart about your work so that answers fit your stack. Open the
Project Profile page and describe your stack in a few sentences (up to 2000 characters), then list
the packages you use with their ecosystem (such as PyPI or npm), name and version. Rampart
reads the profile at the start of every turn. Delete the profile on the same page and it is
no longer used from the next turn on.

To fill the package list from your project, use **Import a Dependency File** at the top of the
page: paste or choose a requirements.txt, uv.lock, poetry.lock, package-lock.json,
pyproject.toml or package.json, then **Preview**. Rampart reads the names and versions without
a model and does not keep the file. The preview shows what it read, which packages have no exact
version (those cannot be checked for vulnerabilities, so prefer a lock file), and the lines it
skipped, such as `-r` includes or packages installed from a URL. Files of other tools (yarn.lock,
pnpm-lock.yaml, Pipfile.lock, Cargo.lock, Gemfile.lock, go.sum and similar) are refused with the
tool's name rather than misread; enter those packages by hand. **Add to profile** saves at
once: packages already in the profile take the file's versions, new ones are added, nothing is
removed, unless you tick **Replace all packages**. A profile holds up to 1000 packages; with
more than 30 the assistant sees counts rather than the list, and checks them with
`check_dependencies`.

## Help mode

Help mode answers questions about using Rampart from this guide and the admin guide only, and
cites them. Turn it on with the Help mode switch of a conversation, or ask a question in the
box at the top of the Help page, which starts a conversation in help mode. Turn the switch
off to return to normal answers.

## Targets

A Target is a small application of your own that Rampart may test for prompt injection. Open the
Targets page to register one: give it a name and a URL. The URL must point to your own machine (a
loopback address such as `http://127.0.0.1:8001` or `http://[::1]:8001`); Rampart refuses any
other host and never resolves names, so the test suite cannot reach a system you do not own.
Choose whether test inputs go into the Target's user message (direct injection) or its document
slot (indirect injection, through an untrusted document). You can add a Target to your Project
Profile so that Rampart offers to test it.

To run the fixed `seed-v1` injection suite, ask Rampart in a conversation to run the injection
test against your Target by name. It always needs your approval: Rampart shows the Target and the
suite, and the approval is valid once, for those exact arguments, for 15 minutes. Each run makes
a random Sentinel, a value the Target plants as its internal record. The suite sends a set of
synthetic candidates to the Target and reads the result from the Target's own audit log and sink,
never from what it says. Each candidate shows whether the export was proposed, executed and
received; "received" means Rampart found this run's Sentinel in the sink text itself. A candidate
whose text already contains the Sentinel would be flagged as contaminated and not counted; with a
fresh random Sentinel per run this cannot happen to the fixed candidates. The verdict is
"vulnerable" if any uncontaminated injection reached the sink, otherwise "secure". The audit log
explains a breach but cannot clear one: a candidate whose Sentinel reached the sink counts even
when the log shows no `execute_export` step, and the result says how many such breaches there
were. Ask for a report to keep the per-candidate outcomes.

No Target yet? `rampart demo-target --profile vulnerable` (or `secure`) starts a demo application
on a loopback port that you can register and test; `rampart demo` sets one up for you.

### Writing your own Target

A Target answers five HTTP endpoints with JSON. This is the whole contract the harness relies on:

| Endpoint | Request | Response |
|---|---|---|
| `GET /health` | | `{"profile": "<any label>"}` |
| `POST /reset` | `{"document": "", "sentinel": "<value>"}` | `{"sentinel": "<the value it planted>"}`; empty the sink and the audit log, and make the Sentinel part of the internal record your agent must protect |
| `POST /message` | `{"message": "...", "document": "..."}` | Anything; Rampart ignores replies |
| `GET /audit` | | `{"audit": [{"action": "propose_export"}, {"action": "execute_export"}, ...]}`, the steps your agent took for the last message |
| `GET /sink` | | `{"text": "<everything that left through the side channel>"}` |

`propose_export` means your agent recognised a request to move the internal record out;
`execute_export` means it acted on it. Use these names so the result can explain what happened;
the verdict comes from the sink either way. A Target that does not answer `/reset` with the Sentinel
it was sent may report `{"received": true}` from `/sink` instead; Rampart then marks the run as
weaker evidence, because the Target graded its own result.

## Tools

Rampart can call tools while it answers. Each call appears as a card in the answer with the
tool, its arguments, what Rampart's Gateway decided, and the result.

- **Review a prompt or tool schema** (`analyze_prompt`): paste a system prompt or tool
  definitions (OpenAI, Anthropic or MCP format) and ask for a review. The findings come from
  fixed rules, each with a severity, the evidence, a recommendation and OWASP references; the
  answer explains them but adds no findings of its own.
- **Known vulnerabilities** (`lookup_vulnerabilities`): ask about a package and version, for
  example "Check PyPI requests 2.25.0". Results come from OSV.dev and are cached for a few
  hours; if OSV.dev cannot be reached, the card says so.
- **Check all your packages** (`check_dependencies`): ask "check my dependencies" and Rampart
  sends every package of your Project Profile with an exact version to OSV.dev in one batch.
  The answer lists the known vulnerabilities, most severe first, and the packages it could not
  check because they have no exact version. OSV.dev often lists one vulnerability under several
  advisory ids (a GitHub advisory, a PyPA advisory, a CVE); Rampart counts it once and shows the
  other ids beside it. A report includes the full table.
- **Search the Knowledge Base** (`search_knowledge`): Rampart may search again during an
  answer; those passages are cited like the others.
- **Report** (`generate_report`): ask for a report and Rampart stores one; see Reports below.
- **Injection test** (`run_injection_test`): tests one of your registered Targets (see
  Targets).
- **Plugin tools**: an administrator may enable tools from Plugins, small programs running on
  the Rampart server (for example a secret scanner). They are named `<plugin>__<tool>`, their
  cards say which Plugin they come from, and every call needs your Approval. What a Plugin
  returns is treated as untrusted data, like a document: Rampart flags instructions in it and
  does not follow them.

Every call passes the Gateway first: it checks that the tool exists and is enabled, that the
arguments match the tool's schema exactly, the hourly rate limit, the conversation's token
budget, and tool-specific rules (an injection test only runs against your own registered
loopback Target). A refused call shows as "denied" with the reason, and Rampart continues
without it. Nothing a document or a tool result says can make the Gateway allow a call.

## Approvals

Some tool calls need an approval before they run; the injection test always does. Rampart
then stops and shows an approval card with the exact arguments. Approve to run that exact
call once, or Reject to continue without it. An approval expires after 15 minutes and is used
up by the one call it was made for; if the arguments change, a new approval is needed.

An administrator can require that only administrators approve a tool. The card then says it
is waiting for an administrator; once they decide, use Continue. You can always reject your own
request. While a conversation waits for a decision, it does not accept new messages.

## Guards

- **Secrets in your messages.** API keys, tokens, private keys and passwords in what you type
  are removed before the message is stored or sent to any model, and Rampart tells you so.
  Rotate a credential you pasted by mistake.
- **Attempts to change Rampart's instructions.** A message that reads as an attempt to make
  Rampart ignore its rules, reveal its hidden configuration or misuse its tools gets a fixed
  reply and is not sent to a model. To analyse a suspicious prompt, put it in a code block and
  ask for an analysis: questions about attacks and quoted examples pass.
- **Documents that talk to the assistant.** When a retrieved passage or a tool result contains
  instructions aimed at AI assistants, the answer notes that it was treated as data.
- **Secrets in answers.** Answers and tool results are checked for secrets while they stream;
  anything found is replaced by a marker before you see it or it is stored.

## Reports

Ask Rampart to "write a report" and it stores a Markdown security review of the conversation:
a summary, the prompt and tool-schema findings, the vulnerability lookups, injection test
results, the sources cited, and the answers. Open Reports in the sidebar to read, download or
delete your reports. Reports are private to you.

## Feedback

Under each finished answer, rate it with a thumbs up (helpful) or a thumbs down (not helpful)
and, if you like, say why in a short comment. Click the same thumb again to take the rating back.
Your rating, your comment, your question and the answer are shown to administrators, and the
rating is attached to the answer's trace. Administrators can turn an answer into a test case for
Rampart's evaluation. Feedback never changes how Rampart answers on its own: improvements happen
when people review it.

## Usage and costs

The Account page shows your tokens and costs in total and per model. Costs for hosted models
are the amounts OpenRouter reports for each request; local models cost nothing.
