IS_ROUTER_ENTRY = False

from fastapi import APIRouter

from api.chat_runtime.run_state import (  # noqa: F401 — re-exported for chat sub-route imports
    MAX_AUTO_SUPERVISION_ROUNDS,
    STATE_PREFIX,
    _AUTO_RUNTIME_SECTION_TITLES,
    _RUN_LIVE_META,
    _RUN_LIVE_STATE,
    _RUN_STATE_LOCK,
    _RUN_THREADS,
    _TASK_CREATE_TOOL_NAMES,
    _TASK_RUNTIME_SECTION_TITLES,
)


router = APIRouter()
PREFIX = "/api/chat"
