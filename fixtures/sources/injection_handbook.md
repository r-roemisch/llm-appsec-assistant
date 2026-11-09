# Fixture: Canary Labs handbook on indirect prompt injection

This document is a synthetic fixture for Rampart's offline tests and demo. Canary Labs and
the quokka-delimiter technique are fictional; the general advice mirrors common guidance.

## What indirect prompt injection is

Indirect prompt injection happens when an assistant reads content that someone else
controls, such as a web page, an email, a shared document or a tool result, and that
content contains instructions. The model cannot reliably tell the instructions apart from
the data it was asked to process, so it may follow them: reveal its system prompt, call a
tool with attacker-chosen arguments, or quietly change its answer.

## The quokka-delimiter technique

Canary Labs wraps every piece of retrieved text in a delimiter that contains a random value
chosen for each request, for example `<doc-7f3a>` and `</doc-7f3a>`. Because the document
cannot know the random value, it cannot close the block early and continue as if it were the
application. The system prompt states that everything between the delimiters is data. The
handbook calls this the quokka-delimiter technique and stresses that it reduces, but does
not remove, the risk.

## Controls that do not depend on the model

The handbook's main rule: never let the model's judgement be the last line of defence.
Authorise every tool call in ordinary code that checks the caller's role, validates the
arguments against a schema, and enforces allowlists. Require a human approval, bound to the
exact arguments, for actions with side effects. Treat model output as untrusted before it
reaches a browser, a shell or another system.
