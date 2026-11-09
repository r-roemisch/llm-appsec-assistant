# Prompt injection: a primer

Written for Rampart. It summarises widely shared guidance; the OWASP Top 10 for LLM
Applications (LLM01:2025 Prompt Injection) and MITRE ATLAS (AML.T0051 LLM Prompt Injection)
cover the topic in more depth.

## What it is

A language model receives its instructions and its data in the same channel: text. Prompt
injection is any input that makes the model treat data as instructions, so that it does
something its developer did not intend. A direct injection comes from the person typing to
the application ("ignore your rules and..."). An indirect injection arrives through content
the application feeds the model on someone's behalf: a retrieved document, a web page, an
email, a code comment, a tool result or the output of another model. Indirect injection is
the more dangerous form because the victim never sees the payload and the attacker never
needs an account.

## Why it is hard to prevent

There is no reliable way to make a model ignore instructions inside data. Instructions in
the system prompt help, delimiters help, and fine-tuning helps, but each can be worked
around with rephrasing, other languages, encodings, or content split across several
sources. Detection with patterns or a classifier catches known payloads and misses new
ones. The practical goal is therefore to limit what a successful injection can do, not to
assume it will never happen.

## What an injection can do

The impact depends on the agency the application gives the model. A model that can only
write text to the person who asked can be made to give a wrong or harmful answer, or to
leak whatever is in its context window, such as the system prompt or other documents. A
model that can call tools can be made to call them: send messages, change records, fetch
URLs, or exfiltrate data by encoding it in a link or an image address that the client then
loads. Every tool and every piece of sensitive context raises the stakes.

## Defences in layers

1. **Least privilege.** Give the model only the tools and data the task needs, with the
   narrowest scope: read-only where possible, per-user credentials rather than a shared
   service account, and no tool that can change the application's own policy.
2. **Authorisation outside the model.** Decide whether a tool call may run in ordinary,
   deterministic code: check the tool is registered and enabled, the caller's role, the
   arguments against a strict schema, allowlists (for example loopback-only test targets),
   rate limits and budgets. Never ask a model, including a second "judge" model, to make
   this decision, because it reads the same untrusted content.
3. **Human approval bound to arguments.** For actions with side effects, ask the user to
   approve the exact call. Bind the approval to a digest of the arguments, make it single
   use, and let it expire, so that a later change by the model invalidates it.
4. **Separate and label untrusted content.** Record where every piece of context came from
   (its provenance) and present untrusted content as data inside delimiters the content
   cannot forge, for example a tag name that includes a random value chosen per request.
   Tell the model that delimited content is reference material, never instructions.
5. **Treat model output as untrusted.** Encode output before it reaches a browser, never
   pass it to a shell or an interpreter without validation, and do not let the client fetch
   URLs or images from model output automatically.
6. **Monitor and test.** Log tool decisions and flag instruction-like text in retrieved
   content. Test regularly against a fixed suite of injection cases on a system you own, and
   judge the outcome from what the system actually did (its audit log), not from what the
   model says it did.

## Quick checklist

- Can any untrusted text reach the prompt? List the paths: uploads, retrieval, tools, web.
- What is the worst thing the model can do with its tools if fully controlled by an attacker?
- Is every tool call authorised by code, with schema validation and allowlists?
- Do side-effecting actions need an approval tied to the exact arguments?
- Is model output encoded before display and never executed?
- Would you notice an attack? Is there an audit trail of tool calls and approvals?
