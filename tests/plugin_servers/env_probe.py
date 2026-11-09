"""Test-only MCP server: reports the names of the environment variables its process can see."""

import os

from mcp.server.mcpserver import MCPServer

server = MCPServer("env-probe")


@server.tool()
def env_names() -> str:
    """The names of the environment variables this process sees, one per line."""
    return "\n".join(sorted(os.environ))


if __name__ == "__main__":
    server.run()
