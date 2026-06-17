# CLAUDE.md — device/ 端侧执行器（壳）

三个端侧客户端（**只是运行在不同端的壳，本身不具备 agent 能力**），连接后端、
注册为 endpoint；**桌面端已退化为受控运行器**：不再内置固定原生 MCP 工具，能力来自
服务器下发的 runtime 工具（python/shell，见 `device/shared/src/runtime/`），由服务端编排/推理。
知识工坊由服务端内置为虚拟 Agent，保留专用绑定链路；当前不携带知识/进化 MCP。

| 子目录 | 形态 | 作用 |
| --- | --- | --- |
| `windows/` | Electron 桌面应用 | 受控运行器：python/powershell/shell runner + 本机原生桥（截图/机器人等支持代码） |
| `linux/` | Electron 桌面应用 | 同上（X11；shell 默认 bash） |
| `extension/` | Chrome MV3 扩展 | 浏览器自动化与轻量客户端（仍为固定工具目录） |

桌面端壳内部结构（win/linux 一致）：`src/main.ts` 管 Electron 生命周期，`services/agent-runtime` 接 socket，`executor/` 工具调度（`catalog.ts` 现仅注册 `mcp.manage_dynamic_tool` + `shell.run`），`runtime/` 受控执行底座（共享，见 `device/shared/`），`ipc/` 主进程↔渲染进程通信，`renderer/` UI，`windows/` 窗口与托盘。`tools/` 现仅剩 `shell.ts` 与少量支持代码（`shared/robot`、`shared/coordinates`）。

## win/linux 共享代码（`device/shared/`）

`windows/src` 与 `linux/src` 曾是**同源双份**，其中"完全相同"与"仅平台常量不同"的部分
已收敛到 **`device/shared/src/`（单一真相源）**，由各壳 `scripts/sync-shared.js` 在 `tsc`
之前覆盖拷贝进自己的 `src/`（拷贝出的副本已 gitignore，**勿就地改**）。详见
[`device/shared/README.md`](shared/README.md) 与 [`doc/设备端win-linux去重重构计划.md`](../doc/设备端win-linux去重重构计划.md)。

- **改通用逻辑只改 `device/shared/src/`**，两端构建时自动同步，不再"改一边忘另一边"。
- 平台差异不要写死在共享代码里：通过各壳 `src/platform.ts` 导出的 `platformProfile` 读取
  （见 `shared/src/platform-profile.ts`）。
- 仍有**平台分叉文件**留在各壳 `src/`（`device.ts`、`store.ts`、`platform.ts`、
  `tools/{mouse,screen,window,...}.ts`、`renderer/*`、`executor/{catalog,dynamic}.ts` 等）——
  改这些仍需两边都改。

平台差异举例：`linux` 独有 `tools/ear.ts`(STT) `tools/git.ts` `tools/shared/command.ts`；`windows` 独有 `offline-chat`/`offline-ai` 相关文件。

## 命令

```bash
# 桌面端壳（windows / linux 通用）
cd device/linux        # 或 device/windows
npm install
npm run dev
npm run build         # → dist/ (gitignored)

# 浏览器扩展
cd device/extension
npm install
npm run build         # 然后 Chrome 加载未打包扩展，指向该目录

# 桌面端 Python 运行时（供服务器下发的 runtime=python 工具用，按需）
cd device/linux       # 或 device/windows
npm run setup:python  # 在 device_runtime/python/.venv 安装 requirements.txt
```

## 注意点（重要）

- **本远程/CI 环境无法运行 Electron GUI**（需 X11、原生模块 robotjs）。能做的验证仅限：`npm install --ignore-scripts` + `tsc --noEmit` 编译检查。实际交互行为必须在本机验证。
- linux 端壳推荐 X11 会话；Wayland 下注入/窗口控制受限。
- `dist/`、`release/`、`node_modules/`、`.env`（保留 `.env.example`）已 gitignore；`extension/dist/` 现已补入 gitignore。
