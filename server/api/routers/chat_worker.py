IS_ROUTER_ENTRY = False

import asyncio
import base64
import copy
import json
import logging
import os
import re
import sys
import time


logger = logging.getLogger(__name__)
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import requests
from sqlmodel import Session, select

from api.database import engine
from mcp_runtime.mcp import registry, reset_mcp_runtime_overrides, set_mcp_runtime_overrides
from mcp_runtime.mcp.core import MCP_INTROSPECTION_TOOLS
from api.models import AITaskJob, AssistantAIConfig, ChatMessage, ChatMessageCreate, ChatRun, User
from api.services import ai_message_service, valhalla_service
from api.services.agent_dispatch import dispatch_endpoint_tool_and_wait, set_run_session_context
from api.services.task_completion_notify import notify_task_completion
from connector_runtime.dispatch.desktop_agent_tools import (
    build_endpoint_tools_payload,
    endpoint_bridge_tools_for_config,
    is_endpoint_agent_tool,
)
from api.services.task_system import (
    DEFAULT_SYSTEM_AUTO_CONTROL,
    TASK_RUNTIME_REQUIRED_TOOLS,
    normalize_system_auto_control,
    parse_generation_from_session_id,
    with_workspace_read_by_name_compat,
)
from .chat_prompt_utils import (
    _append_mcp_state_to_tags,
    _append_prompt_section,
    _build_mcp_display_result,
    _build_mcp_stream_warning,
    _extract_delta_text,
    _extract_first_complete_mcp_call,
    _extract_first_mcp_call,
    _extract_mcp_error,
    _render_inheritance_notice,
    _safe_json,
    _set_run_live_meta,
    _set_run_live_phase,
    _set_run_live_text,
    _set_run_live_usage,
    _strip_prompt_section,
    _strip_task_runtime_sections,
)
from api.services.chat_persistence import _save_message
from .chat_stream import StreamResult, _detect_provider, stream_turn_anthropic, stream_turn_openai_compat
from .chat_runtime_helpers import (
    _create_loop_scheduled_job,
    _is_task_finished_status,
    _load_task_job_by_session,
    _load_task_payload_by_session,
    _parse_allowed_tools,
    _resolve_ai_runtime,
    _resolve_effective_workspace_root,
    _run_set_status,
    _run_should_stop,
    _session_total_tokens,
)
from .chat_scheduler import _start_task_run

from api.core.config import DEFAULT_CHAT_MAX_STEPS
from api.core.settings import settings


def _ai_debug_enabled() -> bool:
    return bool(settings.ai_debug)


def _ai_debug_color_enabled() -> bool:
    # ai_debug_color defaults True, so honor NO_COLOR (standard convention)
    # and TTY autodetect on top of the explicit setting.
    if not settings.ai_debug_color:
        return False
    if os.environ.get("NO_COLOR"):
        return False
    try:
        return bool(sys.stdout.isatty())
    except Exception:
        return False


def _ai_color(text: str, code: str) -> str:
    if not _ai_debug_color_enabled():
        return text
    return f"\033[{code}m{text}\033[0m"


def _ai_short(value: Any, limit: int = 48) -> str:
    text = str(value or "").strip()
    if not text:
        return "-"
    if len(text) <= limit:
        return text
    return f"{text[: max(1, limit - 1)]}…"


def _ai_short_run_id(run_id: str) -> str:
    text = str(run_id or "").strip()
    if not text:
        return "-"
    if text.startswith("run_") and len(text) > 12:
        return f"run_{text[4:12]}"
    return _ai_short(text, 16)


def _ai_short_base_url(base_url: str) -> str:
    text = str(base_url or "").strip()
    if not text:
        return "-"
    parsed = urlparse(text)
    if not parsed.netloc:
        return _ai_short(text, 48)
    path = parsed.path.rstrip("/")
    if path:
        return f"{parsed.netloc}{path}"
    return parsed.netloc


def _ai_debug_log(message: str) -> None:
    if _ai_debug_enabled():
        logger.debug(message)


def _ai_debug_stage(stage: str, message: str, color: str = "36") -> None:
    _ai_debug_log(f"{_ai_color(stage, color)} {message}")


def _normalize_ai_message_type(value: Any, require_reply: bool) -> str:
    text = str(value or "").strip().lower()
    if text in {"inquiry", "reply", "chitchat", "notify"}:
        return text
    return "inquiry" if require_reply else "notify"


def _render_ai_message_system_prompt(
    *,
    from_ai_name: str,
    from_ai_config_id: int,
    target_ai_name: str,
    target_ai_config_id: int,
    message_id: str,
    current_session_id: str,
    content: str,
    message_type: str,
    require_reply: bool,
) -> str:
    should_reply = bool(require_reply) or message_type == "inquiry"
    message_type_guide = (
        "- inquiry（询问）：发送方在提问、请求状态或请求结果，通常需要你答复。\n"
        "- reply（回复）：发送方在答复你之前发出的 inquiry，通常不需要再答复，除非内容明确提出新问题。\n"
        "- notify（通知）：发送方在单向告知状态、结果或提醒，不期待你回复。\n"
        "- chitchat（闲聊）：非任务型闲聊，可自然继续多轮。"
    )
    reply_rule = (
        "这条消息需要你回复。回复时调用 MCP 工具 `ai.send_message`，"
        f"参数必须包含 `to_ai_config_id={from_ai_config_id}`、`message_type=\"reply\"`、"
        "`require_reply=false`、"
        f"`reply_to_message_id=\"{message_id}\"`、`current_session_id=\"{current_session_id}\"`。"
        if should_reply
        else "这条消息不要求回复。除非内容明确要求你另起一个新问题，否则不要回信。"
    )
    return (
        "[系统提示]\n"
        "[AI 间通信 · 强制插入]\n"
        "当前 AI 运行已被这条消息打断。你必须先处理这条系统提示，再继续原本任务。\n\n"
        f"- 收件方（你）: {target_ai_name}（ai_config_id={target_ai_config_id}）\n"
        f"- 发送方: {from_ai_name}（ai_config_id={from_ai_config_id}）\n"
        f"- 消息编号: {message_id}\n"
        f"- 当前会话: {current_session_id}\n"
        f"- 消息类型: {message_type}\n"
        f"- 是否要求回复: {'是' if should_reply else '否'}\n\n"
        "[消息内容]\n"
        f"{content}\n\n"
        "[发送类型说明]\n"
        f"{message_type_guide}\n\n"
        "[处理规则]\n"
        "你以后调用 MCP 工具 `ai.send_message` 时，`message_type` 是必填字段，不能省略。\n"
        f"{reply_rule}"
    )


def _coerce_max_steps(value: object, default: int = 48) -> int:
    try:
        return max(1, min(999, int(value or default)))
    except Exception:
        return max(1, min(999, int(default)))


def _resolve_ai_name_safe(session: Session, ai_config_id: Optional[int]) -> str:
    if not ai_config_id:
        return ""
    try:
        row = session.exec(
            select(AssistantAIConfig).where(AssistantAIConfig.id == int(ai_config_id))
        ).first()
        return str(row.name or "") if row else ""
    except Exception:
        return ""


def _format_upstream_error(response: requests.Response, max_body_len: int = 4000) -> str:
    status = f"HTTP {response.status_code}"
    reason = str(response.reason or "").strip()
    if reason:
        status = f"{status} {reason}"

    body = str(response.text or "").strip()
    if body:
        try:
            parsed = response.json()
            if isinstance(parsed, dict):
                error = parsed.get("error")
                if isinstance(error, dict):
                    message = str(error.get("message") or "").strip()
                    code = str(error.get("code") or "").strip()
                    error_type = str(error.get("type") or "").strip()
                    parts = [part for part in [message, code, error_type] if part]
                    if parts:
                        body = " | ".join(parts)
                elif isinstance(error, str) and error.strip():
                    body = error.strip()
        except Exception:
            pass
    if len(body) > max_body_len:
        body = f"{body[:max_body_len]}\n...<truncated>"
    return f"Upstream AI request failed: {status} for {response.url}\n{body}".strip()


def _raise_for_upstream_error(response: requests.Response) -> None:
    if response.ok:
        return
    raise RuntimeError(_format_upstream_error(response))


def _to_native_tool_name(name: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "__", str(name or "").strip())
    safe = safe.strip("_") or "tool"
    return safe[:64]


