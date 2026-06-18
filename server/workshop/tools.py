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
            "endpoint_kind 按端归类：any=通用、desktop=桌面端专属、browser=浏览器端专属；"
            "不传则按当前绑定的端侧作坊自动判断，判断不出归为 any。"
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
                "endpoint_kind": {
                    "type": "string",
                    "enum": ["any", "desktop", "browser"],
                    "description": (
                        "端归类：any=通用、desktop=桌面端专属、browser=浏览器端专属。"
                        "省略则按安装成员当前绑定的端侧作坊自动推断。"
                    ),
                },
            },
            "required": ["package"],
            "additionalProperties": False,
        },
        "destructive": True,
    },
    {
        "name": "librarian.create_inheritance_thought",
        "description": (
            "主动创建一条传承思想：直接写 SKILL.md 正文落本地快照并登记到传承思想库"
            "（不走 ClawHub/npx 安装，来源标记 manual）。"
            "endpoint_kind 按端归类：any=通用、desktop=桌面端专属、browser=浏览器端专属；"
            "不传则按当前绑定的端侧作坊自动推断。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "传承思想名称（即 Skill 名）。"},
                "content": {
                    "type": "string",
                    "description": "SKILL.md 正文；不含 frontmatter 时会自动补 name/description 头。",
                },
                "summary": {"type": "string", "description": "一句话摘要（可选；作为 description）。"},
                "endpoint_kind": {
                    "type": "string",
                    "enum": ["any", "desktop", "browser"],
                    "description": (
                        "端归类：any=通用、desktop=桌面端专属、browser=浏览器端专属。"
                        "省略则按创建成员当前绑定的端侧作坊自动推断。"
                    ),
                },
            },
            "required": ["name", "content"],
            "additionalProperties": False,
        },
        "destructive": True,
    },
    {
        "name": "librarian.edit_inheritance_thought",
        "description": (
            "按行编辑一条传承思想的 SKILL.md，并/或改端（endpoint_kind）。"
            "编辑正文：先调用 librarian.get_inheritance_thought 获取 lines、line_count、"
            "content_sha256，再基于行号提交一个 edit 或 edits 批次。"
            "改端：传 endpoint_kind（any 通用 / desktop 桌面端 / browser 浏览器端）即可，"
            "可与行编辑同时进行，也可只改端不动正文。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "传承思想 ID。"},
                "endpoint_kind": {
                    "type": "string",
                    "enum": ["any", "desktop", "browser"],
                    "description": "改端目标：any 通用 / desktop 桌面端 / browser 浏览器端（可选）。",
                },
                "expected_sha256": {
                    "type": "string",
                    "description": "读取时返回的 content_sha256；内容已变化时拒绝编辑。",
                },
                "mode": {
                    "type": "string",
                    "enum": [
                        "replace_line", "insert_before", "insert_after", "delete_line",
                        "append", "prepend", "replace_all"
                    ],
                },
                "line": {"type": "integer", "minimum": 1},
                "line_number": {"type": "integer", "minimum": 1},
                "start_line": {"type": "integer", "minimum": 1},
                "end_line": {"type": "integer", "minimum": 1},
                "text": {"type": "string"},
                "content": {"type": "string", "description": "text 的别名。"},
                "edits": {
                    "type": "array",
                    "description": "按数组顺序执行；后续编辑的行号基于前面编辑后的内容。",
                    "items": {"type": "object"},
                },
            },
            "required": ["id"],
            "additionalProperties": False,
        },
        "destructive": True,
    },
    {
        "name": "librarian.delete_inheritance_thought",
        "description": "按 ID 删除一条传承思想的本地快照与索引记录。此操作不可恢复。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "传承思想 ID。"},
            },
            "required": ["id"],
            "additionalProperties": False,
        },
        "destructive": True,
    },
    {
        "name": "librarian.read_inheritance_skills",
        "description": (
            "读取知识库中的「传承技能」：即当前账号在线设备上报的 MCP 工具信息。"
            "除名称、描述和入参 schema 外，还返回实现类型、源码入口、处理函数片段或"
            "动态程序代码，以及通过 mcp.manage_dynamic_tool 执行 inspect/get_source/"
            "upsert 的修改路径。只读，不接受参数。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        "destructive": False,
    },
    {
        "name": "librarian.read_intrinsic_skills",
        "description": (
            "读取知识库中的「传承技能」服务端部分：系统固定注册的服务端 MCP 工具清单，"
            "按 namespace 分组返回每个工具的描述与参数说明。只读，不接受参数。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        "destructive": False,
    },
    {
        "name": "librarian.update_intrinsic_skills",
        "description": (
            "修改「传承技能」服务端部分：覆盖一个或多个 MCP 工具的中文描述与参数说明，"
            "保存后会同步 mcp.list_tools / mcp.describe_tool 的展示。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "tools": {
                    "type": "array",
                    "description": "要更新的工具列表；每项至少包含工具名 name。",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "精确的 MCP 工具名。"},
                            "description": {"type": "string", "description": "工具中文描述。"},
                            "parameters": {
                                "type": "array",
                                "description": "参数说明列表；每项含 name 与 description。",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "name": {"type": "string", "description": "参数名。"},
                                        "description": {"type": "string", "description": "参数中文说明。"},
                                    },
                                    "required": ["name"],
                                    "additionalProperties": True,
                                },
                            },
                        },
                        "required": ["name"],
                        "additionalProperties": True,
                    },
                },
            },
            "required": ["tools"],
            "additionalProperties": False,
        },
        "destructive": True,
    },
    {
        "name": "librarian.read_intrinsic_personas",
        "description": (
            "读取知识库中的「固有人格」：当前用户下所有 AI 的人格 Prompt。"
            "只读，不接受参数。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        "destructive": False,
    },
    {
        "name": "librarian.update_intrinsic_persona",
        "description": (
            "修改「固有人格」：更新指定 AI 的人格 Prompt，保存后同步 AI 配置。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "ai_config_id": {
                    "type": "integer",
                    "description": "目标 AI 配置 ID，即固有人格列表中每个 agent 的 id。",
                },
                "prompt": {
                    "type": "string",
                    "description": "人格 Prompt 全文。",
                },
            },
            "required": ["ai_config_id", "prompt"],
            "additionalProperties": False,
        },
        "destructive": True,
    },
    {
        "name": "librarian.read_system_prompts",
        "description": (
            "读取知识库中的「固有思想」：所有 AI 统一使用的 MCP、默认任务与"
            "AI 通信提示词。只读，不接受参数。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {},
            "additionalProperties": False,
        },
        "destructive": False,
    },
    {
        "name": "librarian.update_system_prompts",
        "description": (
            "修改「固有思想」：更新所有 AI 统一使用的系统提示词。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompts": {
                    "type": "array",
                    "description": "要更新的配置项列表；每项含配置键 key 与内容 content。",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string", "description": "系统提示词配置键。"},
                            "content": {
                                "type": ["string", "number"],
                                "description": "配置内容；数值类配置传数字。",
                            },
                        },
                        "required": ["key", "content"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["prompts"],
            "additionalProperties": False,
        },
        "destructive": True,
    },
]

TOOL_NAMES = [item["name"] for item in TOOL_DEFS]
