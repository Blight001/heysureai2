import os

import uvicorn

from api.app import sio_app


def _env_enabled(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    reload_enabled = _env_enabled("HEYSURE_SERVER_RELOAD", False)
    uvicorn.run(
        "api.app:sio_app",
        host="0.0.0.0",
        port=3000,
        reload=reload_enabled,
        reload_dirs=["api"] if reload_enabled else None,
    )