def _build_native_tools_payload(allowed_tools: Optional[set] = None) -> tuple[List[Dict], Dict[str, str]]:
    tools = []
    native_to_mcp: Dict[str, str] = {}
    used_names = set()
    tool_payloads = registry.build_tools_payload(allowed_tools)
    tool_payloads.extend(build_endpoint_tools_payload(allowed_tools))
    for tool in tool_payloads:
        native_tool = copy.deepcopy(tool)
        original_name = str(native_tool.get("function", {}).get("name") or "").strip()
        native_name = _to_native_tool_name(original_name)
        if native_name in used_names and native_to_mcp.get(native_name) != original_name:
            suffix = 2
            base = native_name[:58]
            while f"{base}_{suffix}" in used_names:
                suffix += 1
            native_name = f"{base}_{suffix}"
        native_tool["function"]["name"] = native_name
        native_to_mcp[native_name] = original_name
        used_names.add(native_name)
        tools.append(native_tool)
    return tools, native_to_mcp


def _split_concatenated_native_tool_name(name: str, native_tool_name_map: Dict[str, str]) -> List[str]:
    """Return native tool names when a model accidentally joins multiple names."""
    remaining = str(name or "").strip()
    if not remaining or remaining in native_tool_name_map:
        return []
    native_names = sorted(native_tool_name_map.keys(), key=len, reverse=True)
    parts: List[str] = []
    while remaining:
        matched = next((candidate for candidate in native_names if remaining.startswith(candidate)), "")
        if not matched:
            return []
        parts.append(matched)
        remaining = remaining[len(matched):]
    return parts if len(parts) > 1 else []


def _missing_required_mcp_args(tool_name: str, arguments: dict) -> List[str]:
    tool = registry.get(tool_name)
    schema = tool.input_schema if isinstance(tool.input_schema, dict) else {}
    required = schema.get("required") if isinstance(schema, dict) else []
    if not isinstance(required, list):
        return []
    args = arguments if isinstance(arguments, dict) else {}
    return [
        str(name)
        for name in required
        if str(name) not in args or args.get(str(name)) in (None, "")
    ]


def _joined_tool_skip_reason(tool_name: str, arguments: dict, allowed_tools: set) -> str:
    if tool_name not in allowed_tools:
        return f"Tool not allowed for this task: {tool_name}"
    if is_endpoint_agent_tool(tool_name):
        return ""
    tool = registry.get(tool_name)
    missing = _missing_required_mcp_args(tool_name, arguments)
    if missing:
        return f"Missing required argument(s) for {tool_name}: {', '.join(missing)}"
    if tool.destructive and not str(tool_name).startswith("prompt."):
        return f"Cannot safely execute destructive tool from a joined MCP call: {tool_name}"
    return ""


async def _call_mcp_via_runtime(
    runtime_url: str,
    tool: str,
    user_id: int,
    arguments: dict,
    ai_config_id: Optional[int],
) -> Dict[str, object]:
    """Forward an MCP tool call to ``mcp-runtime`` over HTTP.

    Lazy-imports httpx so the in-process path keeps zero overhead. Uses the
    INTERNAL_TOKEN Bearer header from ``runtime.internal_http.internal_headers``.
    """
    import httpx
    from api.runtime.internal_http import internal_headers

    async with httpx.AsyncClient(base_url=runtime_url.rstrip("/"), timeout=120.0) as client:
        resp = await client.post(
            "/internal/mcp/call",
            headers=internal_headers(),
            json={
                "tool": tool,
                "user_id": user_id,
                "ai_config_id": ai_config_id,
                "arguments": arguments,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _dispatch_endpoint_via_runtime(
    runtime_url: str,
    tool: str,
    user_id: int,
    arguments: dict,
    ai_config_id: Optional[int],
    timeout_seconds: int = 120,
    poll_interval: float = 1.0,
) -> Dict[str, object]:
    """Forward an endpoint-agent tool dispatch to ``connector-runtime`` and
    poll the persisted task row until it finishes.

    Polling (vs blocking HTTP) is what makes the dispatch survive a
    connector-runtime restart: once the row is in the DB, any subsequent
    poll picks up the agent's eventual reply even if the original wait
    process was wiped.
    """
    import asyncio as _asyncio
    import httpx
    from api.runtime.internal_http import internal_headers

    headers = internal_headers()
    base = runtime_url.rstrip("/")

    async with httpx.AsyncClient(base_url=base, timeout=30.0) as client:
        post_resp = await client.post(
            "/internal/agent/dispatch",
            headers=headers,
            json={
                "user_id": user_id,
                "ai_config_id": ai_config_id,
                "tool": tool,
                "arguments": arguments,
            },
        )
        post_resp.raise_for_status()
        post_body = post_resp.json()
        task_id = str(post_body.get("task_id") or "")
        if not task_id:
            return {
                "success": False,
                "tool": tool,
                "error": "connector-runtime returned no task_id",
            }

        deadline = _asyncio.get_running_loop().time() + max(1, int(timeout_seconds))
        consecutive_missing = 0
        while True:
            row: Dict[str, Any]
            try:
                resp = await client.get(
                    f"/internal/agent/dispatch/result/{task_id}",
                    headers=headers,
                )
                if resp.status_code == 404:
                    # Row should exist (we just POSTed) — a 404 means the
                    # connector-runtime restart wiped our row between the
                    # POST and our first GET, or some other race we should
                    # not paper over indefinitely.
                    consecutive_missing += 1
                    if consecutive_missing >= 3:
                        return {
                            "success": False,
                            "taskId": task_id,
                            "tool": tool,
                            "error": "dispatch row missing after retries (connector-runtime restart?)",
                        }
                    row = {"status": "pending"}
                else:
                    resp.raise_for_status()
                    row = resp.json()
                    consecutive_missing = 0
            except Exception as exc:
                # Transient HTTP failure: keep polling until the deadline.
                row = {"status": "pending", "error": f"poll error: {exc}"}
            status = str(row.get("status") or "pending")
            if status != "pending":
                return {
                    "success": bool(row.get("success", status == "completed")),
                    "taskId": task_id,
                    "tool": row.get("tool") or tool,
                    "summary": row.get("summary"),
                    "result": row.get("result"),
                    "error": row.get("error"),
                }
            if _asyncio.get_running_loop().time() >= deadline:
                return {
                    "success": False,
                    "taskId": task_id,
                    "tool": tool,
                    "error": f"Endpoint agent result timeout after {timeout_seconds}s",
                }
            await _asyncio.sleep(poll_interval)


async def _call_mcp_or_endpoint_tool(
    tool: str,
    user_id: int,
    arguments: dict,
    ai_config_id: Optional[int],
) -> Dict[str, object]:
    if is_endpoint_agent_tool(tool):
        connector_url = settings.connector_runtime_url
        if connector_url:
            return {
                "tool": tool,
                "destructive": True,
                "result": await _dispatch_endpoint_via_runtime(
                    connector_url, tool, user_id, arguments, ai_config_id
                ),
            }
        return {
            "tool": tool,
            "destructive": True,
            "result": await dispatch_endpoint_tool_and_wait(
                user_id=user_id,
                ai_config_id=ai_config_id,
                tool=tool,
                args=arguments,
            ),
        }
    runtime_url = settings.mcp_runtime_url
    if runtime_url:
        return await _call_mcp_via_runtime(runtime_url, tool, user_id, arguments, ai_config_id)
    return await registry.call(tool, user_id, arguments, ai_config_id)


def _tool_result_failed(tool_result: Dict[str, object]) -> tuple[bool, str]:
    result = tool_result.get("result") if isinstance(tool_result, dict) else None
    if isinstance(result, dict) and result.get("success") is False:
        return True, str(result.get("error") or result.get("summary") or "Tool returned success=false")
    return False, ""


def _append_missing_tool_responses(convo: List[Dict], error_text: str) -> List[str]:
    """Repair OpenAI-style history in-place.

    OpenAI-compatible providers require every assistant message with tool_calls
    to be followed immediately by tool messages for each tool_call_id. Appending
    synthetic tool responses to the end is still invalid if a user/system message
    already sits between the assistant tool_calls and the tool response, so the
    repair inserts missing tool messages at the exact required position.
    """
    repaired_ids: List[str] = []
    idx = 0
    while idx < len(convo):
        item = convo[idx]
        if item.get("role") != "assistant" or not item.get("tool_calls"):
            if item.get("role") == "tool":
                # Orphan tool messages are invalid in OpenAI-compatible payloads.
                # They can appear after an older failed repair appended a tool
                # response behind a user notice. Drop them from the outgoing
                # in-memory request; persisted user/assistant history is untouched.
                convo.pop(idx)
                continue
            idx += 1
            continue

        tool_calls = item.get("tool_calls") or []
        expected_ids = [
            str(call.get("id") or "").strip()
            for call in tool_calls
            if isinstance(call, dict) and str(call.get("id") or "").strip()
        ]
        if not expected_ids:
            idx += 1
            continue

        seen_ids = set()
        insert_at = idx + 1
        while insert_at < len(convo) and convo[insert_at].get("role") == "tool":
            tool_call_id = str(convo[insert_at].get("tool_call_id") or "").strip()
            if tool_call_id in expected_ids and tool_call_id not in seen_ids:
                seen_ids.add(tool_call_id)
                insert_at += 1
                continue
            convo.pop(insert_at)

        missing_ids = [tool_call_id for tool_call_id in expected_ids if tool_call_id not in seen_ids]
        for offset, tool_call_id in enumerate(missing_ids):
            convo.insert(insert_at + offset, {
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": _safe_json({
                    "success": False,
                    "error": error_text,
                    "recovered": True,
                }),
            })
        repaired_ids.extend(missing_ids)
        idx = insert_at + len(missing_ids)
    return repaired_ids


