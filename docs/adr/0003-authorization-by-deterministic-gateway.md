---
status: accepted
date: 2026-11-06
---

# Authorization by a deterministic Gateway, never by asking a model

Every Tool call, built-in or contributed by a Plugin, passes through one deterministic Gateway before it executes: registry membership, enabled flag, caller role, JSON-schema validation with no extra properties, rate limit, session budget, argument constraints (loopback-only Targets, size caps), an Approval bound to the exact argument digest and consumed once, and an audit record. The alternative, letting the model judge whether a call is safe or asking a second model to grade it, was rejected because the model reads untrusted content (retrieved Sources, uploads, Tool output, Target output) and anything that reads untrusted content can be talked into widening policy. The Gateway is ordinary code with tests; the model has no Tool that edits policy, allowlists, Approvals or Plugin commands, so no instruction found in untrusted content can change what is allowed. Guards (input heuristics, Provenance labels, output redaction) remain defence in depth; the Gateway is the enforcement point.

## Consequences

- Approvals are granted by the requesting user by default, with a per-Tool admin switch; the model can only request, never grant.
- Plugin servers come from a catalog file edited by humans; the model never sees or chooses a command.
- Outcomes of injection tests are read from the Target's audit log and sink, never from model prose, for the same reason.
