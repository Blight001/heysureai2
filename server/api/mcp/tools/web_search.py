from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from ...core.settings import settings
from ...database import engine
from ...models import User


def _get_tavily_api_key(user_id: int) -> str:
    with Session(engine) as session:
        user = session.exec(select(User).where(User.id == user_id)).first()
    key = str(getattr(user, "tavily_api_key", "") or "").strip()
    return key or settings.tavily_api_key


async def _web_search(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int] = None) -> Dict[str, Any]:
    query = str(args.get("query") or "").strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is required")

    api_key = _get_tavily_api_key(user_id)
    if not api_key:
        raise HTTPException(status_code=400, detail="Tavily API key is not configured in system settings")

    search_depth = str(args.get("search_depth") or "advanced").strip().lower()
    if search_depth not in {"basic", "advanced"}:
        search_depth = "advanced"

    try:
        max_results = int(args.get("max_results") or 5)
    except Exception:
        max_results = 5
    max_results = max(1, min(20, max_results))

    payload: Dict[str, Any] = {
        "query": query,
        "search_depth": search_depth,
        "max_results": max_results,
    }
    for name in ("include_answer", "include_raw_content", "include_images"):
        if name in args:
            payload[name] = bool(args.get(name))

    try:
        from tavily import TavilyClient
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="tavily-python is not installed. Run `pip install tavily-python` in the server environment.",
        ) from exc

    try:
        client = TavilyClient(api_key)
        return client.search(**payload)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Tavily search failed: {exc}") from exc
