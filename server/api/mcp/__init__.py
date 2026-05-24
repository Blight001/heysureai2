"""MCP (Model Context Protocol) subsystem.

Layout:
- core         — MCPTool / MCPRegistry primitives, workspace path helpers,
                 runtime overrides, runtime status emitter.
- registry     — singleton ``registry`` populated with every built-in tool.
- permissions  — per-role allow-list policy.
- tools.*      — concrete handlers, grouped by domain (workspace, tasks,
                 projects, prompts, memory, communication, human, librarian).

External callers should keep importing from ``api.mcp`` (this package) for
the small public surface re-exported below; reach into ``api.mcp.core`` /
``api.mcp.permissions`` only when they need internals.
"""

from .core import (
    MCPRegistry,
    MCPTool,
    generate_file_tree,
    get_mcp_runtime_overrides,
    get_project_root,
    reset_mcp_runtime_overrides,
    safe_join,
    set_mcp_runtime_overrides,
)
from .registry import registry

__all__ = [
    "MCPRegistry",
    "MCPTool",
    "generate_file_tree",
    "get_mcp_runtime_overrides",
    "get_project_root",
    "registry",
    "reset_mcp_runtime_overrides",
    "safe_join",
    "set_mcp_runtime_overrides",
]