def _build_mcp_tool_bubble_content(tool: str, arguments: dict, result_text: str, failed: bool = False) -> str:
    status = "失败" if failed else "成功"
    return (
        "[MCP工具]\n"
        f"工具: {tool}\n"
        f"状态: {status}\n\n"
        "[参数]\n"
        f"{_safe_json(arguments or {})}\n\n"
        "[结果]\n"
        f"{result_text}"
    )


def _save_mcp_tool_bubble(
    bg: Session,
    *,
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    session_name: str,
    model: str,
    tool: str,
    arguments: dict,
    result_text: str,
    failed: bool = False,
) -> None:
    _save_message(
        bg,
        user_id,
        ChatMessageCreate(
            role="system",
            content=_build_mcp_tool_bubble_content(tool, arguments, result_text, failed),
            tags="mcp_tool_call",
            ai_config_id=ai_config_id,
            ai_kind=ai_kind,
            session_id=session_id,
            session_name=session_name,
            model=model,
            total_tokens=0,
        ),
    )


def _load_current_user_content(
    session: Session,
    *,
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    current_user_message_id: Optional[int],
    fallback: Optional[str],
) -> str:
    fallback_text = str(fallback or "").strip()
    if current_user_message_id:
        row = session.get(ChatMessage, current_user_message_id)
        if (
            row
            and row.user_id == user_id
            and row.ai_config_id == ai_config_id
            and row.ai_kind == ai_kind
            and row.session_id == session_id
            and row.role == "user"
        ):
            return fallback_text or str(row.content or "").strip()
    return fallback_text


def _reset_convo_after_forget(
    convo: List[Dict],
    *,
    system_prompt: str,
    current_user_content: str,
    tool_result: Dict[str, object],
) -> None:
    result_payload = tool_result.get("result", tool_result) if isinstance(tool_result, dict) else tool_result
    follow_up = (
        "[MCP执行确认]\n"
        "系统已执行工具：conversation.forget_before_current\n"
        "执行状态：成功\n\n"
        "[工具执行结果]\n"
        f"{_safe_json(result_payload)}\n\n"
        "旧上下文已从本轮模型上下文中移除。请只基于当前用户消息和以上结果继续。"
    )
    convo.clear()
    convo.append({"role": "system", "content": system_prompt})
    if current_user_content:
        convo.append({"role": "user", "content": current_user_content})
    convo.append({"role": "user", "content": follow_up})


def _browser_screenshot_image_message(tool: str, tool_result: Dict[str, object]) -> Optional[Dict[str, object]]:
    if tool != "browser_screenshot" or not isinstance(tool_result, dict):
        return None
    result_payload = tool_result.get("result", tool_result)
    if not isinstance(result_payload, dict):
        return None
    data_url = str(result_payload.get("dataUrl") or "").strip()
    if not data_url.startswith("data:image/"):
        server_path = str(result_payload.get("server_path") or "").strip()
        if server_path and os.path.isfile(server_path):
            ext = os.path.splitext(server_path)[1].lower().lstrip(".")
            media_type = {
                "jpg": "image/jpeg",
                "jpeg": "image/jpeg",
                "png": "image/png",
                "webp": "image/webp",
            }.get(ext, "image/png")
            try:
                with open(server_path, "rb") as fh:
                    data_url = f"data:{media_type};base64,{base64.b64encode(fh.read()).decode('ascii')}"
            except Exception:
                data_url = ""
    if not data_url.startswith("data:image/"):
        return None
    detail = "\n".join(
        part for part in [
            "浏览器截图已捕获。你已经收到这张图片，请直接查看视觉内容并继续，不要让用户打开本地路径。",
            f"URL: {result_payload.get('url') or ''}".strip(),
            f"Method: {result_payload.get('method') or ''}".strip(),
        ]
        if part and not part.endswith(":")
    )
    return {
        "role": "user",
        "content": [
            {"type": "text", "text": detail},
            {"type": "image_url", "image_url": {"url": data_url}},
        ],
    }


def _model_visible_tool_result(tool: str, tool_result: Dict[str, object]) -> object:
    result_payload = tool_result.get("result", tool_result) if isinstance(tool_result, dict) else tool_result
    if tool != "browser_screenshot" or not isinstance(result_payload, dict):
        return result_payload
    cleaned = {
        key: value
        for key, value in result_payload.items()
        if key not in {
            "dataUrl",
            "data_url",
            "imageDataUrl",
            "screenshotDataUrl",
            "server_path",
            "workspace_path",
        }
    }
    cleaned["screenshot_attached_to_model"] = True
    cleaned["instruction"] = "The screenshot image is attached in the next user message. Analyze the image directly; do not ask the user to open a local path."
    return cleaned


def _append_mcp_disabled_feedback(
    *,
    bg: Session,
    convo: List[Dict],
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    session_name: str,
    model: str,
    tool: str,
    arguments: dict,
    native_tool_call_id: str = "",
) -> None:
    tool_name = str(tool or "").strip() or "unknown"
    payload = {
        "success": False,
        "error": "MCP is disabled for this AI",
        "tool": tool_name,
        "arguments": arguments or {},
        "instruction": (
            "The requested MCP call was not executed because MCP is disabled or not effective "
            "for this AI. Do not wait for a tool result. Continue by explaining the limitation "
            "to the user, asking them to enable MCP if tool execution is required, or completing "
            "the task without MCP when possible."
        ),
    }
    notice = (
        "[系统提示] 检测到 MCP 调用未生效。\n"
        f"- 工具: {tool_name}\n"
        "- 原因: 当前 AI 的 MCP 开关关闭或 MCP 未生效，系统没有执行该工具。\n\n"
        "请不要停在等待 MCP 结果的状态；请继续回复用户，说明无法执行该 MCP，"
        "必要时请用户开启 MCP 或改用无需 MCP 的方式完成。"
    )
    _save_message(
        bg,
        user_id,
        ChatMessageCreate(
            role="user",
            content=notice,
            tags="system_notice_mcp_disabled",
            ai_config_id=ai_config_id,
            ai_kind=ai_kind,
            session_id=session_id,
            session_name=session_name,
            model=model,
            total_tokens=0,
        ),
    )
    if native_tool_call_id:
        convo.append({
            "role": "tool",
            "tool_call_id": native_tool_call_id,
            "content": _safe_json(payload),
        })
    else:
        convo.append({"role": "user", "content": f"{notice}\n\n[工具检查结果]\n{_safe_json(payload)}"})


