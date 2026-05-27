"""Process entrypoint for the ``ai-runtime`` service.

Consumes ``ChatRun`` rows queued by api-gateway (via NOTIFY on Postgres
or polling on SQLite) and runs ``chat_worker._run_worker`` for each one.

Required env:
    HEYSURE_SERVICE_ROLE=worker         — disables the local Socket.IO server
    HEYSURE_API_GATEWAY_URL=http://api-gateway:3000
                                        — destination for forwarded emits
    HEYSURE_INTERNAL_TOKEN=...          — shared with api-gateway / mcp-runtime
    DATABASE_URL=postgresql://...       — required for LISTEN/NOTIFY
    MCP_RUNTIME_URL=http://mcp-runtime:3001
                                        — optional; enables HTTP tool calls
    CONNECTOR_RUNTIME_URL=http://connector-runtime:3002
                                        — optional; enables HTTP agent dispatch

Run with:
    python main_ai_runtime.py
"""

import os
import signal
import threading


# Force-set the service role BEFORE importing the api package so api.sio picks
# the remote proxy at import time. main_ai_runtime.py must be the entrypoint
# for the worker process.
os.environ.setdefault("HEYSURE_SERVICE_ROLE", "worker")

from api.database import create_db_and_tables  # noqa: E402
from api.runtime.ai_worker_service import run_dispatcher_forever  # noqa: E402


def main() -> int:
    create_db_and_tables()

    stop_evt = threading.Event()

    def _on_signal(signum, _frame):
        print(f"[ai-runtime] signal {signum} -> draining and exiting")
        stop_evt.set()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    run_dispatcher_forever(stop_evt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
