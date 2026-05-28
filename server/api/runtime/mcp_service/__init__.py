"""FastAPI app for the ``mcp-runtime`` process.

Exposes the in-process MCP registry over HTTP so that ai-runtime and
api-gateway can call tools without holding a Python reference. The same
process also handles hot-reload of tools and plugin discovery.
"""

from .app import create_app

__all__ = ["create_app"]
