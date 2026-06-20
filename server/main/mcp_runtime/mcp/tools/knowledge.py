"""``knowledge.manage`` — unified knowledge-base (knowledge workshop) tool.

The knowledge base (传承思想 / 内置技能 / 内置人格 / 系统 prompt) is served by the
built-in knowledge workshop, whose tools live under the ``librarian.*`` namespace
and execute through ``workshop.engine.execute_tool`` (which enforces both the
workshop binding and the per-action minimum role). This facade exposes a single
registry tool that dispatches an ``action`` to the matching ``librarian.*`` tool,
so an AI sees one consolidated entry instead of 13 scattered ones while all the
existing gates stay in force.
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException


# Unified action → underlying workshop ``librarian.*`` tool name.
_KNOWLEDGE_ACTIONS = {
    # 传承思想（inheritance thoughts / skill packages）
    "list_thoughts": "librarian.list_inheritance_thoughts",
    "get_thought": "librarian.get_inheritance_thought",
    "create_thought": "librarian.create_inheritance_thought",
    "edit_thought": "librarian.edit_inheritance_thought",
    "delete_thought": "librarian.delete_inheritance_thought",
    "install_skill_package": "librarian.install_skill_package",
    # 内置知识类目（read-only / 受限写）
    "read_inheritance_skills": "librarian.read_inheritance_skills",
    "read_skills": "librarian.read_intrinsic_skills",
    "update_skills": "librarian.update_intrinsic_skills",
    "read_personas": "librarian.read_intrinsic_personas",
    "update_persona": "librarian.update_intrinsic_persona",
    "read_system_prompts": "librarian.read_system_prompts",
    "update_system_prompts": "librarian.update_system_prompts",
}

_KNOWLEDGE_ACTION_ALIASES = {
    "list": "list_thoughts",
    "get": "get_thought",
    "create": "create_thought",
    "edit": "edit_thought",
    "delete": "delete_thought",
    "install": "install_skill_package",
}


def _knowledge_manage(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Any:
    """Dispatch ``action`` to the matching workshop ``librarian.*`` tool.

    Action-specific parameters may be passed either at the top level or nested
    under ``params``; both are merged (top-level wins) and forwarded to the
    workshop handler, which re-checks the workshop binding and minimum role.
    """
    from workshop import engine as workshop_engine

    raw = str((args or {}).get("action") or "").strip().lower()
    action = _KNOWLEDGE_ACTION_ALIASES.get(raw, raw)
    if not action:
        raise HTTPException(status_code=400, detail="action is required for knowledge.manage")
    tool = _KNOWLEDGE_ACTIONS.get(action)
    if tool is None:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported action: {action}. 可用: {', '.join(sorted(_KNOWLEDGE_ACTIONS))}",
        )

    sub_args: Dict[str, Any] = {}
    nested = (args or {}).get("params")
    if isinstance(nested, dict):
        sub_args.update(nested)
    for key, value in (args or {}).items():
        if key in ("action", "params"):
            continue
        sub_args[key] = value

    return workshop_engine.execute_tool(int(user_id), ai_config_id, tool, sub_args)


KNOWLEDGE_MANAGE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": sorted(_KNOWLEDGE_ACTIONS),
            "description": (
                "操作类型（知识库 / 知识工坊）：\n"
                "- list_thoughts 列出传承思想；get_thought 读取某条传承思想正文；\n"
                "- create_thought 新建传承思想；edit_thought 按行编辑；delete_thought 删除（需管理者+）；\n"
                "- install_skill_package 安装 Skill 包（需管理者+）；\n"
                "- read_inheritance_skills / read_skills / read_personas / read_system_prompts 读取内置类目；\n"
                "- update_skills / update_system_prompts（需辅助管理员+）、update_persona（需管理者+）改写内置类目。\n"
                "需要该 AI 已绑定知识工坊。各 action 的具体参数可放在 params 对象或直接平铺在顶层。"
            ),
        },
        "params": {
            "type": "object",
            "description": "所选 action 对应知识库工具的参数（也可直接平铺在顶层）。如 get_thought 需 id；edit_thought 需 id 与行编辑字段。",
        },
        "id": {"type": "string", "description": "get_thought/edit_thought/delete_thought 等的目标条目 id。"},
        "title": {"type": "string", "description": "create_thought 的标题。"},
        "text": {"type": "string", "description": "正文/写入文本（按所选 action 含义使用）。"},
    },
    "required": ["action"],
}
