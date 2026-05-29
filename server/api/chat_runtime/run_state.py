"""Chat-run shared state primitives.

Holds the in-process registries that follow a chat run across boundaries:
- ``_RUN_THREADS``       — worker thread by run_id (gateway, ai_runtime, connector bots all touch it)
- ``_RUN_LIVE_STATE``    — streaming token / phase snapshot, polled by HTTP and Socket.IO
- ``_RUN_LIVE_META``     — per-run metadata side-channel (run start ts, etc.)
- ``_RUN_STATE_LOCK``    — guards both live dicts under concurrent access
- ``STATE_PREFIX``       — sentinel prepended to MCP state payloads embedded in stream
- ``MAX_AUTO_SUPERVISION_ROUNDS`` — auto-supervision turn cap
- ``_AUTO_RUNTIME_SECTION_TITLES`` / ``_TASK_RUNTIME_SECTION_TITLES`` — prompt section
  titles the inference loop injects/strips around tool calls
- ``_TASK_CREATE_TOOL_NAMES`` — tool names that mark "this run kicked off a new task"

Lives under ``api.chat_runtime`` because the registries are infrastructure
shared by every process role (gateway routes, ai_runtime inference loop,
connector_runtime bot routers). HTTP-specific glue (``router = APIRouter()``)
stays with the chat router cluster.
"""

import threading
from typing import Dict


STATE_PREFIX = "__HS_MCP_STATE__="

_RUN_THREADS: Dict[str, threading.Thread] = {}
_RUN_LIVE_STATE: Dict[str, Dict[str, object]] = {}
_RUN_LIVE_META: Dict[str, Dict[str, object]] = {}
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
