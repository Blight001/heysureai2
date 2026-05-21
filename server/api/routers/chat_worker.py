IS_ROUTER_ENTRY = False

import asyncio
import json
import time
from typing import Dict, List, Optional

import requests
from sqlmodel import Session, select

from api.database import engine
from api.mcp import registry, reset_mcp_runtime_overrides, set_mcp_runtime_overrides
from api.models import AITaskJob, AssistantAIConfig, ChatMessage, ChatMessageCreate, ChatRun, User
from api.task_system import (
    DEFAULT_SYSTEM_AUTO_CONTROL,
    TASK_RUNTIME_REQUIRED_TOOLS,
    normalize_system_auto_control,
    with_task_create_compat,
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
    _set_run_live_phase,
    _set_run_live_text,
    _set_run_live_usage,
    _strip_prompt_section,
    _strip_task_runtime_sections,
)
from .chat_persistence import _save_message
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
    max_steps: int = 12,
):
    if _run_should_stop(run_id):
        _run_set_status(run_id, "stopped", finished=True)
        return
    _run_set_status(run_id, "running")
    try:
        with Session(engine) as bg:
            user = bg.get(User, user_id)
            if not user:
                raise RuntimeError("User not found")
            mcp_warning_template = str(getattr(user, "mcp_format_error_hint", "") or "").strip()
            cfg, api_key, base_url, model, system_prompt = _resolve_ai_runtime(bg, user, ai_kind, ai_config_id)
            auto_ctl = normalize_system_auto_control(cfg.system_auto_control if cfg else None)
            inheritance_notice_emitted = False
            task_payload = _load_task_payload_by_session(bg, user_id, ai_config_id, session_id)
            task_job = _load_task_job_by_session(bg, user_id, ai_config_id, session_id)
            is_task_runtime = bool(task_payload) or str(session_id or "").startswith("session_task_")
            effective_tool_allowlist = _parse_allowed_tools(cfg.mcp_tools if cfg else None)
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
                        effective_tool_allowlist = with_task_create_compat(effective_tool_allowlist)
                        effective_tool_allowlist = with_workspace_read_by_name_compat(effective_tool_allowlist)
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
                if m.role in ("user", "assistant"):
                    convo.append({"role": m.role, "content": m.content})
            if model_user_content:
                for i in range(len(convo) - 1, -1, -1):
                    if convo[i].get("role") == "user":
                        convo[i] = {"role": "user", "content": model_user_content}
                        break

            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
            last_rejected_tool_sig = ""
            rejected_repeat = 0

            # Build native tool_use payload once (allowlist is fixed for this run).
            mcp_active = bool(cfg and cfg.mcp_enabled and effective_tool_allowlist)
            step_tools = registry.build_tools_payload(effective_tool_allowlist) if mcp_active else []

            for _ in range(max_steps):
                if _run_should_stop(run_id):
                    _run_set_status(run_id, "stopped", finished=True)
                    return

                payload = {
                    "model": model,
                    "messages": convo,
                    "stream": True,
                    "stream_options": {"include_usage": True},
                }
                if step_tools:
                    payload["tools"] = step_tools
                    payload["tool_choice"] = "auto"
                start_at = time.time()
                response = requests.post(base_url, headers=headers, json=payload, timeout=300, stream=True)
                response.raise_for_status()
                assistant_text = ""
                usage = {}
                finish_reason = None
                last_push_at = 0.0
                payload_call = None
                # Native tool_calls accumulation (OpenAI-compatible streaming format)
                _tc_id = ""
                _tc_name = ""
                _tc_args = ""
                _has_native_tc = False
                _set_run_live_text(run_id, assistant_text)
                _set_run_live_phase(run_id, "generating")
                _set_run_live_usage(run_id, 0, 0, 0)
                for raw_line in response.iter_lines():
                    if _run_should_stop(run_id):
                        response.close()
                        _set_run_live_text(run_id, "")
                        _run_set_status(run_id, "stopped", finished=True)
                        return
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8")
                    if not line.startswith("data: "):
                        continue
                    payload_line = line[6:].strip()
                    if payload_line == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload_line)
                    except Exception:
                        continue
                    if isinstance(chunk.get("usage"), dict):
                        usage = chunk["usage"]
                        _set_run_live_usage(
                            run_id,
                            int(usage.get("prompt_tokens") or 0),
                            int(usage.get("completion_tokens") or 0),
                            int(usage.get("total_tokens") or 0),
                        )
                    choices = chunk.get("choices") or []
                    if choices:
                        finish_reason = choices[0].get("finish_reason") or finish_reason
                        delta = choices[0].get("delta") or {}

                        # Native tool_calls streaming (OpenAI / DeepSeek compatible)
                        tc_list = delta.get("tool_calls")
                        if tc_list:
                            _has_native_tc = True
                            for _tc in tc_list:
                                if _tc.get("id"):
                                    _tc_id = _tc["id"]
                                _fn = _tc.get("function") or {}
                                if _fn.get("name"):
                                    _tc_name += _fn["name"]
                                if _fn.get("arguments"):
                                    _tc_args += _fn["arguments"]
                            continue

                        delta_text = _extract_delta_text(delta)
                        if delta_text:
                            if payload_call:
                                # Keep reading stream for usage/[DONE] after tool call is found.
                                continue
                            assistant_text += delta_text
                            # Text-based fallback: only scan when no native tool call is accumulating.
                            if not _has_native_tc:
                                parsed_call, mcp_match = _extract_first_complete_mcp_call(assistant_text)
                                if parsed_call and mcp_match:
                                    assistant_text = assistant_text[:mcp_match.end()]
                                    payload_call = parsed_call
                                    _set_run_live_text(run_id, assistant_text)
                                    finish_reason = finish_reason or "mcp_wait"
                                    continue
                            now = time.time()
                            if (now - last_push_at) >= 0.05:
                                _set_run_live_text(run_id, assistant_text)
                                last_push_at = now
                response.close()
                if _run_should_stop(run_id):
                    _set_run_live_text(run_id, "")
                    _run_set_status(run_id, "stopped", finished=True)
                    return
                _set_run_live_text(run_id, assistant_text)
                latency = time.time() - start_at

                saved = _save_message(
                    bg,
                    user_id,
                    ChatMessageCreate(
                        role="assistant",
                        content=assistant_text,
                        think=None,
                        ai_config_id=ai_config_id,
                        ai_kind=ai_kind,
                        session_id=session_id,
                        session_name=session_name,
                        model=model,
                        prompt_tokens=int(usage.get("prompt_tokens") or 0),
                        completion_tokens=int(usage.get("completion_tokens") or 0),
                        total_tokens=int(usage.get("total_tokens") or 0),
                        system_prompt=system_prompt,
                        finish_reason=finish_reason,
                        latency=latency,
                    ),
                )
                if _has_native_tc and _tc_name:
                    convo.append({
                        "role": "assistant",
                        "content": assistant_text or None,
                        "tool_calls": [{
                            "id": _tc_id or "call_0",
                            "type": "function",
                            "function": {"name": _tc_name, "arguments": _tc_args},
                        }],
                    })
                else:
                    convo.append({"role": "assistant", "content": assistant_text})
                _set_run_live_text(run_id, "")
                _set_run_live_usage(run_id, 0, 0, 0)

                # Resolve payload_call: prefer native tool_calls, fall back to text parsing.
                if _has_native_tc and _tc_name:
                    try:
                        _tc_arguments = json.loads(_tc_args or "{}")
                    except Exception:
                        _tc_arguments = {}
                    payload_call = {"tool": _tc_name, "arguments": _tc_arguments}
                elif not payload_call:
                    payload_call = _extract_first_mcp_call(assistant_text)
                payload_tool = str((payload_call or {}).get("tool") or "").strip()
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
                    _run_set_status(run_id, "completed", finished=True)
                    return
                if _run_should_stop(run_id):
                    _run_set_status(run_id, "stopped", finished=True)
                    return
                if cfg and not cfg.mcp_enabled:
                    _run_set_status(run_id, "error", "MCP is disabled for this AI", finished=True)
                    return

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
                    tool_result = asyncio.run(registry.call(tool, user_id, arguments, ai_config_id))
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
                    if _has_native_tc:
                        # Native path: use tool role so model sees structured result.
                        convo.append({
                            "role": "tool",
                            "tool_call_id": _tc_id or "call_0",
                            "content": _safe_json(tool_result.get("result", tool_result)),
                        })
                    else:
                        follow_up = (
                            f"[MCP执行{'失败' if tool_failed else '确认'}]\n"
                            f"系统已执行工具：{tool}\n"
                            f"执行状态：{'失败' if tool_failed else '成功'}\n\n"
                            "[工具参数]\n"
                            f"{_safe_json(arguments)}\n\n"
                            "[工具执行结果]\n"
                            f"{_safe_json(tool_result.get('result', tool_result))}\n\n"
                            "请基于以上结果继续完成任务。"
                        )
                        convo.append({"role": "user", "content": follow_up})
                _set_run_live_phase(run_id, "generating")

            _run_set_status(run_id, "error", f"Reached max steps ({max_steps})", finished=True)
    except Exception as exc:
        _run_set_status(run_id, "error", str(exc), finished=True)
