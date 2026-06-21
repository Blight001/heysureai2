# -*- coding: utf-8 -*-
"""内置「工具箱」引擎：默认全绑、按绑定门禁放行的服务端固定工具集。

工具箱与图书馆（``workshop.engine``）是两个并列的服务端内置"虚拟端侧"，但二者
形态不同：

- **图书馆**：1:1 绑定、注册 ``DevicePresence``、自带 handler，工具经工坊分发。
- **工具箱**：多绑（默认绑定该用户全部 AI、用户不可解绑），**不注册 presence、
  不经工坊分发**——它只是一个绑定标记 + 展示条目；工具箱工具仍来自常规服务端
  注册表（``MCPRegistry``），由 ``mcp_runtime`` 在每次调用时按工具箱绑定逐项校验。

本模块收拢工具箱设备的全部自有逻辑：身份/展示、能力清单、绑定读写、以及"哪些
工具属于工具箱（需绑定）"的门禁判定。中央权限层与注册表核心只调用这里，不再内联
工具箱特例。
"""

import logging
import time
from typing import Any, Dict, Iterable, List, Optional, Set

logger = logging.getLogger(__name__)

_TOOLBOX_AGENT_ID_PREFIX = "toolbox_builtin_"
TOOLBOX_DISPLAY_NAME = "工具箱（内置）"
TOOLBOX_PLATFORM = "Workshop-Server"

# 工具箱门禁豁免：自省工具始终可用，避免未绑定时连工具说明都查不了。
TOOLBOX_GATE_EXEMPT: Set[str] = {"mcp.describe_tool"}


# ---------------------------------------------------------------------------
# 身份
# ---------------------------------------------------------------------------
def toolbox_device_id_for_user(user_id) -> str:
    return f"{_TOOLBOX_AGENT_ID_PREFIX}{int(user_id)}"


def is_builtin_toolbox_device_id(device_id) -> bool:
    return str(device_id or "").startswith(_TOOLBOX_AGENT_ID_PREFIX)


# ---------------------------------------------------------------------------
# 门禁：哪些服务端固定工具属于「工具箱」（需绑定工具箱才能由 AI 调用）
# ---------------------------------------------------------------------------
def _library_bound_tools() -> Set[str]:
    """图书馆绑定制工具集合（治理类）。工具箱 = 服务端固定工具中除此之外的部分。"""
    try:
        from mcp_runtime.mcp.permissions import LIBRARY_BOUND_TOOLS

        return set(LIBRARY_BOUND_TOOLS)
    except Exception:
        return set()


def is_toolbox_gated_tool(tool_name: str) -> bool:
    """该工具是否属于「工具箱」（需绑定工具箱才能由 AI 调用）。

    仅服务端固定工具会经 ``MCPRegistry.call``；其中非图书馆绑定、非自省的即工具箱
    工具。端侧/工坊工具走各自分发，不经此判定。"""
    name = str(tool_name or "").strip()
    return bool(name) and name not in _library_bound_tools() and name not in TOOLBOX_GATE_EXEMPT


def toolbox_tool_names(all_tool_names: Iterable[str]) -> Set[str]:
    """「工具箱」工具：服务端固定工具中除图书馆绑定工具外的其余部分。"""
    library = _library_bound_tools()
    return {str(name).strip() for name in all_tool_names if str(name).strip() not in library}


def toolbox_capability_names() -> List[str]:
    """工具箱展示用的工具名：服务端固定工具中属于工具箱的部分（非图书馆绑定工具、
    且排除自省工具）。仅供展示，工具箱工具仍由常规服务端注册表提供，不经工坊分发。"""
    try:
        from mcp_runtime.mcp import registry

        names = {str(t.get("name") or "").strip() for t in registry.list_tools() if t.get("name")}
        library = _library_bound_tools()
        return sorted(n for n in names if n and n not in library and n not in TOOLBOX_GATE_EXEMPT)
    except Exception:
        return []


# ---------------------------------------------------------------------------
# 绑定（多绑：默认绑定全部 AI、用户不可解绑）
# ---------------------------------------------------------------------------
def config_bound_to_toolbox(user_id, ai_config_id) -> bool:
    from api.workshop_bindings import config_bound_to_device

    return config_bound_to_device(user_id, ai_config_id, toolbox_device_id_for_user(user_id))


def bind_config_to_toolbox(user_id, ai_config_id) -> bool:
    """把单个 AI 绑定到工具箱（多绑）。用于 AI 创建时默认绑定。"""
    from api.workshop_bindings import set_workshop_binding

    return set_workshop_binding(
        user_id, toolbox_device_id_for_user(user_id), ai_config_id, bound=True, single=False
    )


def ensure_all_configs_bound_to_toolbox(user_id) -> int:
    """自愈：确保该用户全部 AI 都绑定工具箱（仅补缺失的绑定行）。

    工具箱是"默认全绑、用户不可解绑"的内置作坊（无任何解绑入口），因此重复补绑
    是安全的、幂等的——补回因创建时 best-effort 绑定失败、或经其它创建路径而漏绑
    的 AI，使其不被工具箱门禁挡在默认工具集之外。返回新增绑定数。
    """
    from api.workshop_bindings import bind_all_configs_to_device

    return bind_all_configs_to_device(user_id, toolbox_device_id_for_user(user_id))


# ---------------------------------------------------------------------------
# 展示条目
# ---------------------------------------------------------------------------
def toolbox_connected_entry_for_user(user_id) -> Dict[str, Any]:
    """工具箱作坊的虚拟"已连接设备"条目（始终在线，多绑：默认绑定全部 AI）。

    工具箱不注册 presence、不经工坊分发——它只是一个绑定标记 + 展示条目；工具箱
    工具仍来自常规服务端注册表，由 mcp_runtime 按工具箱绑定逐次校验。"""
    bound_ids: List[int] = []
    try:
        from api.workshop_bindings import bound_config_ids_for_agent

        bound_ids = sorted(bound_config_ids_for_agent(user_id, toolbox_device_id_for_user(user_id)))
    except Exception:
        bound_ids = []
    return {
        "id": toolbox_device_id_for_user(user_id),
        "name": TOOLBOX_DISPLAY_NAME,
        "platform": TOOLBOX_PLATFORM,
        "isWorkshop": True,
        "isToolbox": True,
        "aiConfigId": None,
        "boundAiConfigIds": bound_ids,
        "userId": int(user_id),
        "capabilities": toolbox_capability_names(),
        "version": "builtin",
        "lifecycle": "registered",
        "connectedAt": None,
        "lastSeenAt": time.time(),
        "lastTaskId": None,
        "lastTaskStatus": None,
        "lastTaskAt": None,
        "lastError": None,
        "source": "builtin",
        "dispatchable": False,
    }


def enforce_toolbox_binding(tool_name: str, user_id: int, ai_config_id: Optional[int]) -> None:
    """工具箱绑定门禁：工具箱工具需绑定工具箱。

    没有 ``ai_config_id`` 视为核心 / 管理员直调，放行；自省工具始终放行。非工具箱
    工具（图书馆/端侧/工坊）不在本判定内。拒绝以 ``HTTPException`` 抛出。"""
    if not ai_config_id:
        return
    if not is_toolbox_gated_tool(tool_name):
        return
    if not config_bound_to_toolbox(user_id, ai_config_id):
        from fastapi import HTTPException

        raise HTTPException(
            status_code=403,
            detail=f"该 AI 未绑定工具箱，无法调用 {tool_name}（请在 AI 配置或世界中绑定工具箱）",
        )
