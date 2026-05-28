"""Process entrypoint for the ``mcp-runtime`` service.

Run with:
    HEYSURE_INTERNAL_TOKEN=... DATABASE_URL=... \
    python main_mcp_runtime.py

or via uvicorn directly:
    uvicorn api.runtime.mcp_service.app:create_app --factory --port 3001
"""

import os

import uvicorn


# Force the MCP worker role before importing the api package so any shared
# Socket.IO helpers stay in proxy mode instead of binding a local server.
os.environ.setdefault("HEYSURE_SERVICE_ROLE", "mcp")

from api.runtime.mcp_service import create_app

app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("MCP_RUNTIME_PORT", "3001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
