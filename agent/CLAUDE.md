# CLAUDE.md — agent/ 端侧执行器

三个端侧客户端，连接后端、注册为 endpoint，对外暴露 AI 可调用的工具。
知识工坊由服务端内置为虚拟 Agent，保留专用绑定链路；当前不携带知识/进化 MCP。

| 子目录 | 形态 | 作用 |
| --- | --- | --- |
| `windows/` | Electron 桌面应用 | Windows 本机自动化（窗口/屏幕/鼠标/键盘/剪贴板/shell/文件系统） |
| `linux/` | Electron 桌面应用 | Linux 等价能力（robotjs/X11、wmctrl/xdotool、espeak 等） |
| `extension/` | Chrome MV3 扩展 | 浏览器自动化与轻量客户端 |

桌面 agent 内部结构（win/linux 一致）：`src/main.ts` 管 Electron 生命周期，`services/agent-runtime` 接 socket，`tools/` 是各工具实现，`executor/` 工具调度，`ipc/` 主进程↔渲染进程通信，`renderer/` UI，`windows/` 窗口与托盘。

## ⚠️ win/linux 大量重复代码

`windows/src` 与 `linux/src` 是**同源双份**：约一半文件逐字节相同（如 `server-url.ts`、`constants.ts`、`services/auth-state.ts`、`services/server-client.ts`、`tools/shared/robot.ts`、`tools/clipboard.ts`、`tools/filesystem.ts`、`tools/keyboard.ts`、`ipc/agent.ts` 等），另一半是平台相关实现的分叉。

**改动通用逻辑时两边都要改**，否则两端会行为不一致。若要消除重复，应抽出 `agent/shared/` 共享包并让两端引用——这是较大的结构改动，需逐项 `tsc` 验证。

平台差异举例：`linux` 独有 `tools/ear.ts`(STT) `tools/git.ts` `tools/shared/command.ts`；`windows` 独有 `offline-chat`/`offline-ai` 相关文件。

## 命令

```bash
# 桌面 agent（windows / linux 通用）
cd agent/linux        # 或 agent/windows
npm install
npm run dev
npm run build         # → dist/ (gitignored)

# 浏览器扩展
cd agent/extension
npm install
npm run build         # 然后 Chrome 加载未打包扩展，指向该目录
```

## 注意点（重要）

- **本远程/CI 环境无法运行 Electron GUI**（需 X11、原生模块 robotjs）。能做的验证仅限：`npm install --ignore-scripts` + `tsc --noEmit` 编译检查。实际交互行为必须在本机验证。
- linux agent 推荐 X11 会话；Wayland 下注入/窗口控制受限。
- `dist/`、`release/`、`node_modules/`、`.env`（保留 `.env.example`）已 gitignore；`extension/dist/` 现已补入 gitignore。
