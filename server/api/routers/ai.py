from .ai_base import PREFIX, router
from . import ai_config_routes as _ai_config_routes
from . import ai_misc_routes as _ai_misc_routes
from . import ai_task_routes as _ai_task_routes

__all__ = ["router", "PREFIX"]
