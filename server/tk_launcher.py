"""Windows 单窗口启动器：用 modern Tk (customtkinter) 管理后端服务和 Web 控制台。

功能：
- 统一启动 / 停止 / 重启 gateway、mcp、connector、ai、web
- 每个服务独立日志页，支持复制日志与复制错误
- Web 控制台提供“打开网页”快捷按钮
- 启动器读取仓库根目录的 .env，让各子进程共享同一套环境变量
- 使用 customtkinter 提供现代圆角暗色 UI
"""

from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import webbrowser
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    import customtkinter as ctk
except ImportError as _e:  # pragma: no cover
    print("ERROR: customtkinter 未安装。请运行: pip install customtkinter")
    raise

import tkinter as tk  # 仅用于少量兼容（如 clipboard、after）


ROOT_DIR = Path(__file__).resolve().parents[1]
SERVER_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "web"
ENV_FILE = ROOT_DIR / ".env"
VENV_PYTHON = SERVER_DIR / "venv" / "Scripts" / "python.exe"
WEB_URL = "http://127.0.0.1:58150"


def _parse_env_file(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}

    values: Dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("set "):
            line = line[4:].strip()
        if line.lower().startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if (
            len(value) >= 2
            and ((value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")))
        ):
            value = value[1:-1]
        values[key] = value
    return values


def build_env() -> Dict[str, str]:
    env = _parse_env_file(ENV_FILE)
    env.update(os.environ)
    env.setdefault("MCP_RUNTIME_URL", "http://127.0.0.1:3001")
    env.setdefault("CONNECTOR_RUNTIME_URL", "http://127.0.0.1:3002")
    env.setdefault("AI_RUNTIME_URL", "http://127.0.0.1:3003")
    env.setdefault("HEYSURE_API_GATEWAY_URL", "http://127.0.0.1:3000")
    env.setdefault("SERVER_URL", "http://127.0.0.1:3000")
    env.setdefault("AI_DISPATCH_MODE", "remote")
    env.setdefault("HEYSURE_SERVER_RELOAD", "0")
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    env["PYTHONPATH"] = os.pathsep.join([str(SERVER_DIR / "main"), str(SERVER_DIR)])
    return env


def get_python_executable() -> str:
    return str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable


def timestamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def classify_line(line: str) -> str:
    """Classify a log line for coloring (full log view) and filtering (全部/警告/错误).
    Reliably parses the standard logging format used by the app:
        HH:MM:SS LEVEL   logger.name — message
    Falls back to keyword + status code detection for uvicorn direct output etc.
    """
    upper = line.upper()
    parts = line.split()

    # 1. Best: look for the LEVEL token directly (split removes padding/spaces)
    #    This catches INFO, WARNING, ERROR, etc. from our _ConsoleFormatter.
    for p in parts:
        pu = p.upper()
        if pu == "ERROR" or pu == "CRITICAL":
            return "error"
        if pu == "WARNING" or pu == "WARN":
            return "warning"
        if pu == "DEBUG":
            return "debug"
        if pu == "INFO":
            # continue scanning for other indicators below
            break

    # 2. Fallback keyword detection (for tracebacks, uvicorn direct prints, etc.)
    if "TRACEBACK" in upper or "EXCEPTION" in upper:
        return "error"
    if "[ERROR]" in upper or " CRITICAL" in upper or " ERROR " in upper or " ERROR:" in upper:
        return "error"
    if upper.lstrip().startswith("ERROR"):
        return "error"

    if "UVICORN.ERROR" in upper or ".ERROR —" in upper:
        if any(kw in upper for kw in ["FAILED", "EXCEPTION", "TIMEOUT", "REFUSED", "DENIED", "CONNECTION REFUSED"]):
            return "error"

    if "[WARN]" in upper or " WARNING " in upper or " WARN " in upper:
        return "warning"
    if upper.lstrip().startswith("WARNING") or upper.lstrip().startswith("WARN"):
        return "warning"

    if "[DEBUG]" in upper or " DEBUG " in upper:
        return "debug"
    if "[SUCCESS]" in upper or " SUCCESS " in upper:
        return "success"

    # 3. HTTP status codes from access logs
    if "UVICORN.ACCESS" in upper or 'HTTP/1.1"' in upper or "HTTP/1.1 " in upper:
        for token in reversed(parts):
            if token.isdigit() and len(token) == 3:
                code = int(token)
                if code >= 500:
                    return "error"
                if code >= 400:
                    return "warning"
                break

    return "info"


@dataclass(frozen=True)
class ServiceSpec:
    key: str
    title: str
    accent: str
    launch_mode: str = "python"
    module: Optional[str] = None
    command: Optional[Tuple[str, ...]] = None
    cwd: Optional[Path] = None
    requires_database: bool = True
    open_url: Optional[str] = None
    port: Optional[str] = None


SERVICES: tuple[ServiceSpec, ...] = (
    ServiceSpec("gateway", "🌐 API 网关", "#3b82f6", module="gateway.main", port="3000"),
    ServiceSpec("mcp", "🔧 MCP 运行时", "#10b981", module="mcp_runtime.main", port="3001"),
    ServiceSpec("connector", "🔌 连接器", "#f59e0b", module="connector_runtime.main", port="3002"),
    ServiceSpec("ai", "🤖 AI 运行时", "#8b5cf6", module="ai_runtime.main", port="3003"),
    ServiceSpec(
        "web",
        "🖥️ Web 控制台",
        "#22c55e",
        launch_mode="command",
        command=("cmd.exe", "/c", "run.bat"),
        cwd=WEB_DIR,
        requires_database=False,
        open_url=WEB_URL,
        port="58150",
    ),
)


class ServicePane:
    def __init__(self, master: ctk.CTkFrame, spec: ServiceSpec, controller: "LauncherApp") -> None:
        self.spec = spec
        self.controller = controller
        self.process: Optional[subprocess.Popen[str]] = None
        self.run_id = 0
        self.history: List[Tuple[str, str]] = []
        self.log_filter = "all"  # all | warning | error

        # 使用 customtkinter 现代卡片式面板
        # 直接 toolbar(0) → log(1)，状态颜色圆球只在顶部概览栏每个栏目左侧显示
        self.frame = ctk.CTkFrame(master, corner_radius=12, fg_color="#111827")
        self.frame.grid_columnconfigure(0, weight=1)
        self.frame.grid_rowconfigure(1, weight=1)

        self._build_toolbar()
        self._build_log_view()

    def _build_toolbar(self) -> None:
        bar = ctk.CTkFrame(self.frame, fg_color="#0b1220", corner_radius=10)
        bar.grid(row=0, column=0, sticky="ew", padx=12, pady=(8, 4))
        bar.grid_columnconfigure(0, weight=1)
        bar.grid_columnconfigure(1, weight=1)

        # 左侧操作按钮
        left = ctk.CTkFrame(bar, fg_color="transparent")
        left.grid(row=0, column=0, sticky="w", padx=8, pady=6)

        btn_style = {"corner_radius": 8, "height": 32, "font": ctk.CTkFont(family="Segoe UI", size=11, weight="bold")}

        self.start_button = ctk.CTkButton(
            left, text="▶ 启动", fg_color="#166534", hover_color="#15803d", text_color="#f0fdf4", **btn_style,
            command=self.start
        )
        self.restart_button = ctk.CTkButton(
            left, text="⟳ 重启", fg_color="#1e3a8a", hover_color="#1e40af", text_color="#dbeafe", **btn_style,
            command=self.restart
        )
        self.stop_button = ctk.CTkButton(
            left, text="⏹ 停止", fg_color="#7f1d1d", hover_color="#991b1b", text_color="#fee2e2", **btn_style,
            command=self.stop
        )

        self.start_button.grid(row=0, column=0, padx=(0, 6))
        self.restart_button.grid(row=0, column=1, padx=6)
        self.stop_button.grid(row=0, column=2, padx=6)

        if self.spec.open_url:
            self.open_button = ctk.CTkButton(
                left, text="🌐 打开网页", fg_color="#166534", hover_color="#15803d", **btn_style,
                command=lambda: self.controller.open_url(self.spec.open_url)
            )
            self.open_button.grid(row=0, column=3, padx=(12, 0))

        # 右侧工具按钮
        right = ctk.CTkFrame(bar, fg_color="transparent")
        right.grid(row=0, column=1, sticky="e", padx=8, pady=6)

        self.copy_error_button = ctk.CTkButton(
            right, text="复制错误", fg_color="#334155", hover_color="#475569", width=84, **btn_style,
            command=self.copy_errors
        )
        self.copy_log_button = ctk.CTkButton(
            right, text="复制日志", fg_color="#334155", hover_color="#475569", width=84, **btn_style,
            command=self.copy_all_logs
        )
        self.clear_button = ctk.CTkButton(
            right, text="清空", fg_color="#334155", hover_color="#475569", width=70, **btn_style,
            command=self.clear_logs
        )

        self.copy_error_button.grid(row=0, column=0, padx=(0, 6))
        self.copy_log_button.grid(row=0, column=1, padx=6)
        self.clear_button.grid(row=0, column=2, padx=(6, 0))

        # 日志筛选 - 选择性查看全部 / 警告 / 错误日志
        self.filter_button = ctk.CTkSegmentedButton(
            right,
            values=["全部", "警告", "错误"],
            command=self._on_log_filter_change,
            font=ctk.CTkFont(family="Segoe UI", size=10),
            height=26,
            width=95,
        )
        self.filter_button.set("全部")
        self.filter_button.grid(row=0, column=3, padx=(10, 0))

    def _build_log_view(self) -> None:
        wrap = ctk.CTkFrame(self.frame, fg_color="#07111f", corner_radius=10)
        wrap.grid(row=1, column=0, sticky="nsew", padx=12, pady=(4, 12))
        wrap.grid_rowconfigure(0, weight=1)
        wrap.grid_columnconfigure(0, weight=1)

        self.text = ctk.CTkTextbox(
            wrap,
            wrap="word",
            height=320,
            fg_color="#07111f",
            text_color="#e0f2fe",
            font=ctk.CTkFont(family="Consolas", size=10),
            corner_radius=8,
            border_width=0,
        )
        self.text.grid(row=0, column=0, sticky="nsew", padx=6, pady=6)
        self.text.configure(state="disabled")

        self._ensure_log_tags()

    def _ensure_log_tags(self):
        """Re-assert tag foreground colors (CTkTextbox can re-apply widget styles on configure)."""
        try:
            txt = self.text._textbox  # type: ignore[attr-defined]
            txt.tag_configure("info", foreground="#e0f2fe")
            txt.tag_configure("warning", foreground="#fbbf24")
            txt.tag_configure("error", foreground="#f87171")
            txt.tag_configure("debug", foreground="#60a5fa")
            txt.tag_configure("success", foreground="#34d399")
            txt.tag_configure("meta", foreground="#64748b")
        except Exception:
            pass

    def append(self, message: str, level: str = "info") -> None:
        line = f"[{timestamp()}] {message}"
        self.history.append((level, line))
        if len(self.history) > 3000:
            self.history = self.history[-2000:]

        if self._should_show(level):
            self.text.configure(state="normal")
            self._ensure_log_tags()
            txt = self.text._textbox  # type: ignore[attr-defined]
            start_idx = txt.index("end")
            txt.insert("end", line + "\n")
            end_idx = txt.index("end-1c")
            txt.tag_add(level, start_idx, end_idx)
            self.text.see("end")
            self.text.configure(state="disabled")

    def set_status(self, status: str, color: Optional[str] = None) -> None:
        # 不再显示任何“运行中”“已停止”等文字状态
        # 颜色圆球直接显示在顶部每个栏目（服务名）左侧

        # 根据状态文本决定圆球颜色
        s = status.lower()
        if "运行" in status or "running" in s:
            dot_color = "#22c55e"   # 鲜绿
        elif "启动" in status or "starting" in s:
            dot_color = "#eab308"   # 黄色/琥珀
        elif "退出" in status or "error" in s or "失败" in status:
            dot_color = "#ef4444"   # 红
        else:
            dot_color = "#64748b"   # 灰（停止/已退出）

        # 只同步顶部概览栏的圆球指示（左贴栏目文字）
        try:
            dot = self.controller.status_dots.get(self.spec.key)
            if dot:
                dot.configure(fg_color=dot_color)
        except Exception:
            pass

    def _should_show(self, level: str) -> bool:
        """根据当前日志筛选决定是否显示该条目。
        meta 和 success（操作反馈）始终显示，其余按 filter。
        """
        if level in ("meta", "success"):
            return True  # 操作反馈和系统提示始终可见
        if self.log_filter == "all":
            return True
        if self.log_filter == "warning":
            return level in ("warning", "error")
        if self.log_filter == "error":
            return level == "error"
        return True

    def _refresh_logs(self):
        """根据当前 filter 重建日志显示"""
        self.text.configure(state="normal")
        self._ensure_log_tags()
        txt = self.text._textbox
        txt.delete("1.0", "end")
        for level, line in self.history:
            if self._should_show(level):
                start_idx = txt.index("end")
                txt.insert("end", line + "\n")
                end_idx = txt.index("end-1c")
                txt.tag_add(level, start_idx, end_idx)
        self.text.see("end")
        self.text.configure(state="disabled")

    def _on_log_filter_change(self, value: str):
        mode_map = {"全部": "all", "警告": "warning", "错误": "error"}
        self.log_filter = mode_map.get(value, "all")
        self._refresh_logs()

    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self) -> None:
        if self.is_running():
            self.append("服务已经在运行", "warning")
            return

        env = build_env()
        if self.spec.requires_database and not env.get("DATABASE_URL"):
            self.set_status("缺少 DATABASE_URL", "#b91c1c")
            self.append("请先在 .env 里配置 DATABASE_URL，或者参考 .env.example 补齐数据库配置。", "error")
            return

        self.run_id += 1
        run_id = self.run_id

        if self.spec.launch_mode == "python":
            if not self.spec.module:
                self.set_status("配置错误", "#b91c1c")
                self.append("Python 服务缺少 module 配置。", "error")
                return
            cmd = [get_python_executable(), "-u", "-m", self.spec.module]
            cwd = SERVER_DIR
        elif self.spec.launch_mode == "command":
            if not self.spec.command:
                self.set_status("配置错误", "#b91c1c")
                self.append("命令模式缺少 command 配置。", "error")
                return
            cmd = list(self.spec.command)
            cwd = self.spec.cwd or ROOT_DIR
        else:
            self.set_status("配置错误", "#b91c1c")
            self.append(f"未知启动模式：{self.spec.launch_mode}", "error")
            return

        self.append(f"启动命令：{' '.join(cmd)}", "meta")
        self.set_status("启动中...", "#d97706")

        try:
            self.process = subprocess.Popen(
                cmd,
                cwd=str(cwd),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0,
            )
        except Exception as exc:
            self.process = None
            self.set_status("启动失败", "#b91c1c")
            self.append(f"启动失败：{exc}", "error")
            return

        self.set_status("运行中", "#15803d")
        threading.Thread(target=self._read_output, args=(run_id,), daemon=True).start()
        threading.Thread(target=self._watch_exit, args=(run_id,), daemon=True).start()

    def stop(self) -> None:
        if not self.is_running():
            self.process = None
            self.set_status("已停止", "#334155")
            self.append("服务已经停止。", "warning")
            return

        self.run_id += 1
        self.append("正在停止服务...", "meta")
        proc = self.process
        if proc is None:
            return

        try:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            else:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
        finally:
            self.process = None
            self.set_status("已停止", "#334155")
            self.append("服务已停止。", "success")

    def restart(self) -> None:
        self.append("正在重启服务...", "meta")
        self.stop()
        self.controller.root.after(350, self.start)

    def clear_logs(self) -> None:
        self.history.clear()
        self.text.configure(state="normal")
        txt = self.text._textbox  # type: ignore[attr-defined]
        txt.delete("1.0", "end")
        self.text.configure(state="disabled")
        self.append("日志已清空。", "meta")

    def copy_all_logs(self) -> None:
        if not self.history:
            self.controller.show_tip("当前没有日志可复制。", "warning")
            return
        text = "\n".join(line for _, line in self.history)
        self.controller.copy_to_clipboard(text)
        self.append("已复制当前页全部日志。", "success")

    def copy_errors(self) -> None:
        error_lines = self._collect_error_lines()
        if not error_lines:
            self.controller.show_tip("当前页没有可复制的报错信息。", "warning")
            return
        text = "\n".join(error_lines)
        self.controller.copy_to_clipboard(text)
        self.append("已复制当前页报错信息。", "success")

    def _collect_error_lines(self) -> List[str]:
        selected: List[str] = []
        for level, line in self.history:
            upper = line.upper()
            if level in {"error", "warning"} or "TRACEBACK" in upper or "EXCEPTION" in upper:
                selected.append(line)
        return selected

    def _has_missing_dependency_error(self) -> bool:
        for _, line in self.history:
            upper = line.upper()
            if "NO MODULE NAMED" in upper:
                return True
            if "MODULE NOT FOUND" in upper:
                return True
        return False

    def _read_output(self, run_id: int) -> None:
        proc = self.process
        if proc is None or proc.stdout is None:
            return

        for raw_line in iter(proc.stdout.readline, ""):
            if run_id != self.run_id:
                break
            line = raw_line.rstrip("\r\n")
            if line:
                self.controller.enqueue_log(self.spec.key, line, classify_line(line))

        try:
            proc.stdout.close()
        except Exception:
            pass

    def _watch_exit(self, run_id: int) -> None:
        proc = self.process
        if proc is None:
            return
        code = proc.wait()
        self.controller.enqueue_exit(self.spec.key, code, run_id)


class LauncherApp:
    def __init__(self, root: ctk.CTk) -> None:
        self.root = root
        ctk.set_appearance_mode("Dark")
        ctk.set_default_color_theme("blue")

        self.root.title("HeySure 后端控制台 · AI Runtime Launcher")
        self.root.geometry("1180x760")
        self.root.minsize(1020, 660)

        # 全局深色背景
        self.root.configure(fg_color="#0b1220")

        self.queue: "queue.Queue[tuple]" = queue.Queue()
        self.panes: Dict[str, ServicePane] = {}
        self.status_dots: Dict[str, ctk.CTkLabel] = {}  # 概览状态圆形指示器
        self.installing = False
        self.install_target_key = "gateway"
        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(100, self._drain_queue)
        self.root.after(900, self._auto_start)

    def _build_ui(self) -> None:
        # ===== 全局操作栏（无大标题、无提示横幅，简洁启动器风格） =====
        topbar = ctk.CTkFrame(self.root, fg_color="#0f172a", corner_radius=12)
        topbar.pack(fill="x", padx=18, pady=(14, 8))

        # 左侧大按钮
        left = ctk.CTkFrame(topbar, fg_color="transparent")
        left.pack(side="left", padx=10, pady=8)

        big_btn = {"corner_radius": 10, "height": 34, "font": ctk.CTkFont(family="Segoe UI", size=12, weight="bold")}
        compact_btn = {"corner_radius": 8, "height": 32, "font": ctk.CTkFont(family="Segoe UI", size=11, weight="bold")}

        self.btn_start_all = ctk.CTkButton(left, text="▶ 全部启动", fg_color="#166534", hover_color="#15803d", text_color="#ecfdf5", **big_btn, command=self.start_all)
        self.btn_restart_all = ctk.CTkButton(left, text="⟳ 全部重启", fg_color="#1e40af", hover_color="#1e3a8a", text_color="#dbeafe", **big_btn, command=self.restart_all)

        # 新增：针对性重启按钮（放在全部重启旁边）
        self.btn_restart_backends = ctk.CTkButton(
            left, text="⟳ 重启全部后端", fg_color="#0f766e", hover_color="#115e59", text_color="#ccfbf1",
            **compact_btn, command=self.restart_backends
        )
        self.btn_restart_frontend = ctk.CTkButton(
            left, text="⟳ 重启前端", fg_color="#ca8a04", hover_color="#a16207", text_color="#fefce8",
            **compact_btn, command=self.restart_frontend
        )

        self.btn_stop_all = ctk.CTkButton(left, text="⏹ 全部停止", fg_color="#7f1d1d", hover_color="#991b1b", text_color="#fee2e2", **big_btn, command=self.stop_all)
        self.install_button = ctk.CTkButton(left, text="📦 安装依赖", fg_color="#334155", hover_color="#475569", text_color="#e0f2fe", **big_btn, command=self.install_dependencies)

        self.btn_start_all.pack(side="left", padx=(0, 6))
        self.btn_restart_all.pack(side="left", padx=(6, 4))
        self.btn_restart_backends.pack(side="left", padx=3)
        self.btn_restart_frontend.pack(side="left", padx=(3, 6))
        self.btn_stop_all.pack(side="left", padx=6)
        self.install_button.pack(side="left", padx=(12, 0))

        # 右侧工具
        right = ctk.CTkFrame(topbar, fg_color="transparent")
        right.pack(side="right", padx=10, pady=8)

        ctk.CTkButton(right, text="复制当前错误", fg_color="#1f2937", hover_color="#334155", width=98, height=30, command=self.copy_current_errors).pack(side="left", padx=4)
        ctk.CTkButton(right, text="复制当前日志", fg_color="#1f2937", hover_color="#334155", width=98, height=30, command=self.copy_current_logs).pack(side="left", padx=4)
        ctk.CTkButton(right, text="清空当前页", fg_color="#1f2937", hover_color="#334155", width=86, height=30, command=self.clear_current).pack(side="left", padx=4)
        ctk.CTkButton(right, text="🌐 打开 Web", fg_color="#166534", hover_color="#15803d", width=94, height=30, command=self.open_web_page).pack(side="left", padx=(8, 0))

        # ===== 服务状态概览条（圆形颜色指示 + 栏目文字） =====
        overview = ctk.CTkFrame(self.root, fg_color="#0f172a", corner_radius=10)
        overview.pack(fill="x", padx=18, pady=(2, 8))

        for spec in SERVICES:
            short = spec.title.split(" ", 1)[-1] if " " in spec.title else spec.title

            item = ctk.CTkFrame(overview, fg_color="transparent")
            item.pack(side="left", padx=8, pady=4)

            # 颜色圆球（直接显示状态，放在栏目文字左侧）
            dot = ctk.CTkLabel(
                item,
                text="",
                width=13,
                height=13,
                fg_color="#475569",
                corner_radius=7,
            )
            dot.pack(side="left", padx=(0, 6))

            name_label = ctk.CTkLabel(
                item,
                text=short,
                text_color="#cbd5e1",
                font=ctk.CTkFont(family="Segoe UI", size=11),
            )
            name_label.pack(side="left")

            # 端口号直接显示在栏目右侧
            if spec.port:
                port_label = ctk.CTkLabel(
                    item,
                    text=":" + spec.port,
                    text_color="#64748b",
                    font=ctk.CTkFont(family="Segoe UI", size=9),
                )
                port_label.pack(side="left", padx=(2, 0))

            self.status_dots[spec.key] = dot

        # ===== 标签页（使用 CTkTabview 更现代） =====
        tabs_wrap = ctk.CTkFrame(self.root, fg_color="#0b1220", corner_radius=0)
        tabs_wrap.pack(fill="both", expand=True, padx=18, pady=(2, 16))
        tabs_wrap.grid_rowconfigure(0, weight=1)
        tabs_wrap.grid_columnconfigure(0, weight=1)

        self.tabview = ctk.CTkTabview(tabs_wrap, corner_radius=12, fg_color="#0f172a", segmented_button_fg_color="#111827")
        self.tabview.grid(row=0, column=0, sticky="nsew")

        for spec in SERVICES:
            tab = self.tabview.add(spec.title)
            # 让 tab 内部有 padding 容器
            inner = ctk.CTkFrame(tab, fg_color="transparent")
            inner.pack(fill="both", expand=True, padx=4, pady=4)

            pane = ServicePane(inner, spec, self)
            pane.frame.pack(fill="both", expand=True)
            self.panes[spec.key] = pane
            # 初始化概览圆点为停止色
            if spec.key in self.status_dots:
                self.status_dots[spec.key].configure(fg_color="#475569")

        # 不再有 banner
        # self._update_banner()  # 已移除标题和提示

    def current_pane(self) -> ServicePane:
        try:
            key = self.tabview.get()
            for pane in self.panes.values():
                if pane.spec.title == key:
                    return pane
        except Exception:
            pass
        return next(iter(self.panes.values()))

    def _set_installing(self, installing: bool) -> None:
        self.installing = installing
        state = "disabled" if installing else "normal"
        try:
            self.install_button.configure(state=state)
        except Exception:
            pass

        if installing:
            self.show_tip("正在安装依赖，请稍等...", "warning")
        # 标题横幅已移除，不再需要 _update_banner

    def copy_to_clipboard(self, text: str) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.root.update()

    def show_tip(self, message: str, level: str = "info") -> None:
        # 标题和中间提示横幅已移除，提示信息写入当前标签页日志（meta 样式）
        try:
            pane = self.current_pane()
            level_tag = "warning" if level in ("warning", "error") else "meta"
            pane.append(f"[提示] {message}", level_tag)
        except Exception:
            # 兜底：至少不让程序崩溃
            pass

    def enqueue_log(self, service_key: str, line: str, level: str) -> None:
        self.queue.put(("log", service_key, line, level))

    def enqueue_exit(self, service_key: str, exit_code: int, run_id: int) -> None:
        self.queue.put(("exit", service_key, exit_code, run_id))

    def enqueue_install_log(self, line: str, level: str) -> None:
        self.queue.put(("install-log", line, level))

    def enqueue_install_exit(self, exit_code: int) -> None:
        self.queue.put(("install-exit", exit_code))

    def _drain_queue(self) -> None:
        try:
            while True:
                kind, *payload = self.queue.get_nowait()
                if kind == "log":
                    service_key, line, level = payload
                    self.panes[service_key].append(line, level)
                elif kind == "exit":
                    service_key, exit_code, run_id = payload
                    pane = self.panes[service_key]
                    if run_id != pane.run_id:
                        continue
                    pane.process = None
                    if exit_code == 0:
                        pane.set_status("已退出", "#334155")
                        pane.append("服务正常退出。", "warning")
                    else:
                        pane.set_status(f"退出 {exit_code}", "#b91c1c")
                        pane.append(f"服务异常退出，返回码 {exit_code}。", "error")
                        if pane._has_missing_dependency_error():
                            self.show_tip("检测到缺少 Python 依赖，请先运行“安装依赖”。", "error")
                elif kind == "install-log":
                    line, level = payload
                    self.panes[self.install_target_key].append(f"[依赖安装] {line}", level)
                elif kind == "install-exit":
                    exit_code = payload[0]
                    self._set_installing(False)
                    if exit_code == 0:
                        self.show_tip("依赖安装完成。", "info")
                        self.panes[self.install_target_key].append("依赖安装完成。", "success")
                    else:
                        self.show_tip(f"依赖安装失败，返回码 {exit_code}。", "error")
                        self.panes[self.install_target_key].append(f"依赖安装失败，返回码 {exit_code}。", "error")
        except queue.Empty:
            pass
        finally:
            self.root.after(120, self._drain_queue)

    def _auto_start(self) -> None:
        self.start_all()

    def start_all(self) -> None:
        for pane in self.panes.values():
            pane.start()

    def restart_all(self) -> None:
        for pane in self.panes.values():
            pane.restart()

    def restart_backends(self) -> None:
        """重启 4 个后端服务（gateway、mcp、connector、ai）"""
        for key in ("gateway", "mcp", "connector", "ai"):
            if key in self.panes:
                self.panes[key].restart()

    def restart_frontend(self) -> None:
        """只重启 Web 控制台（前端）"""
        if "web" in self.panes:
            self.panes["web"].restart()

    def stop_all(self) -> None:
        for pane in self.panes.values():
            pane.stop()

    def install_dependencies(self) -> None:
        if self.installing:
            self.show_tip("依赖安装正在进行中，请稍候。", "warning")
            return

        self.install_target_key = self.current_pane().spec.key
        script = SERVER_DIR / "install-deps.bat"
        if not script.exists():
            self.show_tip("未找到 install-deps.bat。", "error")
            self.current_pane().append("未找到 install-deps.bat。", "error")
            return

        self._set_installing(True)
        self.current_pane().append("正在启动依赖安装脚本...", "meta")

        env = build_env()
        env["PYTHONUNBUFFERED"] = "1"

        try:
            proc = subprocess.Popen(
                ["cmd.exe", "/c", str(script)],
                cwd=str(SERVER_DIR),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0,
            )
        except Exception as exc:
            self._set_installing(False)
            self.show_tip(f"依赖安装启动失败：{exc}", "error")
            self.current_pane().append(f"依赖安装启动失败：{exc}", "error")
            return

        threading.Thread(target=self._read_install_output, args=(proc,), daemon=True).start()
        threading.Thread(target=self._watch_install_exit, args=(proc,), daemon=True).start()

    def clear_current(self) -> None:
        self.current_pane().clear_logs()

    def copy_current_errors(self) -> None:
        self.current_pane().copy_errors()

    def copy_current_logs(self) -> None:
        self.current_pane().copy_all_logs()

    def open_url(self, url: Optional[str] = None) -> None:
        target = (url or WEB_URL).strip()
        if not target:
            self.show_tip("没有可打开的网址。", "warning")
            return
        webbrowser.open(target, new=1, autoraise=True)
        self.show_tip(f"已打开 {target}", "info")

    def open_web_page(self) -> None:
        self.open_url(WEB_URL)

    def _read_install_output(self, proc: subprocess.Popen[str]) -> None:
        if proc.stdout is None:
            return

        for raw_line in iter(proc.stdout.readline, ""):
            line = raw_line.rstrip("\r\n")
            if line:
                self.enqueue_install_log(line, classify_line(line))

        try:
            proc.stdout.close()
        except Exception:
            pass

    def _watch_install_exit(self, proc: subprocess.Popen[str]) -> None:
        code = proc.wait()
        self.enqueue_install_exit(code)

    def on_close(self) -> None:
        for pane in self.panes.values():
            pane.stop()
        self.root.after(100, self.root.destroy)


def main() -> None:
    if os.name != "nt":
        print("这个启动器只适用于 Windows。")
        raise SystemExit(1)

    # 使用 customtkinter 的现代窗口
    root = ctk.CTk()
    LauncherApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