def _run_worker(
    *,
    run_id: str,
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    session_name: str,
    model_user_content: Optional[str] = None,
    merged_system_prompt: Optional[str] = None,
    max_steps: Optional[int] = None,
    current_user_message_id: Optional[int] = None,
):
    """Public worker entry. Wraps the implementation with heartbeat lifecycle
    so every caller (monolith thread, ai-runtime dispatcher, scheduler) gets
    watchdog protection without needing to spawn its own heartbeat thread.
    """
    import threading as _threading
    from api.runtime import heartbeat as _hb

    _stop_hb = _threading.Event()

    def _tick_loop() -> None:
        while not _stop_hb.is_set():
            try:
                _hb.tick(run_id)
            except Exception:
                pass
            if _stop_hb.wait(_hb.TICK_INTERVAL_SECONDS):
                return

    _hb_thread = _threading.Thread(target=_tick_loop, name=f"hb-{run_id}", daemon=True)
    _hb_thread.start()
    try:
        _run_worker_impl(
            run_id=run_id,
            user_id=user_id,
            ai_config_id=ai_config_id,
            ai_kind=ai_kind,
            session_id=session_id,
            session_name=session_name,
            model_user_content=model_user_content,
            merged_system_prompt=merged_system_prompt,
            max_steps=max_steps,
            current_user_message_id=current_user_message_id,
        )
    finally:
        _stop_hb.set()
        _hb_thread.join(timeout=1.0)


