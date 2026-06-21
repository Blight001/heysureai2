# -*- coding: utf-8 -*-
"""内置工坊引擎：按用户自动上线并提供专用 MCP 能力。

工坊不再是用户手动运行的独立 agent 进程，而是服务端内置的"虚拟端侧"：

- **自动上线**：``ensure_presence_for_user(user_id)`` 给每个账号写一条
  ``DevicePresence``（device_type="workshop"，always online）并默认
  放开 per-agent scope。该函数挂在 ``ensure_default_ai_for_user`` 上，
  用户登录/拉取 AI 列表时自动接入，作坊面板与社会显示随之出现工坊。
- **专用绑定保留**：AI 仍通过 ``WorkshopAiBinding`` 与工坊 1:1 绑定。
- **传承思想 MCP**：当前提供列表、详情查询和 Skill 包安装导入。
"""

import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from . import tools

logger = logging.getLogger(__name__)

_AGENT_ID_PREFIX = "workshop_builtin_"
_TOOLBOX_AGENT_ID_PREFIX = "toolbox_builtin_"
WORKSHOP_DISPLAY_NAME = "图书馆（内置）"
TOOLBOX_DISPLAY_NAME = "工具箱（内置）"
WORKSHOP_PLATFORM = "Workshop-Server"

_TOOL_HANDLERS = {
    "librarian.list_inheritance_thoughts": (
        "workshop.handlers",
        "list_inheritance_thoughts",
    ),
    "librarian.get_inheritance_thought": (
        "workshop.handlers",
        "get_inheritance_thought",
    ),
    "librarian.install_skill_package": (
        "workshop.handlers",
        "install_skill_package",
    ),
    "librarian.create_inheritance_thought": (
        "workshop.handlers",
        "create_inheritance_thought",
    ),
    "librarian.edit_inheritance_thought": (
        "workshop.handlers",
        "edit_inheritance_thought",
    ),
    "librarian.delete_inheritance_thought": (
        "workshop.handlers",
        "delete_inheritance_thought",
    ),
    "librarian.read_inheritance_skills": (
        "workshop.handlers",
        "read_inheritance_skills",
    ),
    "librarian.read_intrinsic_skills": (
        "workshop.handlers",
        "read_intrinsic_skills",
    ),
    "librarian.update_intrinsic_skills": (
        "workshop.handlers",
        "update_intrinsic_skills",
    ),
    "librarian.read_intrinsic_personas": (
        "workshop.handlers",
        "read_intrinsic_personas",
    ),
    "librarian.update_intrinsic_persona": (
        "workshop.handlers",
        "update_intrinsic_persona",
    ),
    "librarian.read_system_prompts": (
        "workshop.handlers",
        "read_system_prompts",
    ),
    "librarian.update_system_prompts": (
        "workshop.handlers",
        "update_system_prompts",
    ),
}

# 同进程内每用户 ensure 去抖：presence 写盘不必每个请求都做。
_ENSURE_TTL_SECONDS = 60.0
_last_ensure_at: Dict[int, float] = {}


def device_id_for_user(user_id) -> str:
    return f"{_AGENT_ID_PREFIX}{int(user_id)}"


def is_builtin_workshop_device_id(device_id) -> bool:
    return str(device_id or "").startswith(_AGENT_ID_PREFIX)


def toolbox_device_id_for_user(user_id) -> str:
    return f"{_TOOLBOX_AGENT_ID_PREFIX}{int(user_id)}"


def is_builtin_toolbox_device_id(device_id) -> bool:
    return str(device_id or "").startswith(_TOOLBOX_AGENT_ID_PREFIX)


