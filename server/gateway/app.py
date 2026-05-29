"""``api-gateway`` FastAPI + Socket.IO app served on port 3000.

Mounts every router under ``api/routers/`` at ``/api`` and wraps the
Socket.IO server from ``api.sio``. Shared library code lives in ``api``;
this module only wires it together for the public-facing process.
"""

import socketio
import logging
import os
import importlib
import glob
import asyncio
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from connector_runtime.bots import iter_bots
from api.core.logging_config import configure_logging
from api.core.settings import settings
from api.sio import sio
from api.socket_events import register_agent_socket_events, register_user_socket_events
from api.database import create_db_and_tables
from mcp_runtime.mcp.loader import load_plugins_on_startup
from api.runtime import heartbeat as heartbeat_module
from ai_runtime.inference.ai_service import align_token_snapshots_with_history, migrate_legacy_switch_files_to_db
from api.chat_runtime.chat_scheduler import process_task_scheduler


# Ensure logging is configured when the app is loaded by uvicorn (which
# may not go through gateway.main).
configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    try:
        plugin_boot = load_plugins_on_startup()
        for entry in plugin_boot.get("plugin_errors") or []:
            logger.error(f"mcp-plugins: failed to load {entry.get('plugin')}: {entry.get('error')}")
        if plugin_boot.get("loaded"):
            logger.info(
                f"mcp-plugins loaded {plugin_boot['loaded']} module(s); "
                f"registry version={plugin_boot.get('version')}"
            )
    except Exception:
        logger.exception("mcp-plugins startup discovery failed")
    try:
        result = migrate_legacy_switch_files_to_db()
        if result.get("imported") or result.get("removed"):
            logger.info(
                f"migrate_legacy_switch_files_to_db imported={result.get('imported', 0)} "
                f"removed={result.get('removed', 0)}"
            )
    except Exception:
        logger.exception("migrate_legacy_switch_files_to_db failed")
    try:
        result = align_token_snapshots_with_history()
        if result.get("changed_rows") or result.get("deleted_rows"):
            logger.info(
                f"align_token_snapshots_with_history changed={result.get('changed_rows', 0)} "
                f"deleted={result.get('deleted_rows', 0)}"
            )
    except Exception:
        logger.exception("align_token_snapshots_with_history failed")
    stop_event = asyncio.Event()

    watchdog_counter = {"ticks": 0}
    # In split deployments the dedicated connector-runtime owns every bot's
    # long-connection client so api-gateway restarts don't drop upstream.
    _bots_owned_by_gateway = not settings.connector_runtime_url

    async def periodic_scan():
        while not stop_event.is_set():
            if _bots_owned_by_gateway:
                for bot in iter_bots():
                    try:
                        bot.start_long_connections()
                    except Exception:
                        logger.exception(f"start {bot.channel} long_connections failed")
            try:
                process_task_scheduler()
            except Exception:
                logger.exception("process_task_scheduler failed")
            # Reap stale ChatRun heartbeats every ~30s to avoid scanning
            # the table on every 3s tick.
            watchdog_counter["ticks"] += 1
            if watchdog_counter["ticks"] % 10 == 0:
                try:
                    reaped = heartbeat_module.reap_stale_runs()
                    if reaped:
                        logger.warning(f"watchdog reaped stale runs: {reaped}")
                except Exception:
                    logger.exception("watchdog reap failed")
            await asyncio.sleep(3)

    task = asyncio.create_task(periodic_scan())
    yield
    stop_event.set()
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task

# FastAPI App
app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 自动注册路由：扫描 gateway/routers/ 目录下所有 HTTP 路由模块。
# 网关进程现在拥有所有真路由；推理 helper（chat_prompt_utils/chat_runtime_helpers/
# chat_scheduler/chat_stream）已迁到 api/chat_runtime/，作为跨 runtime 共享代码。
import gateway.routers as _routers_pkg
routers_dir = os.path.dirname(_routers_pkg.__file__)
router_files = glob.glob(os.path.join(routers_dir, "*.py"))

for router_file in router_files:
    module_name = os.path.basename(router_file)[:-3]
    if module_name == "__init__":
        continue

    try:
        module = importlib.import_module(f"gateway.routers.{module_name}")
        # 仅注册显式入口路由模块，避免拆分后的子模块重复挂载同一 router
        if hasattr(module, "router") and getattr(module, "IS_ROUTER_ENTRY", True):
            # 默认统一挂载到 /api 前缀下；模块可定义 PREFIX 覆盖。
            prefix = getattr(module, "PREFIX", "/api")
            app.include_router(module.router, prefix=prefix)
            logger.info(f"loaded router: {module_name} -> {prefix}")
    except Exception:
        logger.exception(f"failed to load router {module_name}")

# Bot routers live next to each bot's adapter — mount them here so adding a
# new bot stays a single ``bots/<name>/`` directory drop instead of also
# editing api/routers/.
for _bot in iter_bots():
    try:
        bot_router_module = importlib.import_module(f"connector_runtime.bots.{_bot.channel}.router")
    except ModuleNotFoundError:
        continue
    bot_router = getattr(bot_router_module, "router", None)
    if bot_router is None:
        continue
    bot_prefix = getattr(bot_router_module, "PREFIX", f"/api/{_bot.channel}")
    app.include_router(bot_router, prefix=bot_prefix)
    logger.info(f"loaded bot router: {_bot.channel} -> {bot_prefix}")

# Register Socket Events. In split deployments (CONNECTOR_RUNTIME_URL set)
# connector-runtime owns the agent-side handlers, so api-gateway only wires
# the user-side. In monolith mode we register both.
register_user_socket_events()
if not settings.connector_runtime_url:
    register_agent_socket_events()

# Socket.IO App Wrapper
sio_app = socketio.ASGIApp(sio, other_asgi_app=app)

@app.get("/")
async def root():
    return {"message": "HeySure Server is running"}
