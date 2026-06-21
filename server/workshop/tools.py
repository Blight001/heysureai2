# -*- coding: utf-8 -*-
"""Built-in workshop MCP tool catalog.

Knowledge-base operations are exposed exclusively via the registry tool
``knowledge.manage`` (action dispatch). This catalog is intentionally empty
so the library workshop does not duplicate those capabilities.
"""

TOOL_DEFS: list = []

TOOL_NAMES = [item["name"] for item in TOOL_DEFS]