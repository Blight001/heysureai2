"""Process entrypoint for the ``connector-runtime`` service.

Hosts the Socket.IO server that desktop / browser agents connect to and
the HTTP endpoints used by ai-runtime to dispatch agent tasks and send
outbound Feishu/QQ messages. Both share a single external port (3002).

Required env:
    HEYSURE_SERVICE_ROLE=connector       — keeps api.sio's real Socket.IO server
    HEYSURE_INTERNAL_TOKEN=...           — for /internal/* gate
    DATABASE_URL=postgresql://...        — shared with the other services

Run with:
    python -m connector_runtime.main
"""

import os

import uvicorn


# Must be set BEFORE importing the api package so api.sio binds a real server.
os.environ.setdefault("HEYSURE_SERVICE_ROLE", "connector")

from connector_runtime.app import create_app  # noqa: E402

app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("CONNECTOR_RUNTIME_PORT", "3002"))
    uvicorn.run(app, host="0.0.0.0", port=port)
