# -*- coding: utf-8 -*-
"""知识与进化工坊 agent —— 独立的端侧"作坊"进程。

像桌面/浏览器 agent 一样通过 Socket.IO 连接服务器并注册自己的 MCP 工具
（librarian.* / evolution.*）。AI 必须在前端为其绑定本工坊后，这些工具才会
出现在该 AI 的工具目录里；调用时服务端把 ``task:dispatch`` 发到这里，本进程
经 ``policy.py`` 的方向策略钩子处理后，回调 gateway ``/api/workshop/execute``
完成真正的读写（数据真相源始终在服务端）。

运行：
    pip install -r requirements.txt
    cp .env.example .env   # 填 SERVER_URL / HEYSURE_TOKEN
    python workshop_agent.py
"""

import asyncio
import json
import logging
import os
import uuid
from pathlib import Path

import aiohttp
import socketio

import policy
import tools

logging.basicConfig(level=logging.INFO, format="%(asctime)s [workshop] %(levelname)s %(message)s")
logger = logging.getLogger("workshop")

_BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv() -> None:
    """轻量 .env 加载（无第三方依赖）。已存在的环境变量优先。"""
    env_file = _BASE_DIR / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


_load_dotenv()

SERVER_URL = os.environ.get("SERVER_URL", "http://127.0.0.1:3000").rstrip("/")
TOKEN = os.environ.get("HEYSURE_TOKEN", "").strip()
AGENT_NAME = os.environ.get("WORKSHOP_NAME", "知识工坊")


def _agent_id() -> str:
    """稳定的设备逻辑 ID：首次生成后持久化，使绑定在重连后仍然有效。"""
    id_file = _BASE_DIR / ".agent_id"
    if id_file.is_file():
        saved = id_file.read_text(encoding="utf-8").strip()
        if saved:
            return saved
    new_id = f"workshop_{uuid.uuid4().hex[:12]}"
    id_file.write_text(new_id, encoding="utf-8")
    return new_id


AGENT_ID = _agent_id()

sio = socketio.AsyncClient(reconnection=True, reconnection_delay=2, reconnection_delay_max=30)


async def _register() -> None:
    await sio.emit("agent:register", {
        "id": AGENT_ID,
        "name": AGENT_NAME,
        "platform": "Workshop",
        "isWorkshop": True,
        "capabilities": tools.TOOL_NAMES,
        "toolDefs": tools.TOOL_DEFS,
        "version": "1.0.0",
        "token": TOKEN,
    })


async def _call_server_execute(tool: str, args: dict, ai_config_id) -> dict:
    """回调 gateway 执行真正的知识/进化读写（服务端会复核权限与绑定）。"""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{SERVER_URL}/api/workshop/execute",
            json={"tool": tool, "args": args, "ai_config_id": ai_config_id},
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=aiohttp.ClientTimeout(total=60),
        ) as resp:
            body = await resp.text()
            try:
                data = json.loads(body)
            except ValueError:
                data = {"raw": body}
            if resp.status >= 400:
                detail = data.get("detail") if isinstance(data, dict) else None
                raise RuntimeError(f"server {resp.status}: {detail or body}")
            return data.get("result", data) if isinstance(data, dict) else data


@sio.on("connect")
async def on_connect():
    logger.info("connected to %s, registering as %s (%s)", SERVER_URL, AGENT_NAME, AGENT_ID)
    await _register()


@sio.on("agent:registered")
async def on_registered(data):
    logger.info("registered: %s", data)


@sio.on("agent:register_rejected")
async def on_rejected(data):
    logger.error("registration rejected: %s — 请检查 .env 里的 HEYSURE_TOKEN", data)


@sio.on("task:dispatch")
async def on_task_dispatch(data):
    data = data if isinstance(data, dict) else {}
    task_id = str(data.get("taskId") or "")
    tool = str(data.get("tool") or "").strip()
    args = data.get("args") if isinstance(data.get("args"), dict) else {}
    ai_config_id = data.get("aiConfigId")
    logger.info("dispatch task=%s tool=%s ai=%s", task_id, tool, ai_config_id)

    if tool not in tools.TOOL_NAMES:
        await sio.emit("task:error", {
            "taskId": task_id,
            "agentId": AGENT_ID,
            "error": f"工坊未注册该工具: {tool}",
        })
        return
    try:
        shaped_args = policy.before_execute(tool, dict(args))
        result = await _call_server_execute(tool, shaped_args, ai_config_id)
        result = policy.after_execute(tool, shaped_args, result)
        await sio.emit("task:result", {
            "taskId": task_id,
            "agentId": AGENT_ID,
            "success": True,
            "tool": tool,
            "result": result,
            "summary": "",
        })
    except Exception as exc:
        logger.exception("tool %s failed", tool)
        await sio.emit("task:error", {
            "taskId": task_id,
            "agentId": AGENT_ID,
            "error": str(exc),
        })


@sio.on("disconnect")
async def on_disconnect():
    logger.warning("disconnected; the client will auto-reconnect")


async def main() -> None:
    if not TOKEN:
        raise SystemExit("缺少 HEYSURE_TOKEN（用户登录 token）。复制 .env.example 为 .env 并填写。")
    while True:
        try:
            await sio.connect(SERVER_URL, transports=["websocket", "polling"])
            await sio.wait()
        except Exception as exc:
            logger.error("connect failed: %s — 5s 后重试", exc)
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
