"""MCP (Model Context Protocol) subsystem.

Layout:
- core         — MCPTool / MCPRegistry primitives, workspace path helpers,
                 runtime status emitter.
- registry     — singleton ``registry`` populated with every built-in tool.
- permissions  — per-role allow-list policy.
- tools.*      — concrete handlers, grouped by domain (workspace, tasks,
                 prompts, communication, and conversation).

External callers should keep importing from ``mcp_runtime.mcp`` (this package) for
the small public surface re-exported below; reach into ``mcp_runtime.mcp.core`` /
``mcp_runtime.mcp.permissions`` only when they need internals.
"""

from .core import (
    MCPRegistry,
    MCPTool,
    generate_file_tree,
    get_project_root,
    safe_join,
)
from .registry import registry

__all__ = [
    "MCPRegistry",
    "MCPTool",
    "generate_file_tree",
    "get_project_root",
    "registry",
    "safe_join",
]
