# -*- coding: utf-8 -*-
"""工坊策略钩子 —— 控制"知识与进化方向"的唯一改动点。

每次工具调用都会经过这两个钩子：

    before_execute(tool, args)          → 改写/补全入参后再回调服务端
    after_execute(tool, args, result)   → 改写/增强结果后再返回给 AI

默认行为：
- 写入类工具（propose / input / review）的结果会附带 ``direction.md``
  的方向指引，提醒 AI 沉淀知识、提交进化建议时对齐方向；
- consult 检索结果同样附带方向指引，引导后续行动。

你可以在这里做任何事：给 propose 强制补 triggers、按方向过滤检索结果、
拒绝偏离方向的进化建议……改完重启工坊进程即可生效，服务端无需改动。
"""

from pathlib import Path
from typing import Any, Dict

_DIRECTION_FILE = Path(__file__).resolve().parent / "direction.md"

# 附带方向指引的工具（写入类 + 检索类）
_GUIDED_TOOLS = {
    "librarian.propose",
    "librarian.consult",
    "evolution.input",
    "evolution.review",
}


def load_direction() -> str:
    """读取方向文档；不存在或为空则返回空串。"""
    try:
        text = _DIRECTION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return text


def before_execute(tool: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """回调服务端前的入参钩子。默认原样放行。"""
    return args


def after_execute(tool: str, args: Dict[str, Any], result: Any) -> Any:
    """返回给 AI 前的结果钩子。默认给关键工具附带方向指引。"""
    if tool not in _GUIDED_TOOLS:
        return result
    direction = load_direction()
    if not direction:
        return result
    if isinstance(result, dict):
        enriched = dict(result)
        enriched["workshop_direction"] = direction
        return enriched
    return result
