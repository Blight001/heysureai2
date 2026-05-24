import os
import time
import contextvars
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ..core.config import USER_WORKSPACE_SUBFOLDERS, user_workspace_dir
from ..database import engine
from ..models import AIRuntimeStatus, AssistantAIConfig
from ..sio import sio

_MCP_RUNTIME_OVERRIDES: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar(
    "mcp_runtime_overrides",
    default=None,
)
_IGNORED_WORKSPACE_DIRS = {".git", "__pycache__", "venv", "node_modules", ".aider"}
def set_mcp_runtime_overrides(overrides: Optional[Dict[str, Any]]):
    return _MCP_RUNTIME_OVERRIDES.set(overrides or None)

def reset_mcp_runtime_overrides(token) -> None:
    _MCP_RUNTIME_OVERRIDES.reset(token)

def get_mcp_runtime_overrides() -> Optional[Dict[str, Any]]:
    return _MCP_RUNTIME_OVERRIDES.get()

def _resolve_ai_workspace(user_id: int, ai_config_id: Optional[int]) -> str:
    default_root = user_workspace_dir(user_id)
    runtime_overrides = get_mcp_runtime_overrides() or {}
    override_uid = runtime_overrides.get("user_id")
    override_cfg = runtime_overrides.get("ai_config_id")
    override_ws = str(runtime_overrides.get("workspace_root") or "").strip()
    if (
        override_ws
        and (override_uid is None or int(override_uid) == int(user_id))
        and (override_cfg is None or int(override_cfg) == int(ai_config_id or 0))
    ):
        if override_ws == ".":
            return default_root
        if os.path.isabs(override_ws):
            return os.path.abspath(override_ws)
        return os.path.abspath(os.path.join(default_root, override_ws))

    if not ai_config_id:
        return default_root
    with Session(engine) as session:
        cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.user_id == user_id,
                AssistantAIConfig.id == ai_config_id,
            )
        ).first()
    if not cfg or not cfg.workspace_root:
        return default_root
    raw = cfg.workspace_root.strip()
    if not raw:
        return default_root
    if os.path.isabs(raw):
        return os.path.abspath(raw)
    return os.path.abspath(os.path.join(default_root, raw))

def get_project_root(user_id: int, ai_config_id: Optional[int] = None) -> str:
    workspace_dir = _resolve_ai_workspace(user_id, ai_config_id)

    if not os.path.exists(workspace_dir):
        os.makedirs(workspace_dir, exist_ok=True)
        for folder in USER_WORKSPACE_SUBFOLDERS:
            os.makedirs(os.path.join(workspace_dir, folder), exist_ok=True)

    return workspace_dir

def safe_join(root: str, *paths: str) -> str:
    abs_root = os.path.abspath(root)
    joined = os.path.abspath(os.path.join(abs_root, *paths))
    if not joined.startswith(abs_root):
        raise HTTPException(status_code=403, detail="Access denied: path outside workspace")
    return joined

def generate_file_tree(path: str, prefix: str = "") -> str:
    tree_str = ""
    try:
        if not os.path.exists(path):
            return "Path not found\n"
        items = sorted(os.listdir(path))
        items = [i for i in items if i not in [".git", "__pycache__", "venv", "node_modules", ".aider"]]

        for i, item in enumerate(items):
            is_last = i == len(items) - 1
            connector = "└── " if is_last else "├── "
            tree_str += f"{prefix}{connector}{item}\n"

            full_path = os.path.join(path, item)
            if os.path.isdir(full_path):
                new_prefix = prefix + ("    " if is_last else "│   ")
                tree_str += generate_file_tree(full_path, new_prefix)
    except Exception as exc:
        tree_str += f"{prefix}Error: {str(exc)}\n"
    return tree_str

@dataclass
class MCPTool:
    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: Callable[[int, Dict[str, Any], Optional[int]], Any]
    destructive: bool = False

class MCPRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, MCPTool] = {}

    def register(self, tool: MCPTool) -> None:
        self._tools[tool.name] = tool

    def list_tools(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": tool.input_schema,
                "destructive": tool.destructive,
            }
            for tool in self._tools.values()
        ]

    def build_tools_payload(self, allowed_tools: Optional[set] = None) -> List[Dict[str, Any]]:
        tools = []
        for tool in self._tools.values():
            if allowed_tools is not None and tool.name not in allowed_tools:
                continue
            tools.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                },
            })
        return tools

    def has(self, name: str) -> bool:
        return name in self._tools

    def get(self, name: str) -> MCPTool:
        tool = self._tools.get(name)
        if not tool:
            raise HTTPException(status_code=404, detail=f"Unknown MCP tool: {name}")
        return tool

    async def call(
        self,
        name: str,
        user_id: int,
        arguments: Optional[Dict[str, Any]] = None,
        ai_config_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        tool = self.get(name)
        args = arguments or {}
        await _set_runtime_status(user_id, ai_config_id, "running", tool.name)
        await sio.emit(
            "mcp:status",
            {
                "userId": user_id,
                "aiConfigId": ai_config_id,
                "state": "running",
                "tool": tool.name,
                "updatedAt": time.time(),
            },
            room=f"user_{user_id}",
        )
        try:
            result = tool.handler(user_id, args, ai_config_id)
            if hasattr(result, "__await__"):
                result = await result
            payload = {
                "tool": tool.name,
                "destructive": tool.destructive,
                "result": result,
            }
            # Keep the latest tool name on idle so dashboard cards can show
            # "最近 MCP" even after the call finishes.
            await _set_runtime_status(user_id, ai_config_id, "idle", tool.name)
            await sio.emit(
                "mcp:status",
                {
                    "userId": user_id,
                    "aiConfigId": ai_config_id,
                    "state": "idle",
                    "tool": tool.name,
                    "updatedAt": time.time(),
                },
                room=f"user_{user_id}",
            )
            return payload
        except Exception:
            await _set_runtime_status(user_id, ai_config_id, "error", tool.name)
            await sio.emit(
                "mcp:status",
                {
                    "userId": user_id,
                    "aiConfigId": ai_config_id,
                    "state": "error",
                    "tool": tool.name,
                    "updatedAt": time.time(),
                },
                room=f"user_{user_id}",
            )
            raise

async def _set_runtime_status(user_id: int, ai_config_id: Optional[int], status: str, tool: str) -> None:
    with Session(engine) as session:
        row = session.exec(
            select(AIRuntimeStatus).where(
                AIRuntimeStatus.user_id == user_id,
                AIRuntimeStatus.ai_config_id == ai_config_id,
                AIRuntimeStatus.ai_kind == "assistant",
            )
        ).first()
        if not row:
            row = AIRuntimeStatus(
                user_id=user_id,
                ai_config_id=ai_config_id,
                ai_kind="assistant",
            )
        row.current_status = status
        row.current_mcp_tool = tool
        row.updated_at = time.time()
        session.add(row)
        session.commit()