def toolbox_capability_names() -> List[str]:
    """工具箱展示用的工具名：服务端固定工具中属于工具箱的部分（非图书馆绑定工具、
    且排除自省工具）。仅供展示，工具箱工具仍由常规服务端注册表提供，不经工坊分发。"""
    try:
        from mcp_runtime.mcp import registry
        from mcp_runtime.mcp.permissions import LIBRARY_BOUND_TOOLS, TOOLBOX_GATE_EXEMPT

        names = {str(t.get("name") or "").strip() for t in registry.list_tools() if t.get("name")}
        return sorted(
            n for n in names if n and n not in LIBRARY_BOUND_TOOLS and n not in TOOLBOX_GATE_EXEMPT
        )
    except Exception:
        return []


def library_capability_names() -> List[str]:
    """图书馆作坊展示用的工具名：注册表中需绑定图书馆的治理类工具（prompt / admin /
    device / knowledge.manage），与知识库「图书馆管理工具」(builtin.library_mcp) 同源。

    底层 ``librarian.*`` 是 ``knowledge.manage`` 的内部实现（仍用于工坊分发与
    ``capability_names()``），不在作坊「图书馆」详情里单独罗列，口径与知识库一致。"""
    try:
        from mcp_runtime.mcp import registry
        from mcp_runtime.mcp.permissions import LIBRARY_BOUND_TOOLS

        names = {str(t.get("name") or "").strip() for t in registry.list_tools() if t.get("name")}
        return sorted(n for n in names if n in LIBRARY_BOUND_TOOLS)
    except Exception:
        return []


def capability_names() -> List[str]:
    """工坊上报的工具名（强制限制在工坊命名空间，且必须有 handler）。"""
    return sorted(name for name in tools.TOOL_NAMES if name in _TOOL_HANDLERS)


def tool_defs_map() -> Dict[str, Dict[str, Any]]:
    """``{name: {description, input_schema}}``，供在线快照/工具目录展示。"""
    allowed = set(capability_names())
    out: Dict[str, Dict[str, Any]] = {}
    for raw in tools.TOOL_DEFS:
        name = str(raw.get("name") or "").strip()
        if name not in allowed:
            continue
        schema = raw.get("inputSchema")
        out[name] = {
            "description": str(raw.get("description") or "").strip(),
            "input_schema": schema if isinstance(schema, dict) else {},
        }
    return out


def ensure_presence_for_user(user_id) -> None:
    """确保该账号的内置工坊在线（presence + 默认放开的 scope）。

    幂等且 best-effort：失败只记日志，绝不影响调用方主流程。
    """
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return
    if uid <= 0:
        return
    now = time.time()
    if now - _last_ensure_at.get(uid, 0.0) < _ENSURE_TTL_SECONDS:
        return
    _last_ensure_at[uid] = now
    try:
        from api.device_mcp_permissions import get_scope, set_scope
        from api.device_presence import upsert_presence

        device_id = device_id_for_user(uid)
        caps = capability_names()
        upsert_presence(
            uid,
            device_id,
            None,
            "workshop",
            caps,
            online=True,
            tool_defs=tool_defs_map(),
        )
        # 内置工坊的工具范围默认放开：绑定才是访问门槛，且 capabilities
        # 已被限制在工坊命名空间内。仅在没有记录时写默认值，保留操作员
        # 之后在前端做的收窄。
        if get_scope(uid, device_id) is None:
            set_scope(uid, device_id, caps, ai_config_id=None, device_type="workshop")
    except Exception:
        _last_ensure_at.pop(uid, None)
        logger.exception("ensure builtin workshop presence failed user=%s", user_id)