def _run_worker_impl(
    *,
    run_id: str,
    user_id: int,
    ai_config_id: Optional[int],
    ai_kind: str,
    session_id: str,
    session_name: str,
    model_user_content: Optional[str] = None,
    merged_system_prompt: Optional[str] = None,
    max_steps: Optional[int] = None,
    current_user_message_id: Optional[int] = None,
):
    if _run_should_stop(run_id):
        _run_set_status(run_id, "stopped", finished=True)
        return
    _run_set_status(run_id, "running")
    _set_run_live_meta(
        run_id,
        user_id=user_id,
        ai_config_id=ai_config_id,
        ai_kind=ai_kind,
        session_id=session_id,
        session_name=session_name,
    )
    _ai_debug_stage(
        "START",
        f"{_ai_short_run_id(run_id)} u={user_id} cfg={ai_config_id if ai_config_id is not None else '-'} "
        f"kind={ai_kind} sess={_ai_short(session_id, 24)}",
        "36",
    )
    try:
        with Session(engine) as bg:
            user = bg.get(User, user_id)
            if not user:
                raise RuntimeError("User not found")
            max_steps = _coerce_max_steps(
                max_steps,
                _coerce_max_steps(getattr(user, "mcp_max_steps", DEFAULT_CHAT_MAX_STEPS), DEFAULT_CHAT_MAX_STEPS),
            )
            mcp_warning_template = str(getattr(user, "mcp_format_error_hint", "") or "").strip()
            cfg, api_key, base_url, model, system_prompt = _resolve_ai_runtime(bg, user, ai_kind, ai_config_id)
            auto_ctl = normalize_system_auto_control(cfg.system_auto_control if cfg else None)
            inheritance_notice_emitted = False
            task_payload = _load_task_payload_by_session(bg, user_id, ai_config_id, session_id)
            task_job = _load_task_job_by_session(bg, user_id, ai_config_id, session_id)
            is_task_runtime = bool(task_payload) or str(session_id or "").startswith("session_task_")
            effective_tool_allowlist = _parse_allowed_tools(cfg.mcp_tools if cfg else None)
            effective_tool_allowlist.update(MCP_INTROSPECTION_TOOLS)
            effective_tool_allowlist.update(endpoint_bridge_tools_for_config(ai_config_id, user_id))
            if ai_config_id is not None:
                # System-injected AI-to-AI messages must remain answerable even
                # when a task or config narrows the general MCP tool allowlist.
                effective_tool_allowlist.add("ai.send_message")
            # Per-bot tool requirements (e.g. Feishu adds context-trim) live
            # on the adapter so adding/removing a bot's required tools no
            # longer touches the chat worker.
            from connector_runtime.bots import iter_bots as _iter_bots
            from connector_runtime.bots.base import channel_for_session_id as _channel_for_session_id
            _session_channel = _channel_for_session_id(str(session_id or ""), _iter_bots())
            if _session_channel:
                _bot = next((b for b in _iter_bots() if b.channel == _session_channel), None)
                if _bot is not None:
                    effective_tool_allowlist.update(_bot.extra_required_mcp_tools())
            token_threshold_override = None
            workspace_root_override = None
            if task_payload:
                override_tools = task_payload.get("override_mcp_tools")
                if isinstance(override_tools, dict) and bool(override_tools.get("enabled")):
                    tools = override_tools.get("tools")
                    if isinstance(tools, list):
                        effective_tool_allowlist = {
                            str(tool).strip() for tool in tools if isinstance(tool, str) and str(tool).strip()
                        }
                        effective_tool_allowlist = with_workspace_read_by_name_compat(effective_tool_allowlist)
                        effective_tool_allowlist.update(endpoint_bridge_tools_for_config(ai_config_id, user_id))
                        if ai_config_id is not None:
                            effective_tool_allowlist.add("ai.send_message")
                override_token = task_payload.get("override_token_limit")
                if isinstance(override_token, dict) and bool(override_token.get("enabled")):
                    try:
                        token_threshold_override = max(1, int(override_token.get("value") or 1))
                    except Exception:
                        token_threshold_override = None
                override_workspace = task_payload.get("override_workspace_root")
                if isinstance(override_workspace, dict) and bool(override_workspace.get("enabled")):
                    workspace_root_override = str(override_workspace.get("value") or "").strip() or "."
            # Task runtime must always allow task system tools.
            if is_task_runtime:
                effective_tool_allowlist.update(TASK_RUNTIME_REQUIRED_TOOLS)
            # Dynamic MCP discovery must remain available even when task runtime
            # narrows the operational tool allowlist.
            effective_tool_allowlist.update(MCP_INTROSPECTION_TOOLS)
            if merged_system_prompt:
                system_prompt = merged_system_prompt
            if is_task_runtime:
                effective_workspace_root = _resolve_effective_workspace_root(
                    user_id=user_id,
                    ai_config_id=ai_config_id,
                    workspace_root_override=workspace_root_override,
                )
                # Keep only one effective workspace section in task runtime prompt.
                system_prompt = _append_prompt_section(
                    _strip_prompt_section(system_prompt, "AI 工作目录"),
                    "AI 工作目录",
                    effective_workspace_root,
                )
                # Remove legacy task-runtime prompt sections; task constraints are enforced server-side.
                system_prompt = _strip_task_runtime_sections(system_prompt)

            msg_stmt = select(ChatMessage).where(
                ChatMessage.user_id == user_id,
                ChatMessage.session_id == session_id,
                ChatMessage.ai_kind == ai_kind,
            ).order_by(ChatMessage.created_at.asc())
            if ai_config_id is not None:
                msg_stmt = msg_stmt.where(ChatMessage.ai_config_id == ai_config_id)
            history = bg.exec(msg_stmt).all()
            convo = [{"role": "system", "content": system_prompt}]
            for m in history:
                tags = str(getattr(m, "tags", "") or "")
                if "system_notice_ai_error" in tags or "system_notice_ai_context_repaired" in tags:
                    continue
                if m.role in ("user", "assistant"):
                    item = {"role": m.role, "content": m.content}
                    if m.role == "assistant" and m.think:
                        item["reasoning_content"] = m.think
                    convo.append(item)
                elif m.role == "system":
                    if tags.startswith("ai_message_inbound:") or tags.startswith("task_completion_notice:"):
                        convo.append({"role": "user", "content": m.content})
            if model_user_content:
                for i in range(len(convo) - 1, -1, -1):
                    if convo[i].get("role") == "user":
                        convo[i] = {"role": "user", "content": model_user_content}
                        break

            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
            last_rejected_tool_sig = ""
            rejected_repeat = 0
            consecutive_ai_errors = 0

            # Native tool schemas are exposed progressively. Keep the full
            # allowlist as the execution boundary, but initially show only MCP
            # self-inspection tools to the model.
            mcp_active = bool(cfg and cfg.mcp_enabled and effective_tool_allowlist)
            exposed_tool_allowlist = set(MCP_INTROSPECTION_TOOLS) & set(effective_tool_allowlist)
            provider = _detect_provider(base_url)
            _ai_debug_stage(
                "INIT",
                f"{_ai_short_run_id(run_id)} {provider} {model} host={_ai_short_base_url(base_url)} "
                f"hist={len(history)} tools={len(effective_tool_allowlist)}/{len(exposed_tool_allowlist)} "
                f"mcp={'on' if mcp_active else 'off'}",
                "34",
            )

            # Expose session context to MCP tools (e.g. admin.dispatch_task) so
            # async desktop-agent results can be appended to this session. The
            # worker runs in its own thread, so the contextvar is naturally scoped.
            set_run_session_context({
                "user_id": user_id,
                "ai_config_id": ai_config_id,
                "ai_kind": ai_kind,
                "session_id": session_id,
                "session_name": session_name,
                "model": model,
                "current_user_message_id": current_user_message_id,
            })

            pending_ai_reply_message_id = ""
            for step_index in range(max_steps):
                if _run_should_stop(run_id):
                    _run_set_status(run_id, "stopped", finished=True)
                    return

                # 抢占式钩子：若收件箱有 pending 的 AI 间消息，在下一次 LLM
                # 调用前把它注入到 convo 强制 AI 优先回复。
                # 必须按 session_id 严格匹配——保证 (AI, session) 的消息流
                # 不会跨会话相互串话。
                if ai_config_id is not None:
                    try:
                        _inbound = ai_message_service.pop_pending_for(
                            user_id, int(ai_config_id), session_id
                        )
                    except Exception as _iex:
                        _inbound = None
                        logger.exception("inbox poll failed")
                    if _inbound is not None:
                        _from_name = _resolve_ai_name_safe(bg, _inbound.from_ai_config_id) or f"AI-{_inbound.from_ai_config_id}"
                        _target_name = _resolve_ai_name_safe(bg, ai_config_id) or f"AI-{ai_config_id}"
                        _requires_reply = bool(getattr(_inbound, "require_reply", True))
                        _msg_type = _normalize_ai_message_type(
                            getattr(_inbound, "message_type", None),
                            _requires_reply,
                        )
                        _injected = _render_ai_message_system_prompt(
                            from_ai_name=_from_name,
                            from_ai_config_id=_inbound.from_ai_config_id,
                            target_ai_name=_target_name,
                            target_ai_config_id=ai_config_id,
                            message_id=_inbound.message_id,
                            current_session_id=session_id,
                            content=_inbound.content,
                            message_type=_msg_type,
                            require_reply=_requires_reply,
                        )
                        _save_message(
                            bg,
                            user_id,
                            ChatMessageCreate(
                                role="user",
                                content=_injected,
                                tags=f"ai_message_inbound:{_msg_type}:{_inbound.message_id}",
                                ai_config_id=ai_config_id,
                                ai_kind=ai_kind,
                                session_id=session_id,
                                session_name=session_name,
                                model=model,
                                total_tokens=0,
                            ),
                        )
                        convo.append({"role": "user", "content": _injected})
                        if _requires_reply or _msg_type == "inquiry":
                            pending_ai_reply_message_id = str(_inbound.message_id or "").strip()
                        else:
                            pending_ai_reply_message_id = ""

                _append_missing_tool_responses(
                    convo,
                    "Synthetic tool result inserted before request because the previous tool call did not receive a tool response.",
                )
                if mcp_active:
                    current_exposed_tools = set(exposed_tool_allowlist) & set(effective_tool_allowlist)
                    current_exposed_tools.update(set(MCP_INTROSPECTION_TOOLS) & set(effective_tool_allowlist))
                    step_tools, native_tool_name_map = _build_native_tools_payload(current_exposed_tools)
                else:
                    step_tools, native_tool_name_map = [], {}
                start_at = time.time()
                _ai_debug_stage(
                    "TURN",
                    f"{_ai_short_run_id(run_id)} #{step_index + 1}/{max_steps} "
                    f"start msgs={len(convo)} tools={len(step_tools)} "
                    f"reply={'y' if pending_ai_reply_message_id else 'n'}",
                    "33",
                )
                try:
                    if provider == "anthropic":
                        sr = stream_turn_anthropic(
                            run_id=run_id,
                            base_url=base_url,
                            api_key=api_key,
                            model=model,
                            convo=convo,
                            step_tools=step_tools,
                            native_tool_name_map=native_tool_name_map,
                        )
                    else:
                        oa_payload = {
                            "model": model,
                            "messages": convo,
                            "stream": True,
                            "stream_options": {"include_usage": True},
                        }
                        if step_tools:
                            oa_payload["tools"] = step_tools
                            oa_payload["tool_choice"] = "auto"
                            # The worker executes one MCP action at a time. If
                            # an OpenAI-compatible model emits parallel tool
                            # calls, some providers reject the next request
                            # unless every call id is answered. Ask the model
                            # for sequential calls at the protocol level too.
                            oa_payload["parallel_tool_calls"] = False
                        response = requests.post(base_url, headers=headers, json=oa_payload, timeout=300, stream=True)
                        if not response.ok and "parallel_tool_calls" in oa_payload:
                            unsupported_hint = str(response.text or "").lower()
                            if "parallel_tool_calls" in unsupported_hint and (
                                "unsupported" in unsupported_hint
                                or "unknown" in unsupported_hint
                                or "invalid" in unsupported_hint
                                or "extra" in unsupported_hint
                            ):
                                oa_payload.pop("parallel_tool_calls", None)
                                response.close()
                                response = requests.post(base_url, headers=headers, json=oa_payload, timeout=300, stream=True)
                        _raise_for_upstream_error(response)
                        sr = stream_turn_openai_compat(
                            run_id=run_id,
                            response=response,
                            native_tool_name_map=native_tool_name_map,
                        )
                    consecutive_ai_errors = 0
                except Exception as ai_exc:
                    consecutive_ai_errors += 1
                    error_text = _extract_mcp_error(ai_exc)
                    _ai_debug_stage(
                        "ERR",
                        f"{_ai_short_run_id(run_id)} #{step_index + 1}/{max_steps} "
                        f"x{consecutive_ai_errors} {_ai_short(error_text, 140)}",
                        "31",
                    )
                    repaired_ids = _append_missing_tool_responses(convo, error_text)
                    if repaired_ids:
                        consecutive_ai_errors = 0
                        _save_message(
                            bg,
                            user_id,
                            ChatMessageCreate(
                                role="system",
                                content="\n".join([
                                    "[AI 对话上下文已修复]",
                                    "已补齐缺失的 tool 响应，避免上游接口因 tool_calls 上下文不完整而拒绝请求。",
                                    f"补齐 tool_call_id: {', '.join(repaired_ids)}",
                                ]),
                                tags="system_notice_ai_context_repaired",
                                ai_config_id=ai_config_id,
                                ai_kind=ai_kind,
                                session_id=session_id,
                                session_name=session_name,
                                model=model,
                                total_tokens=0,
                            ),
                        )
                        _set_run_live_phase(run_id, "generating")
                        continue
                    notice_lines = [
                        "[AI 对话出错]",
                        error_text,
                        "",
                        f"连续错误次数: {consecutive_ai_errors}/3",
                    ]
                    if consecutive_ai_errors < 3:
                        notice_lines.extend([
                            "",
                            "系统将重试上游请求；该错误不会作为 user 消息发送给 AI。",
                        ])
                    notice = "\n".join(notice_lines)
                    _save_message(
                        bg,
                        user_id,
                        ChatMessageCreate(
                            role="system",
                            content=notice,
                            tags="system_notice_ai_error",
                            ai_config_id=ai_config_id,
                            ai_kind=ai_kind,
                            session_id=session_id,
                            session_name=session_name,
                            model=model,
                            total_tokens=0,
                        ),
                    )
                    _set_run_live_phase(run_id, "generating")
                    if consecutive_ai_errors >= 3:
                        _run_set_status(run_id, "error", f"AI request failed 3 times consecutively: {error_text}", finished=True)
                        return
                    continue

                if sr.stopped:
                    _run_set_status(run_id, "stopped", finished=True)
                    return
                if _run_should_stop(run_id):
                    _run_set_status(run_id, "stopped", finished=True)
                    return

                assistant_text = sr.assistant_text
                reasoning_content = sr.reasoning_content
                usage = sr.usage
                finish_reason = sr.finish_reason
                payload_call = sr.payload_call
                _has_native_tc = sr.has_native_tc
                _tc_id = sr.tc_id
                _tc_name = sr.tc_name
                _tc_args = sr.tc_args
                latency = time.time() - start_at
                token_triplet = (
                    f"{int(usage.get('prompt_tokens') or 0)}/"
                    f"{int(usage.get('completion_tokens') or 0)}/"
                    f"{int(usage.get('total_tokens') or 0)}"
                )
                tc_name = _tc_name or (payload_call or {}).get("tool") or "-"
                _ai_debug_stage(
                    "DONE",
                    f"{_ai_short_run_id(run_id)} #{step_index + 1}/{max_steps} "
                    f"{finish_reason or 'stop'} {int(latency * 1000)}ms tok={token_triplet} "
                    f"tc={'native:' if _has_native_tc else ''}{_ai_short(tc_name, 32)}",
                    "32",
                )
                if not payload_call and not _has_native_tc:
                    payload_call = _extract_first_mcp_call(assistant_text)
                assistant_tags = "mcp_assistant_call" if (payload_call or _has_native_tc) else ""

                saved = _save_message(
                    bg,
                    user_id,
                    ChatMessageCreate(
                        role="assistant",
                        content=assistant_text,
                        think=reasoning_content or None,
                        tags=assistant_tags,
                        ai_config_id=ai_config_id,
                        ai_kind=ai_kind,
                        session_id=session_id,
                        session_name=session_name,
                        model=model,
                        prompt_tokens=int(usage.get("prompt_tokens") or 0),
                        completion_tokens=int(usage.get("completion_tokens") or 0),
                        total_tokens=int(usage.get("total_tokens") or 0),
                        cache_read_tokens=int(usage.get("cache_read_input_tokens") or 0) or None,
                        system_prompt=system_prompt,
                        finish_reason=finish_reason,
                        latency=latency,
                    ),
                )
                if _has_native_tc and _tc_name:
                    assistant_item = {
                        "role": "assistant",
                        "content": assistant_text or None,
                        "tool_calls": [{
                            "id": _tc_id or "call_0",
                            "type": "function",
                            "function": {"name": _tc_name, "arguments": _tc_args},
                        }],
                    }
                    if reasoning_content:
                        assistant_item["reasoning_content"] = reasoning_content
                    convo.append(assistant_item)
                else:
                    assistant_item = {"role": "assistant", "content": assistant_text}
                    if reasoning_content:
                        assistant_item["reasoning_content"] = reasoning_content
                    convo.append(assistant_item)
                _set_run_live_text(run_id, "")
                _set_run_live_usage(run_id, 0, 0, 0)

                # Text-based fallback: if no payload_call was detected during streaming.
                if not payload_call and not _has_native_tc:
                    payload_call = _extract_first_mcp_call(assistant_text)
                payload_tool = str((payload_call or {}).get("tool") or "").strip()
                if payload_call and payload_tool in native_tool_name_map:
                    payload_tool = native_tool_name_map[payload_tool]
                    payload_call["tool"] = payload_tool
                joined_native_tools = (
                    _split_concatenated_native_tool_name(payload_tool, native_tool_name_map)
                    if payload_call
                    else []
                )
                if is_task_runtime:
                    latest_task_job = _load_task_job_by_session(bg, user_id, ai_config_id, session_id)
                    if latest_task_job:
                        task_job = latest_task_job

                threshold = 0
                session_tokens = 0
                should_emit_inheritance_notice = False
                inheritance_notice_text = ""
                task_is_finished = bool(task_job and _is_task_finished_status(str(task_job.status or "")))
                if cfg and cfg.ai_role == "digital_member" and not inheritance_notice_emitted and not task_is_finished:
                    threshold = token_threshold_override if token_threshold_override is not None else max(1, int(cfg.token_limit or 1))
                    if threshold > 0:
                        session_tokens = _session_total_tokens(bg, user_id, ai_kind, session_id, ai_config_id)
                        if session_tokens >= threshold:
                            if payload_tool not in {"task.complete", "task.inherit"}:
                                inheritance_notice_text = _render_inheritance_notice(
                                    str(auto_ctl.get("inheritance_notice") or ""),
                                    cfg,
                                    session_tokens,
                                    threshold,
                                )
                                should_emit_inheritance_notice = True
                if should_emit_inheritance_notice:
                    current_job_id = str(task_job.job_id or "").strip() if task_job else ""
                    job_hint = current_job_id or "请填写当前任务ID"
                    notice = (
                        "[系统提示]\n"
                        f"{inheritance_notice_text}\n\n"
                        "本代 token 生命周期已达到上限，请不要直接输出传承总结正文。\n"
                        "请立即调用 MCP 工具 `task.inherit` 提交传承总结，并使用以下参数要求：\n"
                        f"1) `job_id`: {job_hint}\n"
                        "2) `summary`: 必须使用第一人称（我），并包含：本轮已完成事项、关键依据与结论、未完成风险与阻塞、下一步建议。\n\n"
                        "调用成功后，系统会自动开启新一代对话并下发继续执行提示。"
                    )
                    _save_message(
                        bg,
                        user_id,
                        ChatMessageCreate(
                            role="user",
                            content=notice,
                            tags="auto_inheritance_notice_mcp",
                            ai_config_id=ai_config_id,
                            ai_kind=ai_kind,
                            session_id=session_id,
                            session_name=session_name,
                            model=model,
                            total_tokens=0,
                        ),
                    )
                    convo.append({"role": "user", "content": notice})
                    inheritance_notice_emitted = True
                    # Force next turn to submit task.inherit via MCP instead of plain text summary.
                    continue
                if not payload_call:
                    # Only check for text-format MCP warnings when not using native tool_calls.
                    if not _has_native_tc:
                        warning = _build_mcp_stream_warning(assistant_text, cfg, mcp_warning_template)
                        if warning:
                            _save_message(
                                bg,
                                user_id,
                                ChatMessageCreate(
                                    role="user",
                                    content=warning,
                                    tags="system_notice_mcp_format_invalid",
                                    ai_config_id=ai_config_id,
                                    ai_kind=ai_kind,
                                    session_id=session_id,
                                    session_name=session_name,
                                    model=model,
                                    total_tokens=0,
                                ),
                            )
                            convo.append({"role": "user", "content": warning})
                            continue
                    if pending_ai_reply_message_id and assistant_text.strip() and ai_config_id is not None:
                        try:
                            _auto_reply = ai_message_service.complete_inbound_with_assistant_reply(
                                message_id=pending_ai_reply_message_id,
                                user_id=user_id,
                                replier_ai_config_id=int(ai_config_id),
                                content=assistant_text,
                            )
                            if _auto_reply and _auto_reply.get("auto_completed"):
                                saved.tags = _append_mcp_state_to_tags(
                                    saved.tags,
                                    "ai.auto_reply",
                                    {"message_id": pending_ai_reply_message_id},
                                    "assistant final text delivered as AI message reply",
                                )
                                bg.add(saved)
                                bg.commit()
                        except Exception as _arex:
                            logger.exception("auto AI message reply failed")
                        finally:
                            pending_ai_reply_message_id = ""
                    _run_set_status(run_id, "completed", finished=True)
                    return
                if joined_native_tools:
                    joined_mcp_tools = [native_tool_name_map.get(item, item) for item in joined_native_tools]
                    tool = payload_tool
                    arguments = payload_call.get("arguments", {}) or {}
                    if cfg and not cfg.mcp_enabled:
                        denied_sig = f"mcp_disabled|{tool}|{json.dumps(arguments, ensure_ascii=False, sort_keys=True)}"
                        if denied_sig == last_rejected_tool_sig:
                            rejected_repeat += 1
                        else:
                            last_rejected_tool_sig = denied_sig
                            rejected_repeat = 1
                        _append_mcp_disabled_feedback(
                            bg=bg,
                            convo=convo,
                            user_id=user_id,
                            ai_config_id=ai_config_id,
                            ai_kind=ai_kind,
                            session_id=session_id,
                            session_name=session_name,
                            model=model,
                            tool=tool,
                            arguments=arguments,
                            native_tool_call_id=_tc_id or "call_0" if _has_native_tc else "",
                        )
                        if rejected_repeat >= 3:
                            _run_set_status(run_id, "error", "Repeated MCP call while MCP is disabled", finished=True)
                            return
                        _set_run_live_phase(run_id, "generating")
                        continue

                    compound_results = []
                    compound_failed = False
                    for split_tool in joined_mcp_tools:
                        if _run_should_stop(run_id):
                            _run_set_status(run_id, "stopped", finished=True)
                            return
                        item_failed = False
                        item_error = _joined_tool_skip_reason(split_tool, arguments, effective_tool_allowlist)
                        if item_error:
                            item_failed = True
                            compound_failed = True
                            item_result = {"result": {"success": False, "error": item_error}}
                            item_result_text = _build_mcp_display_result(
                                split_tool,
                                item_result,
                                ok=False,
                                error_message=item_error,
                            )
                        else:
                            _set_run_live_phase(run_id, "waiting_mcp", split_tool)
                            try:
                                item_result = asyncio.run(_call_mcp_or_endpoint_tool(split_tool, user_id, arguments, ai_config_id))
                                endpoint_failed, endpoint_error = _tool_result_failed(item_result)
                                if endpoint_failed:
                                    raise RuntimeError(endpoint_error)
                                item_result_text = _build_mcp_display_result(split_tool, item_result, ok=True)
                            except Exception as mcp_exc:
                                item_failed = True
                                compound_failed = True
                                item_error = _extract_mcp_error(mcp_exc)
                                item_result = {"result": {"success": False, "error": item_error}}
                                item_result_text = _build_mcp_display_result(
                                    split_tool,
                                    item_result,
                                    ok=False,
                                    error_message=item_error,
                                )
                        saved.tags = _append_mcp_state_to_tags(
                            saved.tags,
                            split_tool,
                            arguments,
                            item_result_text,
                        )
                        bg.add(saved)
                        bg.commit()
                        _save_mcp_tool_bubble(
                            bg,
                            user_id=user_id,
                            ai_config_id=ai_config_id,
                            ai_kind=ai_kind,
                            session_id=session_id,
                            session_name=session_name,
                            model=model,
                            tool=split_tool,
                            arguments=arguments,
                            result_text=item_result_text,
                            failed=item_failed,
                        )
                        compound_results.append({
                            "tool": split_tool,
                            "failed": item_failed,
                            "error": item_error,
                            "result": item_result.get("result", item_result),
                        })

                    compound_payload = {
                        "success": not compound_failed,
                        "compat_mode": "split_concatenated_tool_names",
                        "original_tool": tool,
                        "tools": compound_results,
                    }
                    if _has_native_tc:
                        convo.append({
                            "role": "tool",
                            "tool_call_id": _tc_id or "call_0",
                            "content": _safe_json(compound_payload),
                        })
                    else:
                        follow_up = (
                            "[MCP兼容处理完成]\n"
                            "系统检测到多个 MCP 工具名被拼接，已按顺序拆分处理。\n"
                            "其中安全且参数完整的工具已执行；缺少参数或不适合从拼接调用执行的工具已逐项标记失败。\n\n"
                            "[工具处理结果]\n"
                            f"{_safe_json(compound_payload)}\n\n"
                            "请基于以上结果继续；如仍需调用失败的工具，请按标准格式一次调用一个 MCP 工具并提供所需参数。"
                        )
                        convo.append({"role": "user", "content": follow_up})
                    _set_run_live_phase(run_id, "generating")
                    continue
                if _run_should_stop(run_id):
                    _run_set_status(run_id, "stopped", finished=True)
                    return
                if cfg and not cfg.mcp_enabled:
                    tool = payload_call.get("tool", "")
                    arguments = payload_call.get("arguments", {}) or {}
                    denied_sig = f"mcp_disabled|{tool}|{json.dumps(arguments, ensure_ascii=False, sort_keys=True)}"
                    if denied_sig == last_rejected_tool_sig:
                        rejected_repeat += 1
                    else:
                        last_rejected_tool_sig = denied_sig
                        rejected_repeat = 1
                    _append_mcp_disabled_feedback(
                        bg=bg,
                        convo=convo,
                        user_id=user_id,
                        ai_config_id=ai_config_id,
                        ai_kind=ai_kind,
                        session_id=session_id,
                        session_name=session_name,
                        model=model,
                        tool=tool,
                        arguments=arguments,
                        native_tool_call_id=_tc_id or "call_0" if _has_native_tc else "",
                    )
                    if rejected_repeat >= 3:
                        _run_set_status(run_id, "error", "Repeated MCP call while MCP is disabled", finished=True)
                        return
                    _set_run_live_phase(run_id, "generating")
                    continue

                tool = payload_call.get("tool", "")
                arguments = payload_call.get("arguments", {}) or {}
                if _run_should_stop(run_id):
                    _run_set_status(run_id, "stopped", finished=True)
                    return
                if tool not in effective_tool_allowlist:
                    denied_sig = f"{tool}|{json.dumps(arguments, ensure_ascii=False, sort_keys=True)}"
                    if denied_sig == last_rejected_tool_sig:
                        rejected_repeat += 1
                    else:
                        last_rejected_tool_sig = denied_sig
                        rejected_repeat = 1
                    tool_failed = True
                    tool_error = f"Tool not allowed for this task: {tool}"
                    tool_result = {"result": {"success": False, "error": tool_error}}
                    result_text = _build_mcp_display_result(tool, tool_result, ok=False, error_message=tool_error)
                    saved.tags = _append_mcp_state_to_tags(saved.tags, tool, arguments, result_text)
                    bg.add(saved)
                    bg.commit()
                    _save_mcp_tool_bubble(
                        bg,
                        user_id=user_id,
                        ai_config_id=ai_config_id,
                        ai_kind=ai_kind,
                        session_id=session_id,
                        session_name=session_name,
                        model=model,
                        tool=tool,
                        arguments=arguments,
                        result_text=result_text,
                        failed=True,
                    )
                    if _has_native_tc:
                        convo.append({
                            "role": "tool",
                            "tool_call_id": _tc_id or "call_0",
                            "content": json.dumps({"error": tool_error, "allowed_tools": sorted(effective_tool_allowlist)}, ensure_ascii=False),
                        })
                    else:
                        follow_up = (
                            "[MCP执行失败]\n"
                            f"工具 `{tool}` 未在当前任务允许范围内。\n"
                            f"可用工具: {', '.join(sorted(effective_tool_allowlist)) or '（空）'}\n"
                            "请改用任务允许的 MCP 工具继续执行。"
                        )
                        convo.append({"role": "user", "content": follow_up})
                    if rejected_repeat >= 3:
                        _run_set_status(run_id, "error", f"Repeated disallowed MCP tool call: {tool}", finished=True)
                        return
                    continue
                _set_run_live_phase(run_id, "waiting_mcp", tool)
                tool_failed = False
                tool_error = ""
                override_token = None
                if workspace_root_override:
                    override_token = set_mcp_runtime_overrides({
                        "user_id": user_id,
                        "ai_config_id": ai_config_id,
                        "workspace_root": workspace_root_override,
                    })
                try:
                    tool_result = asyncio.run(_call_mcp_or_endpoint_tool(tool, user_id, arguments, ai_config_id))
                    endpoint_failed, endpoint_error = _tool_result_failed(tool_result)
                    if endpoint_failed:
                        raise RuntimeError(endpoint_error)
                    result_text = _build_mcp_display_result(tool, tool_result, ok=True)
                except Exception as mcp_exc:
                    tool_failed = True
                    tool_error = _extract_mcp_error(mcp_exc)
                    tool_result = {"result": {"success": False, "error": tool_error}}
                    result_text = _build_mcp_display_result(tool, tool_result, ok=False, error_message=tool_error)
                finally:
                    if override_token is not None:
                        reset_mcp_runtime_overrides(override_token)
                saved.tags = _append_mcp_state_to_tags(saved.tags, tool, arguments, result_text)
                bg.add(saved)
                bg.commit()
                _save_mcp_tool_bubble(
                    bg,
                    user_id=user_id,
                    ai_config_id=ai_config_id,
                    ai_kind=ai_kind,
                    session_id=session_id,
                    session_name=session_name,
                    model=model,
                    tool=tool,
                    arguments=arguments,
                    result_text=result_text,
                    failed=tool_failed,
                )

                if (not tool_failed) and tool == "mcp.describe_tool":
                    described_payload = tool_result.get("result", tool_result) if isinstance(tool_result, dict) else {}
                    described_tool = str((described_payload or {}).get("name") or "").strip()
                    if described_tool and described_tool in effective_tool_allowlist:
                        exposed_tool_allowlist.add(described_tool)

                if (not tool_failed) and tool == "conversation.forget_before_current":
                    current_user_content = _load_current_user_content(
                        bg,
                        user_id=user_id,
                        ai_config_id=ai_config_id,
                        ai_kind=ai_kind,
                        session_id=session_id,
                        current_user_message_id=current_user_message_id,
                        fallback=model_user_content,
                    )
                    _reset_convo_after_forget(
                        convo,
                        system_prompt=system_prompt,
                        current_user_content=current_user_content,
                        tool_result=tool_result,
                    )
                    _set_run_live_phase(run_id, "generating")
                    continue

                if (not tool_failed) and tool == "task.inherit":
                    result_payload = tool_result.get("result", tool_result)
                    inherited_job_id = str(result_payload.get("job_id") or "").strip()
                    inherited_summary = str(result_payload.get("summary") or "").strip()

                    if ai_kind != "core" or ai_config_id is None or not cfg:
                        _run_set_status(run_id, "error", "task.inherit is only supported in core task runtime", finished=True)
                        return

                    if inherited_job_id:
                        task_job = bg.exec(
                            select(AITaskJob).where(
                                AITaskJob.user_id == user_id,
                                AITaskJob.ai_config_id == ai_config_id,
                                AITaskJob.job_id == inherited_job_id,
                            )
                        ).first()
                    elif not task_job:
                        task_job = _load_task_job_by_session(bg, user_id, ai_config_id, session_id)

                    if not task_job:
                        _run_set_status(run_id, "error", "task.inherit succeeded but task context is missing", finished=True)
                        return
                    if _is_task_finished_status(str(task_job.status or "")):
                        _set_run_live_phase(run_id, "idle")
                        _run_set_status(run_id, "completed", finished=True)
                        return

                    # 在 _start_task_run 重置 session_id 之前，落英灵殿（本代遗言）。
                    prev_session_for_valhalla = str(task_job.session_id or session_id or "").strip()
                    prev_generation_for_valhalla = parse_generation_from_session_id(prev_session_for_valhalla, 1) or 1
                    try:
                        valhalla_service.write_inherit(
                            user_id=user_id,
                            ai_config_id=ai_config_id,
                            job_id=task_job.job_id,
                            generation=prev_generation_for_valhalla,
                            session_id=prev_session_for_valhalla,
                            summary=inherited_summary,
                        )
                    except Exception as _vex:
                        logger.exception("valhalla write_inherit failed")

                    resume_prompt = str(auto_ctl.get("resume_task_prompt") or DEFAULT_SYSTEM_AUTO_CONTROL["resume_task_prompt"])
                    next_run_id = _start_task_run(
                        bg,
                        cfg,
                        task_job,
                        resume_prompt,
                        "resume",
                        previous_summary_override=inherited_summary,
                    )
                    if not next_run_id:
                        _run_set_status(run_id, "error", "Failed to start next generation after task.inherit", finished=True)
                        return

                    next_session_id = str(task_job.session_id or "").strip()
                    inherit_notice_lines = [
                        "[系统提示]",
                        "已收到 `task.inherit` 传承总结，系统已自动开启下一代会话继续执行。",
                    ]
                    if inherited_job_id:
                        inherit_notice_lines.append(f"- 任务ID: {inherited_job_id}")
                    if next_session_id:
                        inherit_notice_lines.append(f"- 新会话: {next_session_id}")
                    inherit_notice_lines.append(f"- 新运行ID: {next_run_id}")
                    inherit_notice = "\n".join(inherit_notice_lines)
                    _save_message(
                        bg,
                        user_id,
                        ChatMessageCreate(
                            role="user",
                            content=inherit_notice,
                            tags="system_notice_task_inherit",
                            ai_config_id=ai_config_id,
                            ai_kind=ai_kind,
                            session_id=session_id,
                            session_name=session_name,
                            model=model,
                            total_tokens=0,
                        ),
                    )
                    _set_run_live_phase(run_id, "idle")
                    _run_set_status(run_id, "completed", finished=True)
                    return
                elif (not tool_failed) and tool == "task.complete":
                    result_payload = tool_result.get("result", tool_result)
                    task_id = str(result_payload.get("job_id") or "").strip()
                    task_title = str(result_payload.get("title") or "").strip()
                    task_summary = str(result_payload.get("summary") or "").strip()
                    completed_job = None
                    if task_id and ai_config_id is not None:
                        completed_job = bg.exec(
                            select(AITaskJob).where(
                                AITaskJob.user_id == user_id,
                                AITaskJob.ai_config_id == ai_config_id,
                                AITaskJob.job_id == task_id,
                            )
                        ).first()
                    if completed_job is None and task_job is not None:
                        completed_job = task_job
                    if completed_job is not None:
                        finished_at = time.time()
                        completed_job.status = "completed"
                        completed_job.finished_at = finished_at
                        completed_job.updated_at = finished_at
                        bg.add(completed_job)
                        # 落英灵殿：本代 final_words
                        try:
                            comp_session_id = str(completed_job.session_id or session_id or "").strip()
                            comp_generation = parse_generation_from_session_id(comp_session_id, 1) or 1
                            valhalla_service.write_complete(
                                user_id=user_id,
                                ai_config_id=completed_job.ai_config_id,
                                job_id=completed_job.job_id,
                                generation=comp_generation,
                                session_id=comp_session_id,
                                summary=task_summary,
                            )
                        except Exception as _vex:
                            logger.exception("valhalla write_complete failed")
                        try:
                            notify_task_completion(
                                user_id=user_id,
                                job_id=str(completed_job.job_id or ""),
                                summary=task_summary,
                            )
                        except Exception as _nex:
                            logger.exception("task completion notify failed")
                    next_loop_job = _create_loop_scheduled_job(bg, completed_job, time.time())
                    completion_notice_lines = [
                        "[系统提示]",
                        "任务已通过 `task.complete` 标记为完成。",
                    ]
                    if task_id:
                        completion_notice_lines.append(f"- 任务ID: {task_id}")
                    if task_title:
                        completion_notice_lines.append(f"- 任务标题: {task_title}")
                    if task_summary:
                        completion_notice_lines.append(f"- 完成摘要: {task_summary}")
                    if next_loop_job is not None:
                        completion_notice_lines.append(f"- 循环任务已创建: {next_loop_job.job_id}")
                    completion_notice_lines.append("")
                    completion_notice_lines.append("本任务对话已自动锁定，不再继续后续操作。")
                    completion_notice = "\n".join(completion_notice_lines)
                    _save_message(
                        bg,
                        user_id,
                        ChatMessageCreate(
                            role="user",
                            content=completion_notice,
                            tags="system_notice_task_complete",
                            ai_config_id=ai_config_id,
                            ai_kind=ai_kind,
                            session_id=session_id,
                            session_name=session_name,
                            model=model,
                            total_tokens=0,
                        ),
                    )
                    _set_run_live_phase(run_id, "idle")
                    _run_set_status(run_id, "completed", finished=True)
                    return
                else:
                    screenshot_message = _browser_screenshot_image_message(tool, tool_result)
                    if _has_native_tc:
                        # Native path: use tool role so model sees structured result.
                        convo.append({
                            "role": "tool",
                            "tool_call_id": _tc_id or "call_0",
                            "content": _safe_json(_model_visible_tool_result(tool, tool_result)),
                        })
                        if screenshot_message:
                            convo.append(screenshot_message)
                    else:
                        follow_up_text = (
                            f"[MCP执行{'失败' if tool_failed else '确认'}]\n"
                            f"系统已执行工具：{tool}\n"
                            f"执行状态：{'失败' if tool_failed else '成功'}\n\n"
                            "[工具参数]\n"
                            f"{_safe_json(arguments)}\n\n"
                            "[工具执行结果]\n"
                            f"{_safe_json(_model_visible_tool_result(tool, tool_result))}\n\n"
                            "请基于以上结果继续完成任务。"
                        )
                        if screenshot_message:
                            convo.append({
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": follow_up_text},
                                    *screenshot_message["content"],
                                ],
                            })
                        else:
                            convo.append({"role": "user", "content": follow_up_text})
                _set_run_live_phase(run_id, "generating")

            notice = (
                "[系统提示]\n"
                f"本轮已达到 MCP 连续执行步数上限（{max_steps}）。"
                "系统已暂停本轮自动继续，避免无限循环；如需继续，请发送新消息或提高系统设置里的 MCP 最大步数。"
            )
            _save_message(
                bg,
                user_id,
                ChatMessageCreate(
                    role="system",
                    content=notice,
                    tags="system_notice_mcp_max_steps",
                    ai_config_id=ai_config_id,
                    ai_kind=ai_kind,
                    session_id=session_id,
                    session_name=session_name,
                    model=model,
                    total_tokens=0,
                ),
            )
            _run_set_status(run_id, "completed", finished=True)
    except Exception as exc:
        _run_set_status(run_id, "error", str(exc), finished=True)
