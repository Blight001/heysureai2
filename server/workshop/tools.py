# -*- coding: utf-8 -*-
"""Built-in workshop MCP tool catalog."""

TOOL_DEFS = [
    {
        "name": "librarian.list_inheritance_thoughts",
        "description": (
            "获取当前用户知识工坊中已安装的传承思想列表。"
            "返回每条思想的 ID、名称、摘要、版本、来源和本地可用状态；"
            "需要正文时再调用 librarian.get_inheritance_thought。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        "destructive": False,
    },
    {
        "name": "librarian.get_inheritance_thought",
        "description": (
            "按传承思想 ID 获取一条已安装思想的完整详情，包括 SKILL.md 正文、"
            "安装元数据、本地路径和可用状态。ID 来自 librarian.list_inheritance_thoughts。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "传承思想 ID，即列表返回的 id 字段。",
                },
            },
            "required": ["id"],
            "additionalProperties": False,
        },
        "destructive": False,
    },
    {
        "name": "librarian.install_skill_package",
        "description": (
            "通过 npx skills add <包名> -g -y 安装 Skill，并自动把本次新增或更新的"
            "全局 Skill 快照导入当前用户的传承思想。一个包包含多个 Skill 时会全部导入。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "package": {
                    "type": "string",
                    "description": "skills CLI 支持的包来源，例如 owner/repo 或完整 Git URL。",
                },
                "timeout": {
                    "type": "integer",
                    "minimum": 30,
                    "maximum": 600,
                    "description": "安装超时秒数，默认 300。",
                },
            },
            "required": ["package"],
            "additionalProperties": False,
        },
        "destructive": True,
    },
]

TOOL_NAMES = [item["name"] for item in TOOL_DEFS]
