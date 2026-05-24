"""MCP tool handlers grouped by domain.

Each sub-module exposes a set of ``_handler`` callables wired into the
``api.mcp.registry`` module. Tool modules import shared helpers from
``api.mcp.core`` (workspace paths, registry primitives) and ``api.mcp``
intentionally re-exports only the public surface — internal handlers stay
prefixed with ``_`` and are imported by ``registry.py``.
"""
