"""Recorder MCP tools — AI 自挂咽喉点录制（S4，见 doc/沉淀技能卡片-设计方案.md §4）.

``recorder.start`` 开录、``recorder.stop`` 收尾建卡，中间流经 ai-runtime dispatch
咽喉点的操作类工具调用被自动抄录（拦截逻辑在 ``ai_runtime/inference/core.py`` 调用
``api.services.skill_recording.record_endpoint_event``）。

两种模式（§4.0）：

- ``auto``  AI 自挂开关、动作自动抄录；断言/消歧/脱敏由 stop 时启发式生成。
- ``teach`` 用户逐步指挥、逐步确认；用 ``recorder.annotate`` 把人工确认的断言/消歧/
  脱敏当场钉死，质量更高。

实际加工与状态机都在 ``skill_recording`` 服务里，这里只做参数校验与转交。
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException

from api.services import skill_recording
from .skill_card import _skill_card_create


def _recorder_start(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    try:
        return skill_recording.start_recording(user_id, ai_config_id, args or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _recorder_status(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    return skill_recording.recording_status(user_id, ai_config_id)


def _recorder_annotate(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    args = args or {}
    annotation: Dict[str, Any] = {}
    for key in ("assert", "disambiguate", "secret", "params", "note", "drop"):
        if key in args:
            annotation[key] = args[key]
    # ``assert`` 是 Python 关键字，工具入参也允许用 ``assertion`` 传。
    if "assertion" in args and "assert" not in annotation:
        annotation["assert"] = args["assertion"]
    step_index = args.get("step_index")
    try:
        return skill_recording.annotate_recording(
            user_id, ai_config_id, annotation,
            step_index=int(step_index) if step_index is not None else None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _recorder_stop(user_id: int, args: Dict[str, Any], ai_config_id: Optional[int]) -> Dict[str, Any]:
    args = args or {}

    def _create(card_args: Dict[str, Any]) -> Dict[str, Any]:
        # 录制建卡复用 skill_card.create（同一套校验、版本快照、draft 起点）。
        return _skill_card_create(user_id, card_args, ai_config_id)

    try:
        return skill_recording.stop_recording(
            user_id, ai_config_id,
            drop_tail=int(args.get("drop_tail") or 0),
            cancel=bool(args.get("cancel")),
            create_card=_create,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
