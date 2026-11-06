# LLM Application Security Assistant

An assistant that helps developers review the security of their LLM applications, together with the controls that keep the assistant itself safe while it uses untrusted content and tools.

## Language

### Conversation

**Conversation**:
One chat with its own history, listed in the sidebar and owned by one user.
_Avoid_: thread, session, chat

**Feedback**:
One rating, with an optional comment, that a user gives on one answer.
_Avoid_: rating, vote, review

### Agent and tools

**Tool**:
A capability the model may call, built-in or contributed by a Plugin, always invoked through the Gateway.
_Avoid_: function, action, skill, capability

**Plugin**:
An MCP server that an admin registered and that contributes Tools.
_Avoid_: extension, integration, connector, MCP tool

**Provider**:
A service that serves Models through an API, such as OpenRouter or a local Ollama instance.
_Avoid_: vendor, backend, LLM

**Model**:
A specific model identifier available at one Provider.
_Avoid_: LLM, engine

**Tier**:
The cheap or powerful label on a Model.
_Avoid_: class, size, level

**Slot**:
A named job a Model is assigned to: chat, grader, judge or embedding.
_Avoid_: role (reserved for user and admin), purpose, function

### Knowledge

**Knowledge Base**:
Everything the assistant can retrieve from: the shared Sources and each user's own uploads.
_Avoid_: corpus, index, vector store

**Source**:
One document in the Knowledge Base, with its origin and license recorded.
_Avoid_: file, doc, page

**Citation**:
A reference from an answer to the exact Source passage it used.
_Avoid_: reference, link, footnote

### Security controls

**Gateway**:
The deterministic check that every Tool call passes before it executes.
_Avoid_: policy engine, firewall, guardrail

**Guard**:
A check applied to content: user input, retrieved or uploaded text, Tool output, or Model output.
_Avoid_: filter, firewall, gateway

**Provenance**:
The trust origin attached to every piece of context the model sees: user, system, source, upload, API, plugin or target.
_Avoid_: origin, trust level, label

**Approval**:
A one-time consent by a user, bound to the exact arguments, to run one specific Tool call.
_Avoid_: permission, grant, confirmation

### Testing and output

**Target**:
A registered loopback application that the injection test Tool is allowed to test.
_Avoid_: victim, app under test, endpoint

**Finding**:
A single rule-produced observation from prompt analysis or from a test run.
_Avoid_: issue, vulnerability, alert

**Report**:
A stored Markdown artifact assembled from Findings and Citations for one Conversation.
_Avoid_: summary, export, document

### User

**Project Profile**:
The description of a user's stack, packages and Targets that the user enters explicitly and that the assistant reads every turn.
_Avoid_: memory, preferences, context

### Evaluation

**Evaluation Case**:
A saved question with its expected answer or expected Tools, used by the evaluation suite.
_Avoid_: golden, test case, sample
