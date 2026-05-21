import uvicorn
import socketio
import os
import importlib
import glob
import traceback
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .sio import sio
from .socket_events import register_socket_events
from .database import create_db_and_tables
from .ai_service import scan_and_sync_switch_files, align_token_snapshots_with_history
from .feishu_long_connection import start_feishu_long_connection_clients
from .routers.chat import process_task_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
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

    async def periodic_scan():
        while not stop_event.is_set():
            try:
                start_feishu_long_connection_clients()
            except Exception as exc:
                print(f"[start_feishu_long_connection_clients] {exc}")
            try:
                scan_and_sync_switch_files()
            except Exception as exc:
                print(f"[scan_and_sync_switch_files] {exc}")
            try:
                process_task_scheduler()
            except Exception as exc:
                print(f"[process_task_scheduler] {exc}")
            await asyncio.sleep(3)

    task = asyncio.create_task(periodic_scan())
    yield
    stop_event.set()
    task.cancel()

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

# Register Socket Events
register_socket_events()

# Socket.IO App Wrapper
sio_app = socketio.ASGIApp(sio, other_asgi_app=app)

@app.get("/")
async def root():
    return {"message": "HeySure Server is running"}
