"""Shared primitives for ``/internal/*`` HTTP endpoints.

Provides:
- ``require_internal_token`` — FastAPI dependency that checks the Bearer
  token against ``INTERNAL_TOKEN``. When the env is empty (monolith /
  local dev) the dependency only allows loopback callers; when set, the
  token must match.
- ``internal_client`` — small httpx wrapper that injects the Bearer
  header and a default timeout. Used by api-gateway / ai-runtime to call
  mcp-runtime / connector-runtime.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import Header, HTTPException, Request

from ..core.config import INTERNAL_TOKEN


def require_internal_token(
    request: Request,
    authorization: Optional[str] = Header(None),
) -> None:
    """FastAPI dependency: gate ``/internal/*`` on a shared Bearer secret.

    Behavior:
    - If ``INTERNAL_TOKEN`` is set: ``Authorization: Bearer <token>`` must
      match. Mismatch / missing → 401.
    - If ``INTERNAL_TOKEN`` is empty: only loopback (127.0.0.1, ::1) clients
      may reach this endpoint. Anything else → 401. This keeps the monolith
      deployment safe even when the env isn't configured.
    """
    if INTERNAL_TOKEN:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(status_code=401, detail="Internal token required")
        token = authorization.split(" ", 1)[1].strip()
        if token != INTERNAL_TOKEN:
            raise HTTPException(status_code=401, detail="Invalid internal token")
        return

    # Token not configured — limit to loopback.
    client = request.client
    host = client.host if client else ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(
            status_code=401,
            detail="Internal endpoint requires HEYSURE_INTERNAL_TOKEN when called from non-loopback",
        )


def internal_headers() -> Dict[str, str]:
    """Headers to attach when calling another service's ``/internal/*``."""
    if not INTERNAL_TOKEN:
        return {}
    return {"Authorization": f"Bearer {INTERNAL_TOKEN}"}


class InternalClient:
    """Thin httpx client wrapper for cross-service calls.

    Lazily imports httpx so this module stays importable even when only the
    in-process monolith is in use.
    """

    def __init__(self, base_url: str, timeout: float = 30.0) -> None:
        if not base_url:
            raise ValueError("base_url required")
        self._base = base_url.rstrip("/")
        self._timeout = timeout
        self._client = None  # type: ignore[assignment]

    def _ensure_client(self):
        if self._client is None:
            import httpx  # local import keeps the dependency optional
            self._client = httpx.Client(
                base_url=self._base,
                timeout=self._timeout,
                headers=internal_headers(),
            )
        return self._client

    def post(self, path: str, json: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        client = self._ensure_client()
        resp = client.post(path, json=json or {})
        resp.raise_for_status()
        return resp.json()

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        client = self._ensure_client()
        resp = client.get(path, params=params or {})
        resp.raise_for_status()
        return resp.json()

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
