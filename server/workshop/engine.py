# -*- coding: utf-8 -*-
"""内置工坊引擎：按用户自动上线 + 进程内执行知识/进化工具。

工坊不再是用户手动运行的独立 agent 进程，而是服务端内置的"虚拟端侧"：

- **自动上线**：``ensure_presence_for_user(user_id)`` 给每个账号写一条
  ``EndpointAgentPresence``（agent_type="workshop"，always online）并默认
  放开 per-agent scope。该函数挂在 ``ensure_default_ai_for_user`` 上，
  用户登录/拉取 AI 列表时自动接入，作坊面板与社会显示随之出现工坊。
- **绑定仍是唯一门槛**：AI 须经 ``WorkshopAiBinding``（AI 配置弹窗勾选或
  世界里拖拽）绑定工坊后才能看到/调用 ``librarian.*`` / ``evolution.*``。
- **进程内执行**：调用经 ``agent_dispatch`` 的 workshop 分支直达
  :func:`execute_tool` ——policy 钩子 → 服务端 handler，无 socket 往返。

安全边界：execute_tool 在服务端复核工具白名单、AI 归属、绑定关系与
角色最低权限；capabilities 被限制在工坊命名空间内。
"""

import logging
import time
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from . import policy, tools

logger = logging.getLogger(__name__)

_AGENT_ID_PREFIX = "workshop_builtin_"
WORKSHOP_DISPLAY_NAME = "知识工坊（内置）"
WORKSHOP_PLATFORM = "Workshop-Server"

# 工具白名单：工坊可执行的全部工具 → 服务端 handler（数据真相源）。
_TOOL_HANDLERS = {
    "librarian.propose": ("mcp_runtime.mcp.tools.librarian", "_librarian_propose"),
    "librarian.consult": ("mcp_runtime.mcp.tools.librarian", "_librarian_consult"),
    "librarian.list_topics": ("mcp_runtime.mcp.tools.librarian", "_librarian_list_topics"),
    "librarian.read": ("mcp_runtime.mcp.tools.librarian", "_librarian_read"),
    "librarian.archive": ("mcp_runtime.mcp.tools.librarian", "_librarian_archive"),
    "evolution.input": ("mcp_runtime.mcp.tools.evolution", "_evolution_input"),
    "evolution.list": ("mcp_runtime.mcp.tools.evolution", "_evolution_list"),
    "evolution.review": ("mcp_runtime.mcp.tools.evolution", "_evolution_review"),
}

# 同进程内每用户 ensure 去抖：presence 写盘不必每个请求都做。
_ENSURE_TTL_SECONDS = 60.0
_last_ensure_at: Dict[int, float] = {}


def agent_id_for_user(user_id) -> str:
    return f"{_AGENT_ID_PREFIX}{int(user_id)}"


def is_builtin_workshop_agent_id(agent_id) -> bool:
    return str(agent_id or "").startswith(_AGENT_ID_PREFIX)


def capability_names() -> List[str]:
    """工坊上报的工具名（强制限制在工坊命名空间，且必须有 handler）。"""
    return sorted(
        name for name in tools.TOOL_NAMES
        if str(name).startswith(("librarian.", "evolution.")) and name in _TOOL_HANDLERS
    )


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
        from api.agent_mcp_permissions import get_scope, set_scope
        from api.agent_presence import upsert_presence

        agent_id = agent_id_for_user(uid)
        caps = capability_names()
        upsert_presence(
            uid,
            agent_id,
            None,
            "workshop",
            caps,
            online=True,
            tool_defs=tool_defs_map(),
        )
        # 内置工坊的工具范围默认放开：绑定才是访问门槛，且 capabilities
        # 已被限制在工坊命名空间内。仅在没有记录时写默认值，保留操作员
        # 之后在前端做的收窄。
        if get_scope(uid, agent_id) is None:
            set_scope(uid, agent_id, caps, ai_config_id=None, agent_type="workshop")
    except Exception:
        _last_ensure_at.pop(uid, None)
        logger.exception("ensure builtin workshop presence failed user=%s", user_id)


def connected_entry_for_user(user_id) -> Dict[str, Any]:
    """作坊面板/社会显示用的虚拟"已连接设备"条目（始终在线）。"""
    return {
        "id": agent_id_for_user(user_id),
        "name": WORKSHOP_DISPLAY_NAME,
        "platform": WORKSHOP_PLATFORM,
        "isWorkshop": True,
        "aiConfigId": None,
        "userId": int(user_id),
        "capabilities": capability_names(),
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
    from api.workshop_bindings import workshop_agent_ids_for_config

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
    if not workshop_agent_ids_for_config(user_id, cfg.id):
        raise HTTPException(
            status_code=403,
            detail=f"AI config {cfg.id} 未绑定知识工坊，无法调用 {tool}（在 AI 配置弹窗或世界中绑定）",
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

    shaped_args = policy.before_execute(tool, dict(args or {}))
    result = handler(int(user_id), shaped_args, int(cfg.id))
    return policy.after_execute(tool, shaped_args, result)
