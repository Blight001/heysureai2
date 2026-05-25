IS_ROUTER_ENTRY = False

import threading
from typing import Dict

from fastapi import APIRouter

router = APIRouter()
PREFIX = "/api/chat"
STATE_PREFIX = "__HS_MCP_STATE__="

_RUN_THREADS: Dict[str, threading.Thread] = {}
_RUN_LIVE_STATE: Dict[str, Dict[str, object]] = {}
_RUN_STATE_LOCK = threading.Lock()
MAX_AUTO_SUPERVISION_ROUNDS = 2
_AUTO_RUNTIME_SECTION_TITLES: tuple[str, ...] = (
    "AI 工作目录",
    "AI 数据库连接",
    "任务运行时工作目录(绝对路径)",
    "任务运行时MCP调用规则",
    "任务运行时MCP工具白名单",
)
_TASK_RUNTIME_SECTION_TITLES: tuple[str, ...] = (
    "任务运行时工作目录(绝对路径)",
    "任务运行时MCP调用规则",
    "任务运行时MCP工具白名单",
)
_TASK_CREATE_TOOL_NAMES: set[str] = {
    "task.create",
}
