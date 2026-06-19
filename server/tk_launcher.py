"""Windows 单窗口启动器：用 4 个中文标签页管理后端服务。

功能：
- 4 个标签页分别显示 网关 / MCP / 连接器 / AI 服务；
- 每个标签页都有独立日志、独立启动/重启/停止；
- 支持复制当前页报错、复制当前页全部日志；
- 颜色区分日志级别，便于快速定位异常。

启动器会读取仓库根目录的 ``.env``，让各个子进程共享同一套环境变量。
"""

from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import tkinter as tk
from tkinter import scrolledtext, ttk


ROOT_DIR = Path(__file__).resolve().parents[1]
SERVER_DIR = Path(__file__).resolve().parent
ENV_FILE = ROOT_DIR / ".env"
VENV_PYTHON = SERVER_DIR / "venv" / "Scripts" / "python.exe"


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
    upper = line.upper()
    if "TRACEBACK" in upper or "[ERROR]" in upper or " CRITICAL" in upper or upper.startswith("ERROR"):
        return "error"
    if "[WARN]" in upper or " WARNING" in upper or upper.startswith("WARNING"):
        return "warning"
    if "[DEBUG]" in upper or upper.startswith("DEBUG"):
        return "debug"
    if "[SUCCESS]" in upper or " SUCCESS" in upper:
        return "success"
    return "info"


def short_status_text(status: str) -> str:
    return status


@dataclass(frozen=True)
class ServiceSpec:
    key: str
    title: str
    module: str
    accent: str


SERVICES: tuple[ServiceSpec, ...] = (
    ServiceSpec("gateway", "网关服务", "gateway.main", "#60a5fa"),
    ServiceSpec("mcp", "MCP 服务", "mcp_runtime.main", "#34d399"),
    ServiceSpec("connector", "连接器服务", "connector_runtime.main", "#f59e0b"),
    ServiceSpec("ai", "AI 服务", "ai_runtime.main", "#a78bfa"),
)


