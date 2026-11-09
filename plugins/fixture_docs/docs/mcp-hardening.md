# MCP server hardening checklist (synthetic example)

- Start each MCP server from a fixed, reviewed command, never from text a model produced.
- Give the server only the environment it needs: no API keys it does not use.
- Review every tool's name, description and input schema before enabling it, and review them
  again whenever they change.
- Treat tool output as untrusted data: delimit it, scan it, and never let it change policy.
- Require a human approval for tools that act on the outside world.
