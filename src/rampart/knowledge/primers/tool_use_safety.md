# Safe tool use for LLM agents

Written for Rampart. Related reading: OWASP LLM06:2025 Excessive Agency and LLM05:2025
Improper Output Handling.

## The problem

An agent turns model output into actions. Whatever can steer the model, a user, a retrieved
document, a tool result, can therefore steer the actions. Safe tool use means that the
model may propose any call it likes while ordinary code decides which calls actually run.

## A registry with explicit manifests

Every tool, built in or contributed by a plugin, should be registered with a manifest: its
name, a description, a JSON schema for its arguments, the roles allowed to call it, whether
it needs an approval and who may give it, a rate limit, a cost class, and any argument
constraints. A tool that is not in the registry, or is disabled, does not exist as far as
the model is concerned: leave it out of the tool list and refuse it if called anyway.

## A deterministic gateway in front of every call

Put one gateway between the model and the tools and make it check, in order:

1. the tool is registered and enabled;
2. the caller's role may use it;
3. the arguments validate against the schema, with no undeclared properties;
4. argument constraints hold: allowlisted hosts, size caps, identifiers the user owns;
5. the rate limit and the conversation budget are not exceeded;
6. an approval exists when one is required, matches a digest of these exact arguments, has
   not expired and has not been used;
7. the decision, allowed or denied with a reason, is written to an audit log.

A denied call returns a structured reason to the model, which may try something else or
answer without the tool. Stop after a small number of equivalent denials so that the agent
cannot loop.

## Approvals

Show the user what will run: the tool, the arguments, and why. Bind the approval to the
argument digest, make it single use, and give it a short expiry. Let the requesting user
approve by default and allow an administrator to require an admin approval for dangerous
tools. The model can ask for an approval, never grant one, and no tool should be able to
change the approval rules.

## Plugins and drift

Tools contributed by plugins (for example MCP servers) should come from a catalog that a
human edits, never from the model or a chat message. Record a digest of each plugin's tool
definitions when an administrator accepts them; if the definitions change, block the tools
until someone reviews the change. New plugin tools should start disabled and require
approval.

## Tool output is untrusted

Label every tool result with its provenance and present it to the model as data inside
delimiters. Cap its size, redact secrets and credentials before display or storage, and
never let a tool result widen what the agent may do next.

## Bounds

Limit model calls, tool calls, rewrites and wall-clock time per turn, and token budgets per
conversation. Time out every external call and retry provider errors with backoff, then fail
with a clear message.
