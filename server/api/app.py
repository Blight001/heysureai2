import uvicorn
import socketio
import os
import importlib
import glob
import traceback
import asyncio
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .sio import sio
from .socket_events import register_agent_socket_events, register_user_socket_events
from .database import create_db_and_tables
from .mcp.loader import load_plugins_on_startup
from .runtime import heartbeat as heartbeat_module
from .services.ai_service import align_token_snapshots_with_history, migrate_legacy_switch_files_to_db
from .integrations.feishu.long_connection import start_feishu_long_connection_clients
from .integrations.qq.long_connection import start_qq_long_connection_clients
from .routers.chat import process_task_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    try:
        plugin_boot = load_plugins_on_startup()
        for entry in plugin_boot.get("plugin_errors") or []:
            print(f"[mcp-plugins] failed to load {entry.get('plugin')}: {entry.get('error')}")
        if plugin_boot.get("loaded"):
            print(
                f"[mcp-plugins] loaded {plugin_boot['loaded']} plugin module(s); "
                f"registry version={plugin_boot.get('version')}"
            )
    except Exception as exc:
        print(f"[mcp-plugins] startup discovery failed: {exc}")
    try:
        result = migrate_legacy_switch_files_to_db()
        if result.get("imported") or result.get("removed"):
            print(
                "[migrate_legacy_switch_files_to_db] "
                f"imported={result.get('imported', 0)} "
                f"removed={result.get('removed', 0)}"
            )
    except Exception as exc:
        print(f"[migrate_legacy_switch_files_to_db] {exc}")
    try:
        result = align_token_snapshots_with_history()
        if result.get("changed_rows") or result.get("deleted_rows"):
            print(
                "[align_token_snapshots_with_history] "
                f"changed={result.get('changed_rows', 0)} "
                f"deleted={result.get('deleted_rows', 0)}"
            )
    except Exception as exc:
        print(f"[align_token_snapshots_with_history] {exc}")
    stop_event = asyncio.Event()

    watchdog_counter = {"ticks": 0}
    # When a dedicated connector-runtime is configured, it owns the Feishu
    # long connection so api-gateway restarts don't drop the upstream.
    _feishu_in_gateway = not os.environ.get("CONNECTOR_RUNTIME_URL", "").strip()
    _qq_in_gateway = not os.environ.get("CONNECTOR_RUNTIME_URL", "").strip()

    async def periodic_scan():
        while not stop_event.is_set():
            if _feishu_in_gateway:
                try:
                    start_feishu_long_connection_clients()
                except Exception as exc:
                    print(f"[start_feishu_long_connection_clients] {exc}")
            if _qq_in_gateway:
                try:
                    start_qq_long_connection_clients()
                except Exception as exc:
                    print(f"[start_qq_long_connection_clients] {exc}")
            try:
                process_task_scheduler()
            except Exception as exc:
                print(f"[process_task_scheduler] {exc}")
            # Reap stale ChatRun heartbeats every ~30s to avoid scanning
            # the table on every 3s tick.
            watchdog_counter["ticks"] += 1
            if watchdog_counter["ticks"] % 10 == 0:
                try:
                    reaped = heartbeat_module.reap_stale_runs()
                    if reaped:
                        print(f"[watchdog] reaped stale runs: {reaped}")
                except Exception as exc:
                    print(f"[watchdog] reap failed: {exc}")
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

# 自动注册路由
# 遍历 api/routers 目录下的所有 .py 文件
# 由于现在 app.py 在 api 文件夹下，所以路径需要调整
api_dir = os.path.dirname(__file__)
routers_dir = os.path.join(api_dir, "routers")
# 使用 glob 查找所有 .py 文件，排除 __init__.py
router_files = glob.glob(os.path.join(routers_dir, "*.py"))

for router_file in router_files:
    module_name = os.path.basename(router_file)[:-3]
    if module_name == "__init__":
        continue
    
    # 动态导入模块
    try:
        # 由于在 api 包内，我们可以用相对导入或绝对导入
        module = importlib.import_module(f"api.routers.{module_name}")
        # 仅注册显式入口路由模块，避免拆分后的子模块重复挂载同一 router
        if hasattr(module, "router") and getattr(module, "IS_ROUTER_ENTRY", True):
            # 默认统一挂载到 /api 前缀下
            # 你也可以在模块中定义 PREFIX 变量来覆盖默认前缀
            prefix = getattr(module, "PREFIX", "/api")
            app.include_router(module.router, prefix=prefix)
            print(f"Loaded router: {module_name} -> {prefix}")
    except Exception as e:
        print(f"\033[91mFailed to load router {module_name}:\033[0m")
        traceback.print_exc()

# Register Socket Events. In split deployments (CONNECTOR_RUNTIME_URL set)
# connector-runtime owns the agent-side handlers, so api-gateway only wires
# the user-side. In monolith mode we register both.
register_user_socket_events()
if not os.environ.get("CONNECTOR_RUNTIME_URL", "").strip():
    register_agent_socket_events()

# Socket.IO App Wrapper
sio_app = socketio.ASGIApp(sio, other_asgi_app=app)

@app.get("/")
async def root():
    return {"message": "HeySure Server is running"}
