"""Hot-reload entry for the MCP tool registry.

Goal: let a deployer drop new code into ``api/mcp/tools/`` or
``api/mcp/plugins/`` and pick it up at runtime without restarting the
process. Reload is admin-level — never expose this to end users.

Flow:
1. ``importlib.reload`` every module under ``api.mcp.tools`` so handler
   bodies pick up source changes.
2. Build a fresh ``MCPRegistry`` and call ``_register_builtin_tools`` on
   it (the function from ``api.mcp.registry``).
3. Discover ``api/mcp/plugins/*.py`` and call each module's ``register``
   function, passing the fresh registry. Plugin files are imported (or
   reloaded if already loaded) for each call so source changes take
   effect.
4. On success, swap ``registry._tools`` in place via ``replace_tools``
   so existing references (held by ``chat_worker``, routers, etc.)
   see the new tool set without needing to be re-bound.

On failure at any step before the swap, the live registry is untouched.
"""

from __future__ import annotations

import importlib
import os
import pkgutil
import sys
import traceback
from typing import Any, Dict, List

from .core import MCPRegistry


_PLUGINS_PACKAGE = "api.mcp.plugins"
_TOOLS_PACKAGE = "api.mcp.tools"
_REGISTRY_MODULE = "api.mcp.registry"


def _iter_tool_modules() -> List[str]:
    """Return fully-qualified names of every module under api.mcp.tools."""
    try:
        tools_pkg = importlib.import_module(_TOOLS_PACKAGE)
    except Exception:
        return []
    names: List[str] = []
    for info in pkgutil.iter_modules(tools_pkg.__path__):
        names.append(f"{_TOOLS_PACKAGE}.{info.name}")
    return names


def _iter_plugin_modules() -> List[str]:
    """Return fully-qualified names of every plugin under api.mcp.plugins."""
    try:
        pkg = importlib.import_module(_PLUGINS_PACKAGE)
    except Exception:
        return []
    names: List[str] = []
    for info in pkgutil.iter_modules(pkg.__path__):
        if info.ispkg:
            continue
        names.append(f"{_PLUGINS_PACKAGE}.{info.name}")
    return names


def _reload_module(mod_name: str) -> None:
    if mod_name in sys.modules:
        importlib.reload(sys.modules[mod_name])
    else:
        importlib.import_module(mod_name)


def reload_registry() -> Dict[str, Any]:
    """Rebuild the live MCP registry from source. Returns a status payload.

    Returns:
        {
            "ok": bool,
            "version": int,                 # new version after reload
            "tools": int,                   # number of tools after reload
            "plugin_errors": [{...}],       # per-plugin failures (non-fatal)
            "error": Optional[str],         # set when ok=False
        }
    """
    # Late imports keep this module light to import on cold start; ``registry``
    # is the live singleton object whose ``_tools`` table we swap.
    from . import registry as registry_module

    plugin_errors: List[Dict[str, Any]] = []
    try:
        for mod_name in _iter_tool_modules():
            try:
                _reload_module(mod_name)
            except Exception as exc:
                # If a tool module fails to reload, treat it as fatal — the
                # builtin tool set must remain coherent.
                return {
                    "ok": False,
                    "version": registry_module.registry.version,
                    "tools": len(registry_module.registry._tools),
                    "plugin_errors": [],
                    "error": f"tool module {mod_name}: {exc}",
                }

        # Bring the registration function back into scope after tool reloads.
        _reload_module(_REGISTRY_MODULE)
        register_fn = getattr(sys.modules[_REGISTRY_MODULE], "_register_builtin_tools")

        fresh = MCPRegistry()
        register_fn(fresh)

        for plugin_name in _iter_plugin_modules():
            try:
                _reload_module(plugin_name)
                plugin_mod = sys.modules[plugin_name]
                register = getattr(plugin_mod, "register", None)
                if register is None:
                    continue
                register(fresh)
            except Exception as exc:
                # Plugin errors are isolated: keep the rest of the load going.
                plugin_errors.append({
                    "plugin": plugin_name,
                    "error": str(exc),
                    "traceback": traceback.format_exc(limit=4),
                })

        registry_module.registry.replace_tools(fresh._tools)

        return {
            "ok": True,
            "version": registry_module.registry.version,
            "tools": len(registry_module.registry._tools),
            "plugin_errors": plugin_errors,
            "error": None,
        }
    except Exception as exc:
        return {
            "ok": False,
            "version": registry_module.registry.version,
            "tools": len(registry_module.registry._tools),
            "plugin_errors": plugin_errors,
            "error": f"reload failed: {exc}",
        }


def load_plugins_on_startup() -> Dict[str, Any]:
    """Best-effort plugin discovery on first boot.

    Builtin tools are already loaded via ``registry`` import. This adds any
    plugins under ``api/mcp/plugins/`` to the live registry without bumping
    the version artificially when there are zero plugins.
    """
    from . import registry as registry_module

    plugin_errors: List[Dict[str, Any]] = []
    loaded = 0

    for plugin_name in _iter_plugin_modules():
        try:
            _reload_module(plugin_name)
            plugin_mod = sys.modules[plugin_name]
            register = getattr(plugin_mod, "register", None)
            if register is None:
                continue
            register(registry_module.registry)
            loaded += 1
        except Exception as exc:
            plugin_errors.append({
                "plugin": plugin_name,
                "error": str(exc),
                "traceback": traceback.format_exc(limit=4),
            })

    return {
        "loaded": loaded,
        "version": registry_module.registry.version,
        "tools": len(registry_module.registry._tools),
        "plugin_errors": plugin_errors,
    }
