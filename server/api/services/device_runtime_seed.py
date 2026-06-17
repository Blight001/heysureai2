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
        "name": "screen.capture",
        "description": "整屏截图（Python/mss）。返回 JPEG dataUrl，服务器自动存到 Screenshots 并按需发用户。",
        "input_schema": _schema({"display": {"type": "number", "description": "显示器序号，默认 0"}}, []),
        "source": (
            "import mss, base64, io\n"
            "from PIL import Image\n"
            "disp = int(args.get('display') or 0)\n"
            "with mss.mss() as sct:\n"
            "    mons = sct.monitors\n"
            "    mon = mons[disp + 1] if 0 <= disp + 1 < len(mons) else mons[0]\n"
            "    raw = sct.grab(mon)\n"
            "img = Image.frombytes('RGB', raw.size, raw.rgb)\n"
            "if img.width > 1280:\n"
            "    img = img.resize((1280, max(1, img.height * 1280 // img.width)))\n"
            "buf = io.BytesIO(); img.save(buf, format='JPEG', quality=60)\n"
            "result = {'dataUrl': 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(), 'width': img.width, 'height': img.height}"
        ),
    },
    {
        "name": "screen.capture_region",
        "description": "截取屏幕矩形区域（Python/mss）。返回 JPEG dataUrl，服务器自动存盘。",
        "input_schema": _schema({"x": {"type": "number"}, "y": {"type": "number"}, "width": {"type": "number"}, "height": {"type": "number"}}, ["width", "height"]),
        "source": (
            "import mss, base64, io\n"
            "from PIL import Image\n"
            "box = {'left': int(args.get('x') or 0), 'top': int(args.get('y') or 0), 'width': int(args['width']), 'height': int(args['height'])}\n"
            "with mss.mss() as sct:\n"
            "    raw = sct.grab(box)\n"
            "img = Image.frombytes('RGB', raw.size, raw.rgb)\n"
            "buf = io.BytesIO(); img.save(buf, format='JPEG', quality=70)\n"
            "result = {'dataUrl': 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(), 'width': img.width, 'height': img.height}"
        ),
    },
    {
        "name": "screen.info",
        "description": "列出显示器及分辨率（Python/mss）。",
        "input_schema": _OBJ,
        "source": (
            "import mss\n"
            "with mss.mss() as sct:\n"
            "    mons = sct.monitors[1:]\n"
            "result = {'monitors': [{'index': i, 'left': m['left'], 'top': m['top'], 'width': m['width'], 'height': m['height']} for i, m in enumerate(mons)]}"
        ),
    },
    {
        "name": "vision.capture",
        "description": "采集整屏用于视觉理解（Python/mss）。返回 JPEG dataUrl，服务器存盘并发用户。",
        "input_schema": _schema({"display": {"type": "number"}, "send_to_user": {"type": "boolean"}}, []),
        "source": (
            "import mss, base64, io\n"
            "from PIL import Image\n"
            "disp = int(args.get('display') or 0)\n"
            "with mss.mss() as sct:\n"
            "    mons = sct.monitors\n"
            "    mon = mons[disp + 1] if 0 <= disp + 1 < len(mons) else mons[0]\n"
            "    raw = sct.grab(mon)\n"
            "img = Image.frombytes('RGB', raw.size, raw.rgb)\n"
            "if img.width > 1280:\n"
            "    img = img.resize((1280, max(1, img.height * 1280 // img.width)))\n"
            "buf = io.BytesIO(); img.save(buf, format='JPEG', quality=60)\n"
            "result = {'dataUrl': 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(), 'width': img.width, 'height': img.height, 'send_to_user': args.get('send_to_user', True)}"
        ),
    },
    {
        "name": "vision.capture_mouse",
        "description": "采集鼠标周围区域用于视觉理解（Python/mss + pyautogui）。返回 JPEG dataUrl。",
        "input_schema": _schema({"radius": {"type": "number", "description": "半径，默认 200"}}, []),
        "source": (
            "import mss, base64, io, pyautogui\n"
            "from PIL import Image\n"
            "r = int(args.get('radius') or 200)\n"
            "mx, my = pyautogui.position()\n"
            "box = {'left': max(0, mx - r), 'top': max(0, my - r), 'width': r * 2, 'height': r * 2}\n"
            "with mss.mss() as sct:\n"
            "    raw = sct.grab(box)\n"
            "img = Image.frombytes('RGB', raw.size, raw.rgb)\n"
            "buf = io.BytesIO(); img.save(buf, format='JPEG', quality=70)\n"
            "result = {'dataUrl': 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(), 'width': img.width, 'height': img.height, 'send_to_user': args.get('send_to_user', True)}"
        ),
    },
    {
        "name": "window.list",
        "description": "列出可见顶层窗口标题（Python；Win 用 pygetwindow，Linux 用 wmctrl）。",
        "input_schema": _OBJ,
        "source": (
            "import sys\n"
            "wins = []\n"
            "if sys.platform == 'win32':\n"
            "    import pygetwindow as gw\n"
            "    wins = [t for t in gw.getAllTitles() if t and t.strip()]\n"
            "else:\n"
            "    import subprocess\n"
            "    out = subprocess.run(['wmctrl', '-l'], capture_output=True, text=True).stdout\n"
            "    wins = [' '.join(line.split()[3:]) for line in out.splitlines() if line.strip()]\n"
            "result = {'windows': wins}"
        ),
    },
    {
        "name": "window.focus",
        "description": "把标题匹配的窗口切到前台（Python；Win pygetwindow，Linux wmctrl -a）。",
        "input_schema": _schema({"title": {"type": "string"}}, ["title"]),
        "source": (
            "import sys\n"
            "title = str(args['title'])\n"
            "if sys.platform == 'win32':\n"
            "    import pygetwindow as gw\n"
            "    ws = gw.getWindowsWithTitle(title)\n"
            "    if not ws:\n"
            "        raise ValueError('window not found: ' + title)\n"
            "    ws[0].activate()\n"
            "else:\n"
            "    import subprocess\n"
            "    subprocess.run(['wmctrl', '-a', title], check=False)\n"
            "result = {'ok': True, 'title': title}"
        ),
    },
    {
        "name": "window.close",
        "description": "按标题关闭窗口（Python；Win pygetwindow，Linux wmctrl -c）。",
        "input_schema": _schema({"title": {"type": "string"}}, ["title"]),
        "source": (
            "import sys\n"
            "title = str(args['title'])\n"
            "if sys.platform == 'win32':\n"
            "    import pygetwindow as gw\n"
            "    ws = gw.getWindowsWithTitle(title)\n"
            "    if not ws:\n"
            "        raise ValueError('window not found: ' + title)\n"
            "    ws[0].close()\n"
            "else:\n"
            "    import subprocess\n"
            "    subprocess.run(['wmctrl', '-c', title], check=False)\n"
            "result = {'ok': True, 'title': title}"
        ),
    },
    {
        "name": "ui.inspect",
        "description": "读取前台窗口的 UI Automation 控件树（Python/uiautomation，仅 Windows）。返回每个控件的 name/control_type/automation_id/rect。",
        "input_schema": _schema({"title": {"type": "string"}, "max": {"type": "number"}, "max_depth": {"type": "number"}}, []),
        "source": (
            "import uiautomation as auto\n"
            "title = args.get('title')\n"
            "root = auto.WindowControl(searchDepth=2, SubName=str(title)) if title else auto.GetForegroundControl()\n"
            "limit = int(args.get('max') or 150)\n"
            "depth = int(args.get('max_depth') or 8)\n"
            "elems = []\n"
            "for c, d in auto.WalkControl(root, maxDepth=depth):\n"
            "    r = c.BoundingRectangle\n"
            "    elems.append({'name': c.Name, 'control_type': c.ControlTypeName, 'automation_id': c.AutomationId, 'rect': [r.left, r.top, r.right, r.bottom]})\n"
            "    if len(elems) >= limit:\n"
            "        break\n"
            "result = {'window': root.Name, 'elements': elems}"
        ),
    },
    {
        "name": "ui.click",
        "description": "按 UI Automation 控件定位并点击（Python/uiautomation，仅 Windows）。优先 InvokePattern，不支持则真实点击控件中心。",
        "input_schema": _schema({"title": {"type": "string"}, "name": {"type": "string"}, "automation_id": {"type": "string"}, "control_type": {"type": "string"}, "max_depth": {"type": "number"}}, []),
        "source": (
            "import uiautomation as auto\n"
            "title = args.get('title')\n"
            "root = auto.WindowControl(searchDepth=2, SubName=str(title)) if title else auto.GetForegroundControl()\n"
            "name = args.get('name'); aid = args.get('automation_id'); ctype = args.get('control_type')\n"
            "depth = int(args.get('max_depth') or 8)\n"
            "target = None\n"
            "for c, d in auto.WalkControl(root, maxDepth=depth):\n"
            "    if aid and c.AutomationId != aid:\n"
            "        continue\n"
            "    if name and str(name) not in (c.Name or ''):\n"
            "        continue\n"
            "    if ctype and c.ControlTypeName != ctype:\n"
            "        continue\n"
            "    target = c; break\n"
            "if target is None:\n"
            "    raise ValueError('control not found')\n"
            "try:\n"
            "    target.GetInvokePattern().Invoke()\n"
            "except Exception:\n"
            "    target.Click()\n"
            "result = {'ok': True, 'name': target.Name}"
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
