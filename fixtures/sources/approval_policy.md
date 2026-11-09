# Fixture: Marmot approval policy card

This document is a synthetic fixture for Rampart's offline tests and demo. The Marmot team
and the marmot-approval digest are fictional; the pattern is a common one.

## Approvals bound to arguments

When an agent wants to run a tool with side effects, the Marmot policy asks the user to
approve that exact call. The approval stores a digest of the tool name and its arguments,
the marmot-approval digest. If the agent later changes any argument, the digest no longer
matches and the approval does not apply. Each approval can be used once and expires after a
few minutes.

## Who may approve

By default the person who asked for the action approves it. For dangerous tools an
administrator can require that only an administrator approves. The model itself can request
an approval but can never grant one, and no tool exists that changes the approval rules.

## Budgets and rate limits

Every tool has a rate limit per hour and every conversation has a budget. When a limit is
reached the agent stops with a visible reason instead of trying again in a loop.
