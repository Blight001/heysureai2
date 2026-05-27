"""Example plugin: a no-op ``debug.ping`` tool.

Drop additional ``*.py`` files into this directory with the same
``register(registry)`` signature to add tools. Delete or rename this
file to remove the demo tool from the live registry on next reload.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from ..core import MCPTool


def _handle_ping(user_id: int, arguments: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    return {
        "ok": True,
        "user_id": user_id,
        "ai_config_id": ai_config_id,
        "echo": arguments.get("message", ""),
    }


def register(registry) -> None:  # noqa: ANN001 — registry: MCPRegistry
    registry.register(MCPTool(
        name="debug.ping",
        description="Plugin demo tool. Echoes the provided message; returns the caller's user_id.",
        input_schema={
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Arbitrary text to echo back."},
            },
        },
        handler=_handle_ping,
    ))
