"""Read-only MCP tool for keyword-based knowledge recall (file scan, no vector DB)."""

from typing import Any, Dict, Optional

from fastapi import HTTPException

from api.services import kb_store


def _knowledge_search(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int] = None):
    # ai_config_id and scope are accepted for signature compat but ignored in pure keyword file search.
    query = str((args or {}).get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required for knowledge.search")
    try:
        k = int((args or {}).get("k") or 5)
    except Exception:
        k = 5
    include_body = bool((args or {}).get("include_body"))
    # scope is currently not filtered in the simple file scan impl (all user KB is visible)
    items = kb_store.keyword_search_knowledge(user_id=int(user_id), query=query, k=k, include_body=include_body)
    return {
        "query": query,
        "count": len(items),
        "items": items,
    }


def knowledge_search_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "关键词检索的查询文本（匹配标题、触发词、摘要、正文）。"},
            "k": {"type": "integer", "description": "返回结果数量，默认 5。"},
            "scope": {
                "type": "string",
                "enum": ["global", "ai", "project"],
                "description": "（当前实现忽略）可选作用域过滤；文件直读关键词方案下全部可见。",
            },
            "include_body": {"type": "boolean", "description": "是否返回全文正文。"},
        },
        "required": ["query"],
    }


KNOWLEDGE_SEARCH_SCHEMA: Dict[str, Any] = knowledge_search_schema()

