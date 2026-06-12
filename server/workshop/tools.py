# -*- coding: utf-8 -*-
"""知识与进化工坊的工具注册表（工坊真相源）。

服务端内置工坊（server/workshop/）按用户自动上线，这里声明的工具名 /
描述 / 入参 schema 会作为该工坊的 capabilities 写入在线快照，并原样展示
给绑定了工坊的 AI。

▶ 想调整"AI 怎么用知识与进化"，直接改这里的 description（支持中文），
  AI 看到的工具说明随下一次工坊上线刷新（重启任一服务进程即可）。
▶ 想增删工具：工坊只接受 ``librarian.`` / ``evolution.`` 两个命名空间，
  且执行经 ``server/workshop/engine.py`` 的白名单，新增工具名需要在
  engine 的 handler 映射中同步支持。
"""

TOOL_DEFS = [
    {
        "name": "librarian.propose",
        "description": (
            "向知识工坊提交一条新的流程沉淀申请（how-to）。提交后进入待审批队列，"
            "需用户在前端确认后才会被检索到。当用户明确说\"记住这个\"/\"下次这样做\"时使用。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "简短的流程标题。"},
                "scenario": {"type": "string", "description": "该流程适用的场景。"},
                "steps": {"type": "array", "items": {"type": "string"}, "description": "按顺序执行的步骤。"},
                "gotchas": {"type": "array", "items": {"type": "string"}},
                "triggers": {"type": "array", "items": {"type": "string"}, "description": "用于将来任务自动匹配的关键词。"},
                "scope": {"type": "string", "enum": ["global", "ai", "project"]},
                "scope_target": {"type": "string"},
                "evidence": {"type": "object", "description": "出处：{job_id, generation, message_id}"},
            },
            "required": ["title", "steps"],
        },
        "destructive": True,
    },
    {
        "name": "librarian.consult",
        "description": (
            "用自由文本向知识工坊检索相关流程，最多返回 k 条（含完整步骤）。"
            "不确定怎么做时优先调用。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "想知道怎么做的事情。"},
                "k": {"type": "integer", "description": "最多返回条数（默认 5）。"},
                "scope": {"type": "string", "enum": ["global", "ai", "project"]},
            },
            "required": ["query"],
        },
        "destructive": False,
    },
    {
        "name": "librarian.list_topics",
        "description": "只列出流程标题与触发词（渐进披露）。先浏览再用 librarian.read 深入。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["global", "ai", "project"]},
                "status": {
                    "type": "string",
                    "enum": ["pending", "active", "archived", "rejected", "all"],
                    "description": "默认 active。",
                },
            },
        },
        "destructive": False,
    },
    {
        "name": "librarian.read",
        "description": "按 memory_id 读取一条流程的完整 Markdown 正文。",
        "inputSchema": {
            "type": "object",
            "properties": {"memory_id": {"type": "string"}},
            "required": ["memory_id"],
        },
        "destructive": False,
    },
    {
        "name": "librarian.archive",
        "description": "归档（软删除）一条流程。仅图书管理员 AI 可调。",
        "inputSchema": {
            "type": "object",
            "properties": {"memory_id": {"type": "string"}},
            "required": ["memory_id"],
        },
        "destructive": True,
    },
    {
        "name": "evolution.input",
        "description": "提交一条系统进化建议（提示词/工具/流程改进），等待管理者审批。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "proposal": {"type": "string"},
                "type": {
                    "type": "string",
                    "enum": ["prompt_rule", "tool_rule", "workflow_rule", "memory", "failure_case", "success_case"],
                },
                "risk": {"type": "string"},
                "target_scope": {"type": "object"},
                "evidence": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["proposal"],
        },
        "destructive": True,
    },
    {
        "name": "evolution.list",
        "description": "列出已提交的进化建议，可按 review_status 筛选。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "review_status": {"type": "string", "enum": ["queued", "accepted", "rejected", "applied"]},
                "limit": {"type": "integer"},
            },
        },
        "destructive": False,
    },
    {
        "name": "evolution.review",
        "description": "审批一条进化建议：accept / reject / apply（apply 时提供 applied_to）。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "evolution_input_id": {"type": "string"},
                "decision": {"type": "string", "enum": ["accept", "reject", "apply"]},
                "applied_to": {"type": "string"},
            },
            "required": ["evolution_input_id", "decision"],
        },
        "destructive": True,
    },
]

TOOL_NAMES = [item["name"] for item in TOOL_DEFS]
