"""诊断/测试路由：供管理员控制台「系统测试」栏目调用，对各模块做连通性与功能测试。

- ``GET  /api/diagnostics/health`` —— 数据库 + 各后端进程（gateway/mcp/connector/ai）健康检查
- ``POST /api/diagnostics/llm``    —— 模型连通性测试：发一次极小的补全请求看是否能正常返回

MCP 工具的测试复用既有的 ``/api/mcp/tools``（列工具）与 ``/api/mcp/call``（执行工具），
本路由不再重复实现。所有接口仅限房主/管理员调用。
"""

import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session, select

from api.core.settings import settings
from api.database import engine
from api.http_client import ai_http_post
from api.models import AssistantAIConfig, User
from api.runtime.internal_http import internal_headers
from api.services.model_presets import resolve_model_preset
from .admin import require_admin_user

router = APIRouter()
PREFIX = "/api/diagnostics"


def _check_database() -> Dict[str, Any]:
    started = time.perf_counter()
    try:
        with Session(engine) as session:
            session.execute(text("SELECT 1"))
        return {
            "module": "database",
            "label": "数据库",
            "ok": True,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "detail": "连接正常",
        }
    except Exception as exc:
        return {
            "module": "database",
            "label": "数据库",
            "ok": False,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "detail": f"连接失败：{exc}",
        }


def _check_runtime(module: str, label: str, base_url: str) -> Dict[str, Any]:
    # base_url 为空表示该 runtime 与 gateway 同进程运行（单体部署），无需远程探测。
    if not base_url:
        return {
            "module": module,
            "label": label,
            "ok": True,
            "latency_ms": 0.0,
            "detail": "与网关同进程运行（单体部署）",
        }
    started = time.perf_counter()
    try:
        with httpx.Client(base_url=base_url.rstrip("/"), timeout=8.0) as client:
            resp = client.get("/internal/health", headers=internal_headers())
        latency = round((time.perf_counter() - started) * 1000, 1)
        if resp.status_code != 200:
            return {
                "module": module,
                "label": label,
                "ok": False,
                "latency_ms": latency,
                "detail": f"HTTP {resp.status_code}",
            }
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        detail = "运行正常"
        if isinstance(body, dict) and body.get("tools") is not None:
            detail = f"运行正常，已注册 {body.get('tools')} 个工具"
        return {
            "module": module,
            "label": label,
            "ok": bool(body.get("ok", True)) if isinstance(body, dict) else True,
            "latency_ms": latency,
            "detail": detail,
        }
    except Exception as exc:
        return {
            "module": module,
            "label": label,
            "ok": False,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "detail": f"无法连接：{exc}",
        }


@router.get("/health")
def diagnostics_health(user: User = Depends(require_admin_user)) -> Dict[str, Any]:
    """逐个检查数据库与四个后端进程的健康状态。"""
    checks: List[Dict[str, Any]] = [
        {
            "module": "gateway",
            "label": "网关进程 (gateway)",
            "ok": True,
            "latency_ms": 0.0,
            "detail": "当前进程，能响应即正常",
        },
        _check_database(),
        _check_runtime("mcp_runtime", "MCP 运行时", settings.mcp_runtime_url),
        _check_runtime("connector_runtime", "连接器运行时", settings.connector_runtime_url),
        _check_runtime("ai_runtime", "AI 运行时", settings.ai_runtime_url),
    ]
    return {
        "ok": all(item["ok"] for item in checks),
        "checks": checks,
    }


class LLMTestRequest(BaseModel):
    ai_config_id: Optional[int] = None
    prompt: Optional[str] = None


@router.post("/llm")
def diagnostics_llm(
    req: LLMTestRequest,
    user: User = Depends(require_admin_user),
) -> Dict[str, Any]:
    """模型连通性测试：用目标 AI（或当前用户的主脑模型）发一次极小的补全请求。"""
    with Session(engine) as db:
        cfg: Optional[AssistantAIConfig] = None
        if req.ai_config_id is not None:
            cfg = db.exec(
                select(AssistantAIConfig).where(
                    AssistantAIConfig.id == req.ai_config_id,
                    AssistantAIConfig.user_id == user.id,
                )
            ).first()
            if not cfg:
                return {"ok": False, "detail": "未找到该 AI 配置"}
        fresh_user = db.get(User, user.id) or user
        api_key, base_url, model = resolve_model_preset(fresh_user, cfg)

    if not (api_key and base_url and model):
        missing = []
        if not api_key:
            missing.append("API Key")
        if not base_url:
            missing.append("Base URL")
        if not model:
            missing.append("模型名")
        return {"ok": False, "model": model, "detail": f"模型未配置完整，缺少：{'、'.join(missing)}"}

    prompt = (req.prompt or "回复一个字：好").strip() or "回复一个字：好"
    started = time.perf_counter()
    try:
        resp = ai_http_post(
            base_url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "max_tokens": 16,
            },
            timeout=30,
        )
        latency = round((time.perf_counter() - started) * 1000, 1)
        if resp.status_code != 200:
            snippet = (resp.text or "")[:300]
            return {"ok": False, "model": model, "latency_ms": latency, "detail": f"HTTP {resp.status_code}：{snippet}"}
        data = resp.json()
        reply = str(((data.get("choices") or [{}])[0].get("message") or {}).get("content") or "").strip()
        return {
            "ok": True,
            "model": model,
            "base_url": base_url,
            "latency_ms": latency,
            "reply": reply[:200],
            "detail": "模型响应正常",
        }
    except Exception as exc:
        return {
            "ok": False,
            "model": model,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "detail": f"请求失败：{exc}",
        }
