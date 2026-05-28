"""Process entrypoint for the ``api-gateway`` service (port 3000).

Run with:
    python -m gateway.main
or via uvicorn directly:
    uvicorn gateway.app:sio_app --host 0.0.0.0 --port 3000
"""

import uvicorn

from api.core.settings import settings
from gateway.app import sio_app  # noqa: F401 — imported for side effects when not reloading


if __name__ == "__main__":
    reload_enabled = settings.server_reload
    uvicorn.run(
        "gateway.app:sio_app",
        host="0.0.0.0",
        port=3000,
        reload=reload_enabled,
        # Watch both gateway/ and api/ so router edits also trigger reload.
        reload_dirs=["gateway", "api"] if reload_enabled else None,
    )
