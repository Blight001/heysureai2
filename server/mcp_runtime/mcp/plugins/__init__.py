"""Drop-in MCP tool plugins discovered at startup and hot-reload.

Each plugin module must define a ``register(registry)`` callable. The
loader calls it with a fresh ``MCPRegistry`` on reload and with the live
singleton at startup. Tools added here behave identically to builtin
tools: per-user handlers still receive ``user_id`` first and must keep
file/DB writes inside that user's scope.

Plugins are SYSTEM-LEVEL — they ship with the deployment image, not
uploaded by end users. The reload endpoint is admin-gated.
"""
