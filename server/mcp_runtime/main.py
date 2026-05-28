"""Process entrypoint for the ``mcp-runtime`` service (port 3001).

Run with:
    HEYSURE_INTERNAL_TOKEN=... DATABASE_URL=... \
    python -m mcp_runtime.main

or via uvicorn directly:
    uvicorn mcp_runtime.app:create_app --factory --port 3001
"""

import os

import uvicorn


# Force the MCP worker role before importing the api package so any shared
# Socket.IO helpers stay in proxy mode instead of binding a local server.
os.environ.setdefault("HEYSURE_SERVICE_ROLE", "mcp")

from mcp_runtime.app import create_app  # noqa: E402

app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("MCP_RUNTIME_PORT", "3001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
