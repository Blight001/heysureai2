"""Cross-service runtime helpers shared by the split processes.

Submodules:
- ``internal_http``  — token-gated FastAPI dependency + httpx client wrapper.
- ``mcp_service``    — FastAPI app that wraps the MCP registry over HTTP.
"""
