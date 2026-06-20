"""Small ASGI/FastAPI HTTP request logging helper."""

from __future__ import annotations

import logging
import time
from typing import Callable

from fastapi import FastAPI, Request
from starlette.responses import Response


def install_http_request_logging(app: FastAPI, logger_name: str) -> None:
    """Log every HTTP request through the project's normal logger.

    Uvicorn's access logger can be affected by its own logging config, so this
    middleware gives the launcher console a stable project-owned request line.
    Query strings are intentionally omitted to avoid leaking credentials.
    """

    logger = logging.getLogger(logger_name)

    @app.middleware("http")
    async def _log_http_request(
        request: Request,
        call_next: Callable[[Request], Response],
    ) -> Response:
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            client = request.client.host if request.client else "-"
            logger.info(
                "http %s %s -> %s %.1fms client=%s",
                request.method,
                request.url.path,
                status_code,
                elapsed_ms,
                client,
            )