class ServicePane:
    def __init__(self, master: tk.Widget, spec: ServiceSpec, controller: "LauncherApp") -> None:
        self.spec = spec
        self.controller = controller
        self.process: Optional[subprocess.Popen[str]] = None
        self.run_id = 0
        self.history: List[Tuple[str, str]] = []

        self.frame = ttk.Frame(master, padding=12)
        self.frame.columnconfigure(0, weight=1)
        self.frame.rowconfigure(2, weight=1)

        self._build_header()
        self._build_toolbar()
        self._build_log_view()

    def _build_header(self) -> None:
        header = tk.Frame(self.frame, bg="#111827", highlightthickness=1, highlightbackground="#243244")
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)

        title_row = tk.Frame(header, bg="#111827")
        title_row.grid(row=0, column=0, sticky="ew", padx=14, pady=(12, 4))
        title_row.columnconfigure(0, weight=1)

        self.title_label = tk.Label(
            title_row,
            text=self.spec.title,
            fg=self.spec.accent,
            bg="#111827",
            font=("Segoe UI", 14, "bold"),
        )
        self.title_label.grid(row=0, column=0, sticky="w")

        self.status_var = tk.StringVar(value="已停止")
        self.status_label = tk.Label(
            title_row,
            textvariable=self.status_var,
            fg="#d1d5db",
            bg="#334155",
            font=("Segoe UI", 10, "bold"),
            padx=10,
            pady=3,
        )
        self.status_label.grid(row=0, column=1, sticky="e")

        self.subtitle_label = tk.Label(
            header,
            text="日志区会自动跟随最新输出。遇到异常时可直接复制报错。",
            fg="#94a3b8",
            bg="#111827",
            font=("Segoe UI", 9),
            anchor="w",
            justify="left",
        )
        self.subtitle_label.grid(row=1, column=0, sticky="ew", padx=14, pady=(0, 12))

    def _build_toolbar(self) -> None:
        bar = tk.Frame(self.frame, bg="#0f172a")
        bar.grid(row=1, column=0, sticky="ew", pady=(10, 10))
        bar.columnconfigure(0, weight=1)
        bar.columnconfigure(1, weight=1)

        left = tk.Frame(bar, bg="#0f172a")
        left.grid(row=0, column=0, sticky="w")

        self.start_button = ttk.Button(left, text="启动", command=self.start)
        self.restart_button = ttk.Button(left, text="重启", command=self.restart)
        self.stop_button = ttk.Button(left, text="停止", command=self.stop)

        self.start_button.grid(row=0, column=0, padx=(0, 8))
        self.restart_button.grid(row=0, column=1, padx=(0, 8))
        self.stop_button.grid(row=0, column=2)

        right = tk.Frame(bar, bg="#0f172a")
        right.grid(row=0, column=1, sticky="e")

        self.copy_error_button = ttk.Button(right, text="复制报错", command=self.copy_errors)
        self.copy_log_button = ttk.Button(right, text="复制日志", command=self.copy_all_logs)
        self.clear_button = ttk.Button(right, text="清空", command=self.clear_logs)

        self.copy_error_button.grid(row=0, column=0, padx=(0, 8))
        self.copy_log_button.grid(row=0, column=1, padx=(0, 8))
        self.clear_button.grid(row=0, column=2)

    def _build_log_view(self) -> None:
        wrap = tk.Frame(self.frame, bg="#0f172a")
        wrap.grid(row=2, column=0, sticky="nsew")
        wrap.rowconfigure(0, weight=1)
        wrap.columnconfigure(0, weight=1)

        self.text = scrolledtext.ScrolledText(
            wrap,
            wrap="word",
            height=12,
            bg="#07111f",
            fg="#dbe4ee",
            insertbackground="#dbe4ee",
            relief="flat",
            borderwidth=0,
            font=("Consolas", 10),
            padx=10,
            pady=10,
        )
        self.text.grid(row=0, column=0, sticky="nsew")
        self.text.configure(state="disabled")

        self.text.tag_configure("info", foreground="#dbe4ee")
        self.text.tag_configure("warning", foreground="#fbbf24")
        self.text.tag_configure("error", foreground="#f87171")
        self.text.tag_configure("debug", foreground="#60a5fa")
        self.text.tag_configure("success", foreground="#34d399")
        self.text.tag_configure("meta", foreground="#94a3b8")

    def append(self, message: str, level: str = "info") -> None:
        line = f"[{timestamp()}] {message}"
        self.history.append((level, line))
        if len(self.history) > 3000:
            self.history = self.history[-2000:]

        self.text.configure(state="normal")
        self.text.insert("end", line + "\n", (level,))
        self.text.see("end")
        self.text.configure(state="disabled")

    def set_status(self, status: str, color: Optional[str] = None) -> None:
        self.status_var.set(short_status_text(status))
        if color:
            self.status_label.configure(bg=color)

    def is_running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self) -> None:
        if self.is_running():
            self.append("服务已经在运行。", "warning")
            return

        env = build_env()
        if not env.get("DATABASE_URL"):
            self.set_status("缺少 DATABASE_URL", "#b91c1c")
            self.append("缺少 DATABASE_URL，请先复制 .env.example 为 .env 并填写数据库连接串。", "error")
            return

        self.run_id += 1
        run_id = self.run_id

        cmd = [get_python_executable(), "-u", "-m", self.spec.module]
        self.append(f"启动命令：{' '.join(cmd)}", "meta")
        self.set_status("启动中...", "#d97706")

        try:
            self.process = subprocess.Popen(
                cmd,
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
        self.text.delete("1.0", "end")
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
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("HeySure 后端控制台")
        self.root.geometry("1080x680")
        self.root.minsize(960, 600)
        self.root.configure(bg="#0b1220")

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TFrame", background="#0b1220")
        style.configure("TLabel", background="#0b1220", foreground="#e5e7eb")
        style.configure("TButton", padding=(10, 6))
        style.configure("TNotebook", background="#0b1220", borderwidth=0)
        style.configure(
            "TNotebook.Tab",
            background="#111827",
            foreground="#cbd5e1",
            padding=(16, 9),
        )
        style.map(
            "TNotebook.Tab",
            background=[("selected", "#1f2937")],
            foreground=[("selected", "#ffffff")],
        )

        self.queue: "queue.Queue[tuple]" = queue.Queue()
        self.panes: Dict[str, ServicePane] = {}
        self.installing = False
        self.install_target_key = "gateway"
        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(100, self._drain_queue)
        self.root.after(800, self._auto_start)

    def _build_ui(self) -> None:
        header = tk.Frame(self.root, bg="#0b1220")
        header.pack(fill="x", padx=16, pady=(14, 8))

        title = tk.Label(
            header,
            text="HeySure 后端控制台",
            fg="#f8fafc",
            bg="#0b1220",
            font=("Segoe UI", 20, "bold"),
        )
        title.pack(anchor="w")

        self.banner_var = tk.StringVar(value="")
        self.banner = tk.Label(
            header,
            textvariable=self.banner_var,
            fg="#94a3b8",
            bg="#0b1220",
            font=("Segoe UI", 10),
            wraplength=1020,
            justify="left",
        )
        self.banner.pack(anchor="w", pady=(6, 0))

        topbar = tk.Frame(self.root, bg="#0b1220")
        topbar.pack(fill="x", padx=16, pady=(0, 12))

        group_left = tk.Frame(topbar, bg="#0b1220")
        group_left.pack(side="left")

        ttk.Button(group_left, text="全部启动", command=self.start_all).grid(row=0, column=0, padx=(0, 8))
        ttk.Button(group_left, text="全部重启", command=self.restart_all).grid(row=0, column=1, padx=(0, 8))
        ttk.Button(group_left, text="全部停止", command=self.stop_all).grid(row=0, column=2, padx=(0, 8))
        self.install_button = ttk.Button(group_left, text="安装依赖", command=self.install_dependencies)
        self.install_button.grid(row=0, column=3, padx=(0, 8))

        group_right = tk.Frame(topbar, bg="#0b1220")
        group_right.pack(side="right")
        ttk.Button(group_right, text="复制当前页报错", command=self.copy_current_errors).grid(row=0, column=0, padx=(0, 8))
        ttk.Button(group_right, text="复制当前页日志", command=self.copy_current_logs).grid(row=0, column=1, padx=(0, 8))
        ttk.Button(group_right, text="清空当前页", command=self.clear_current).grid(row=0, column=2)

        tabs_wrap = tk.Frame(self.root, bg="#0b1220")
        tabs_wrap.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        tabs_wrap.rowconfigure(0, weight=1)
        tabs_wrap.columnconfigure(0, weight=1)

        self.notebook = ttk.Notebook(tabs_wrap)
        self.notebook.grid(row=0, column=0, sticky="nsew")

        for spec in SERVICES:
            pane = ServicePane(self.notebook, spec, self)
            self.notebook.add(pane.frame, text=spec.title)
            self.panes[spec.key] = pane

        self._update_banner()

    def _update_banner(self) -> None:
        messages: List[str] = []
        if not ENV_FILE.exists():
            messages.append(f"未找到 {ENV_FILE.name}，请先复制 .env.example 为 .env。")
        if not build_env().get("DATABASE_URL"):
            messages.append("DATABASE_URL 还未配置，当前不能启动服务。")
        if VENV_PYTHON.exists():
            messages.append(f"使用虚拟环境 Python：{VENV_PYTHON}")
        else:
            messages.append(f"使用系统 Python：{sys.executable}")
        self.banner_var.set("  |  ".join(messages))

    def current_pane(self) -> ServicePane:
        key = self.notebook.tab(self.notebook.select(), "text")
        for pane in self.panes.values():
            if pane.spec.title == key:
                return pane
        return next(iter(self.panes.values()))

    def _set_installing(self, installing: bool) -> None:
        self.installing = installing
        state = "disabled" if installing else "normal"
        try:
            self.install_button.configure(state=state)
        except Exception:
            pass

        if installing:
            self.show_tip("正在安装依赖，请稍候...", "warning")
        else:
            self._update_banner()

    def copy_to_clipboard(self, text: str) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(text)
        self.root.update()

    def show_tip(self, message: str, level: str = "info") -> None:
        self.banner_var.set(message)
        if level == "error":
            self.banner.configure(fg="#f87171")
        elif level == "warning":
            self.banner.configure(fg="#fbbf24")
        else:
            self.banner.configure(fg="#94a3b8")

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
        if not build_env().get("DATABASE_URL"):
            for pane in self.panes.values():
                pane.set_status("等待 DATABASE_URL", "#b91c1c")
            return
        self.start_all()

    def start_all(self) -> None:
        for pane in self.panes.values():
            pane.start()

    def restart_all(self) -> None:
        for pane in self.panes.values():
            pane.restart()

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
        print("这个启动器仅适用于 Windows。")
        raise SystemExit(1)

    root = tk.Tk()
    LauncherApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
