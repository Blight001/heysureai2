"""Default desktop runtime (Python) tool definitions — phase 4 of the
设备端MCP代码下放长期方案.

The device no longer ships fixed TypeScript implementations for keyboard /
mouse / clipboard / process. Those are deleted on the device; the server is now
the source of their code, shipped as ``runtime=python`` tools that the device's
python-runner executes (pyautogui / pyperclip / psutil).

Seeded as ``status='active'`` (operator-trusted system migration, §7.3) with no
declared permission tags so behaviour matches the previously-ungated native
tools; operators can tighten via the permission policy editor afterwards.
"""

import json
import time
from typing import Any, Dict, List

from sqlmodel import Session, select

from api.database import engine
from api.models import DeviceDynamicTool

_OBJ = {"type": "object"}


def _schema(props: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


# name -> definition. Python bodies read ``args`` (dict) and assign ``result``.
DEFAULT_DESKTOP_RUNTIME_TOOLS: List[Dict[str, Any]] = [
    {
        "name": "keyboard.type",
        "description": "在当前焦点处输入文本（Python/pyautogui）。",
        "input_schema": _schema({"text": {"type": "string", "description": "要输入的文本"}}, ["text"]),
        "source": "import pyautogui\npyautogui.write(str(args.get('text', '')), interval=0.01)\nresult = {'ok': True}",
    },
    {
        "name": "keyboard.press",
        "description": "按下组合键，如 ctrl+c（Python/pyautogui）。keys 可为字符串或数组。",
        "input_schema": _schema({"keys": {"description": "如 'ctrl+c' 或 ['ctrl','c']"}}, ["keys"]),
        "source": (
            "import pyautogui\n"
            "keys = args.get('keys')\n"
            "if isinstance(keys, str):\n"
            "    keys = [k.strip() for k in keys.replace('+', ' ').split() if k.strip()]\n"
            "if not isinstance(keys, list) or not keys:\n"
            "    raise ValueError('keys is required')\n"
            "pyautogui.hotkey(*keys) if len(keys) > 1 else pyautogui.press(keys[0])\n"
            "result = {'ok': True, 'keys': keys}"
        ),
    },
    {
        "name": "mouse.move",
        "description": "移动鼠标到 (x, y)（Python/pyautogui）。",
        "input_schema": _schema({"x": {"type": "number"}, "y": {"type": "number"}}, ["x", "y"]),
        "source": "import pyautogui\npyautogui.moveTo(args['x'], args['y'])\nresult = {'ok': True}",
    },
    {
        "name": "mouse.click",
        "description": "在 (x, y) 单击（缺省在当前位置）。button: left/right/middle。",
        "input_schema": _schema({"x": {"type": "number"}, "y": {"type": "number"}, "button": {"type": "string"}}, []),
        "source": (
            "import pyautogui\n"
            "kw = {'button': args.get('button', 'left')}\n"
            "if args.get('x') is not None and args.get('y') is not None:\n"
            "    kw['x'] = args['x']; kw['y'] = args['y']\n"
            "pyautogui.click(**kw)\nresult = {'ok': True}"
        ),
    },
    {
        "name": "mouse.double_click",
        "description": "在 (x, y) 双击（缺省在当前位置）。",
        "input_schema": _schema({"x": {"type": "number"}, "y": {"type": "number"}}, []),
        "source": (
            "import pyautogui\n"
            "kw = {}\n"
            "if args.get('x') is not None and args.get('y') is not None:\n"
            "    kw['x'] = args['x']; kw['y'] = args['y']\n"
            "pyautogui.doubleClick(**kw)\nresult = {'ok': True}"
        ),
    },
    {
        "name": "mouse.right_click",
        "description": "在 (x, y) 右键单击（缺省在当前位置）。",
        "input_schema": _schema({"x": {"type": "number"}, "y": {"type": "number"}}, []),
        "source": (
            "import pyautogui\n"
            "kw = {'button': 'right'}\n"
            "if args.get('x') is not None and args.get('y') is not None:\n"
            "    kw['x'] = args['x']; kw['y'] = args['y']\n"
            "pyautogui.click(**kw)\nresult = {'ok': True}"
        ),
    },
    {
        "name": "mouse.scroll",
        "description": "滚动鼠标滚轮，amount 正为上、负为下（Python/pyautogui）。",
        "input_schema": _schema({"amount": {"type": "number"}}, ["amount"]),
        "source": "import pyautogui\npyautogui.scroll(int(args.get('amount', 0)))\nresult = {'ok': True}",
    },
    {
        "name": "mouse.drag",
        "description": "从 (x1,y1) 拖拽到 (x2,y2)（Python/pyautogui）。",
        "input_schema": _schema({"x1": {"type": "number"}, "y1": {"type": "number"}, "x2": {"type": "number"}, "y2": {"type": "number"}}, ["x1", "y1", "x2", "y2"]),
        "source": (
            "import pyautogui\n"
            "pyautogui.moveTo(args['x1'], args['y1'])\n"
            "pyautogui.dragTo(args['x2'], args['y2'], duration=0.2, button='left')\n"
            "result = {'ok': True}"
        ),
    },
    {
        "name": "clipboard.get",
        "description": "读取剪贴板文本（Python/pyperclip）。",
        "input_schema": _OBJ,
        "source": "import pyperclip\nresult = {'text': pyperclip.paste()}",
    },
    {
        "name": "clipboard.set",
        "description": "写入剪贴板文本（Python/pyperclip）。",
        "input_schema": _schema({"text": {"type": "string"}}, ["text"]),
        "source": "import pyperclip\npyperclip.copy(str(args.get('text', '')))\nresult = {'ok': True}",
    },
    {
        "name": "process.list",
        "description": "列出进程（pid/name/cpu/mem，Python/psutil）。",
        "input_schema": _schema({"name_contains": {"type": "string", "description": "可选：按名称子串过滤"}}, []),
        "source": (
            "import psutil\n"
            "needle = str(args.get('name_contains') or '').lower()\n"
            "rows = []\n"
            "for p in psutil.process_iter(['pid', 'name']):\n"
            "    name = p.info.get('name') or ''\n"
            "    if needle and needle not in name.lower():\n"
            "        continue\n"
            "    rows.append({'pid': p.info['pid'], 'name': name})\n"
            "result = {'processes': rows[:500], 'count': len(rows)}"
        ),
    },
    {
        "name": "process.kill",
        "description": "结束指定 pid 的进程（Python/psutil）。",
        "input_schema": _schema({"pid": {"type": "number"}}, ["pid"]),
        "source": (
            "import psutil\n"
            "p = psutil.Process(int(args['pid']))\n"
            "p.terminate()\n"
            "result = {'ok': True, 'pid': int(args['pid'])}"
        ),
    },
    {
        "name": "text.input",
        "description": "向当前焦点处一次性粘贴大段文本（剪贴板 + Ctrl+V，Python）。",
        "input_schema": _schema({"text": {"type": "string"}, "paste": {"type": "boolean"}}, ["text"]),
        "source": (
            "import pyperclip, pyautogui\n"
            "pyperclip.copy(str(args.get('text', '')))\n"
            "if args.get('paste', True):\n"
            "    pyautogui.hotkey('ctrl', 'v')\n"
            "result = {'ok': True}"
        ),
    },
    {
        "name": "fs.list",
        "description": "列出工作区某路径下的文件/子目录（Python）。",
        "input_schema": _schema({"path": {"type": "string", "description": "相对工作区路径，默认 '.'"}}, []),
        "source": (
            "import os\n"
            "base = os.path.join(os.getcwd(), str(args.get('path') or '.'))\n"
            "result = {'path': base, 'entries': sorted(os.listdir(base))}"
        ),
    },
    {
        "name": "fs.read",
        "description": "读取工作区中某文件内容（Python，默认上限 200KB）。",
        "input_schema": _schema({"path": {"type": "string"}, "maxBytes": {"type": "number"}}, ["path"]),
        "source": (
            "import os\n"
            "p = os.path.join(os.getcwd(), str(args['path']))\n"
            "cap = int(args.get('maxBytes') or 200000)\n"
            "with open(p, 'r', encoding='utf-8', errors='replace') as f:\n"
            "    data = f.read(cap + 1)\n"
            "result = {'path': p, 'content': data[:cap], 'truncated': len(data) > cap}"
        ),
    },
    {
        "name": "fs.write",
        "description": "在工作区中创建/覆盖一个文件（Python，属写入操作）。",
        "input_schema": _schema({"path": {"type": "string"}, "content": {"type": "string"}}, ["path", "content"]),
        "source": (
            "import os\n"
            "p = os.path.join(os.getcwd(), str(args['path']))\n"
            "os.makedirs(os.path.dirname(p) or '.', exist_ok=True)\n"
            "with open(p, 'w', encoding='utf-8') as f:\n"
            "    f.write(str(args.get('content', '')))\n"
            "result = {'ok': True, 'path': p}"
        ),
    },
    {
        "name": "git.diff",
        "description": "查看工作区（或子目录）当前的 git diff（Python/subprocess）。",
        "input_schema": _schema({"cwd": {"type": "string", "description": "相对工作区的仓库目录"}}, []),
        "source": (
            "import os, subprocess\n"
            "cwd = os.path.join(os.getcwd(), str(args.get('cwd') or '.'))\n"
            "r = subprocess.run(['git', '-C', cwd, 'diff'], capture_output=True, text=True)\n"
            "result = {'stdout': r.stdout[:100000], 'stderr': r.stderr[:4000], 'exitCode': r.returncode}"
        ),
    },
    {
        "name": "display.box",
        "description": "在桌面最上层短暂显示一个半透明高亮框（Python/tkinter），到时自动消失。用途：标记 AI 识别到的屏幕区域。需要 tkinter（Windows 自带；Linux 需 python3-tk）。",
        "input_schema": _schema(
            {
                "left": {"type": "number", "description": "左上角 X（像素）"},
                "top": {"type": "number", "description": "左上角 Y（像素）"},
                "width": {"type": "number"},
                "height": {"type": "number"},
                "duration": {"type": "number", "description": "显示毫秒数，默认 1000"},
                "color": {"type": "string", "description": "颜色，默认 red"},
                "label": {"type": "string", "description": "可选标签文字"},
            },
            ["width", "height"],
        ),
        "source": (
            "import tkinter as tk\n"
            "left = int(args.get('left') or 0)\n"
            "top = int(args.get('top') or 0)\n"
            "width = int(args.get('width'))\n"
            "height = int(args.get('height'))\n"
            "duration = int(args.get('duration') or 1000)\n"
            "color = str(args.get('color') or 'red')\n"
            "label = str(args.get('label') or '')\n"
            "root = tk.Tk()\n"
            "root.overrideredirect(True)\n"
            "root.attributes('-topmost', True)\n"
            "try:\n"
            "    root.attributes('-alpha', 0.35)\n"
            "except Exception:\n"
            "    pass\n"
            "root.geometry('%dx%d+%d+%d' % (width, height, left, top))\n"
            "root.configure(bg=color)\n"
            "if label:\n"
            "    tk.Label(root, text=label, bg=color, fg='white').place(x=2, y=2)\n"
            "root.after(max(1, duration), root.destroy)\n"
            "root.mainloop()\n"
            "result = {'ok': True}"
        ),
    },
    {
        "name": "speech.speak",
        "description": "文字转语音朗读（Python/pyttsx3，跨平台 SAPI/espeak）。",
        "input_schema": _schema({"text": {"type": "string"}, "rate": {"type": "number"}, "volume": {"type": "number"}}, ["text"]),
        "source": (
            "import pyttsx3\n"
            "engine = pyttsx3.init()\n"
            "if args.get('rate') is not None:\n"
            "    engine.setProperty('rate', int(args['rate']))\n"
            "if args.get('volume') is not None:\n"
            "    engine.setProperty('volume', float(args['volume']) / 100.0)\n"
            "engine.say(str(args.get('text', '')))\n"
            "engine.runAndWait()\n"
            "result = {'ok': True}"
        ),
    },
]

_DEFAULT_NAMES = {t["name"] for t in DEFAULT_DESKTOP_RUNTIME_TOOLS}


def _is_legacy_wrapper(row: DeviceDynamicTool) -> bool:
    """True if this row is an auto-seeded JS passthrough (``return await
    cap.call("<name>", args)``). The device no longer exposes any ``cap``
    builtins, so these are dead and safe to migrate/archive. Operator-authored
    multi-step JS (which doesn't match the passthrough shape) is left untouched."""
    if (getattr(row, "code_kind", "") or "") != "js":
        return False
    js = (getattr(row, "js_source", "") or "").strip()
    return js.startswith("return await cap.call(") and js.endswith("args)")


def seed_default_desktop_runtime_tools(user_id: int) -> int:
    """Insert the default python tools for a user's desktop (idempotent), and
    migrate any legacy JS cap.call wrappers of the same name to python. Returns
    how many rows were created or migrated."""
    now = time.time()
    changed = 0
    with Session(engine) as session:
        existing = {
            row.name: row
            for row in session.exec(
                select(DeviceDynamicTool).where(
                    DeviceDynamicTool.user_id == user_id,
                    DeviceDynamicTool.device_type == "desktop",
                    DeviceDynamicTool.name.in_(_DEFAULT_NAMES),  # type: ignore[attr-defined]
                )
            ).all()
        }
        for spec in DEFAULT_DESKTOP_RUNTIME_TOOLS:
            row = existing.get(spec["name"])
            if row is not None and not _is_legacy_wrapper(row):
                continue  # operator-authored or already python — never clobber
            if row is None:
                row = DeviceDynamicTool(
                    user_id=user_id, device_type="desktop", name=spec["name"], created_at=now
                )
                session.add(row)
            row.description = spec["description"]
            row.input_schema_json = json.dumps(spec["input_schema"], ensure_ascii=False)
            row.code_kind = "runtime"
            row.code_json = "[]"
            row.js_source = ""
            row.runtime = "python"
            row.source = spec["source"]
            row.permissions_json = "[]"
            row.enabled = True
            row.status = "active"
            row.updated_at = now
            changed += 1

        # Archive orphaned auto-seeded wrappers: native builtins were removed from
        # the device (phase 4), so any leftover cap.call passthrough that we did
        # NOT migrate to python above (screen/vision/window/display/hands/ear/…)
        # can no longer run. Shelve them so they stop shipping; history is kept.
        orphans = session.exec(
            select(DeviceDynamicTool).where(
                DeviceDynamicTool.user_id == user_id,
                DeviceDynamicTool.device_type == "desktop",
                DeviceDynamicTool.status == "active",
            )
        ).all()
        for row in orphans:
            if row.name in _DEFAULT_NAMES:
                continue
            if _is_legacy_wrapper(row):
                row.status = "archived"
                row.updated_at = now
                changed += 1

        if changed:
            session.commit()
    return changed
