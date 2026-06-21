import asyncio
import os
import traceback

os.environ.setdefault("HEYSURE_SERVICE_ROLE", "worker")
os.environ.setdefault("HEYSURE_MCP_RUNTIME_URL", "http://127.0.0.1:3001")

from api.runtime.internal_http import _async_clients
from ai_runtime.inference.core import _call_mcp_via_runtime


async def call():
    return await _call_mcp_via_runtime(
        "http://127.0.0.1:3001",
        "knowledge.manage",
        1,
        {"action": "list_thoughts", "params": {"limit": 1}},
        None,
    )


if __name__ == "__main__":
    _async_clients.clear()
    for i in range(3):
        try:
            result = asyncio.run(call())
            inner = result.get("result") if isinstance(result, dict) else result
            total = inner.get("total") if isinstance(inner, dict) else "?"
            print(f"run {i}: OK total={total}")
        except Exception as exc:
            print(f"run {i}: FAIL {type(exc).__name__}: {exc}")