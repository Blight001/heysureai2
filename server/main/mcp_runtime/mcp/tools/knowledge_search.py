"""Read-only MCP tool for semantic knowledge recall."""

from typing import Any, Dict, Optional

from api.services.knowledge_vector import _knowledge_search_result, knowledge_search_schema


def _knowledge_search(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int] = None):
    return _knowledge_search_result(user_id=user_id, args=args or {}, ai_config_id=ai_config_id)


KNOWLEDGE_SEARCH_SCHEMA: Dict[str, Any] = knowledge_search_schema()