def connected_entry_for_user(user_id) -> Dict[str, Any]:
    """作坊面板/社会显示用的虚拟"已连接设备"条目（始终在线）。

    1:1 绑定语义下把当前绑定的成员透出为 ``aiConfigId``，世界场景的
    悬浮提示与成员漫游区域据此联动。"""
    bound_cfg_id = None
    try:
        from api.workshop_bindings import bound_config_id_for_agent

        bound_cfg_id = bound_config_id_for_agent(user_id, device_id_for_user(user_id))
    except Exception:
        bound_cfg_id = None
    return {
        "id": device_id_for_user(user_id),
        "name": WORKSHOP_DISPLAY_NAME,
        "platform": WORKSHOP_PLATFORM,
        "isWorkshop": True,
        "aiConfigId": bound_cfg_id,
        "userId": int(user_id),
        # 作坊「图书馆」详情展示与知识库「图书馆管理工具」同一份治理 MCP；
        # librarian.* 作为 knowledge.manage 的内部实现不在此外显（仍由
        # capability_names() 用于工坊分发/presence，互不影响）。
        "capabilities": library_capability_names(),
        "version": "builtin",
        "lifecycle": "registered",
        "connectedAt": None,
        "lastSeenAt": time.time(),
        "lastTaskId": None,
        "lastTaskStatus": None,
        "lastTaskAt": None,
        "lastError": None,
        "source": "builtin",
        "dispatchable": True,
    }


def toolbox_connected_entry_for_user(user_id) -> Dict[str, Any]:
    """工具箱作坊的虚拟"已连接设备"条目（始终在线，多绑：默认绑定全部 AI）。

    工具箱不注册 presence、不经工坊分发——它只是一个绑定标记 + 展示条目；工具箱
    工具仍来自常规服务端注册表，由 core.py 按工具箱绑定逐次校验。"""
    bound_ids: List[int] = []
    try:
        from api.workshop_bindings import bound_config_ids_for_agent

        bound_ids = sorted(bound_config_ids_for_agent(user_id, toolbox_device_id_for_user(user_id)))
    except Exception:
        bound_ids = []
    return {
        "id": toolbox_device_id_for_user(user_id),
        "name": TOOLBOX_DISPLAY_NAME,
        "platform": WORKSHOP_PLATFORM,
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


def execute_tool(user_id: int, ai_config_id: Optional[int], tool: str, args: Optional[Dict[str, Any]]) -> Any:
    """执行一次工坊工具调用（policy 钩子 → 服务端 handler）。

    服务端复核（不信任调用上下文以外的任何声明）：
    工具白名单 → AI 归属 → 工坊绑定 → 角色最低权限。
    拒绝以 ``HTTPException`` 抛出，由调度层转为工具失败结果。
    """
    tool = str(tool or "").strip()
    spec = _TOOL_HANDLERS.get(tool)
    if spec is None or tool not in set(capability_names()):
        raise HTTPException(status_code=400, detail=f"'{tool}' is not a workshop tool")

    from sqlmodel import Session, select

    from api.database import engine as db_engine
    from api.models import AssistantAIConfig, User
    from api.workshop_bindings import workshop_device_ids_for_config

    if not ai_config_id:
        raise HTTPException(status_code=400, detail="ai_config_id is required for workshop tools")
    with Session(db_engine) as session:
        cfg = session.exec(
            select(AssistantAIConfig).where(
                AssistantAIConfig.id == int(ai_config_id),
                AssistantAIConfig.user_id == int(user_id),
            )
        ).first()
        if not cfg:
            raise HTTPException(status_code=404, detail="AI config not found")
        user = session.get(User, int(user_id))

    # 绑定是工坊工具的唯一门槛。
    if not workshop_device_ids_for_config(user_id, cfg.id):
        raise HTTPException(
            status_code=403,
            detail=f"AI config {cfg.id} 未绑定图书馆，无法调用 {tool}（在 AI 配置弹窗或世界中绑定）",
        )

    # 角色最低权限复核。
    from mcp_runtime.mcp.permissions import ROLE_RANK, config_role_tier, tool_min_role

    tier = config_role_tier(cfg)
    if ROLE_RANK.get(tier, 0) < ROLE_RANK.get(tool_min_role(tool), 0):
        raise HTTPException(status_code=403, detail=f"角色 {tier} 无权调用 {tool}")
    _ = user  # cfg 归属已校验；user 仅为未来策略扩展预留

    import importlib

    module_name, func_name = spec
    handler = getattr(importlib.import_module(module_name), func_name)

    return handler(int(user_id), dict(args or {}), int(cfg.id))
