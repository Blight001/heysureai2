# CLAUDE.md — device/ 端侧执行器（壳）

六个端侧客户端（**只是运行在不同端的壳，本身不具备 agent 能力**），连接后端、
注册为 endpoint；**桌面端已退化为受控运行器**：不再内置固定原生 MCP 工具，能力来自
服务器下发的 runtime 工具（python/shell，见 `device/shared/src/runtime/`），由服务端编排/推理。
知识工坊由服务端内置为虚拟 Agent，保留专用绑定链路；当前不携带知识/进化 MCP。

| 子目录 | 形态 | 作用 |
| --- | --- | --- |
| `windows/` | Electron 桌面应用 | 受控运行器：python/powershell/shell runner + 本机原生桥（截图/机器人等支持代码） |
| `linux/` | Electron 桌面应用 | 同上（X11；shell 默认 bash） |
| `mac/` | Electron 桌面应用 | 同上（macOS；shell 默认 bash；功能表面对齐 Windows 壳） |
| `extension/` | Chrome MV3 扩展 | 浏览器自动化与轻量客户端（仍为固定工具目录） |
| `android/` | 原生 Kotlin App（方案 A） | 手机本机执行器：点击/滑动/截屏/录屏（无障碍 + MediaProjection）。**独立工程，不与桌面壳共享 `device/shared/`**，详见 [`android/README.md`](android/README.md) |
| `android/android-adb/` | 宿主电脑 Node 进程（方案 B） | 经 ADB 控制手机：`adb input/screencap/screenrecord`，**息屏/锁屏下也能注入**。与 `android/` 同为 `android` 设备类型、同名工具，详见 [`android/android-adb/README.md`](android/android-adb/README.md) |

> 安卓两形态（A 本机 App / B 电脑 ADB）都以 `isAndroid:true` 注册，服务端统一识别为
> `android` 类型、工具名一致；后端识别逻辑见 `server/.../desktop_device_tools.py::device_type_of`。

桌面端壳内部结构（win/linux/mac 一致）：`src/main.ts` 管 Electron 生命周期，`services/agent-runtime` 接 socket，`executor/` 工具调度（`catalog.ts` **现仅注册 `mcp.manage_dynamic_tool` 一个内置——动态工具的引导器，无法自身动态化；连 `shell.run` 都已是服务器下发的 runtime 工具**），`runtime/` 受控执行底座（共享，见 `device/shared/`），`ipc/` 主进程↔渲染进程通信，`renderer/` UI，`windows/` 窗口与托盘。`tools/` 现仅剩少量支持代码（`shared/robot`、win/mac 的 `shared/coordinates`），不再有写死的 MCP 工具实现。

## win/linux/mac 共享代码（`device/shared/`）

`windows/src`、`linux/src` 与 `mac/src` 曾是**同源多份**，其中"完全相同"与"仅平台常量不同"的部分
已收敛到 **`device/shared/src/`（单一真相源）**；通用图标资源收敛到 **`device/shared/assets/`**。
由 `device/shared/scripts/sync-shared.js` 在 `tsc` 之前覆盖拷贝进各壳自己的 `src/` 与 `assets/`
（拷贝出的副本已 gitignore，**勿就地改**）。详见
[`device/shared/README.md`](shared/README.md) 与 [`doc/设备端win-linux去重重构计划.md`](../doc/设备端win-linux去重重构计划.md)。

- **改通用逻辑只改 `device/shared/src/`，改通用图标只改 `device/shared/assets/`**，两端构建时自动同步，不再"改一边忘另一边"。
- 平台差异不要写死在共享代码里：通过各壳 `src/platform.ts` 导出的 `platformProfile` 读取
  （见 `shared/src/platform-profile.ts`）。
- 仍有**平台分叉文件**留在各壳 `src/`（`device.ts`、`store.ts`、`platform.ts`、
  `tools/{mouse,screen,window,...}.ts`、`executor/dynamic.ts` 等）——
  改这些仍需两边都改。
- 桌面端 UI 已收敛到 `device/shared/src/renderer/`；本地对话、预加载桥、截图桥、
  登录/设置 IPC 等三端一致代码也在 `device/shared/src/`，各平台构建前同步到自己的 `src/`。
- 三端一致的构建辅助脚本已收敛到 `device/shared/scripts/`，平台 `package.json` 直接调用它们。

平台差异举例：`linux` 独有 `tools/ear.ts`(STT) `tools/git.ts` `tools/shared/command.ts`；本地对话与桌面 UI 已对齐到三端。

## 命令

```bash
# 桌面端壳（windows / linux 通用）
cd device/linux        # 或 device/windows / device/mac
npm install
npm run dev
npm run build         # → dist/ (gitignored)

# 根目录一键打包入口
cd device
build-windows.bat
build-linux.sh
build-mac.sh
build-extension.bat

# 根目录直接运行入口
run-windows.bat
run-linux.sh
run-mac.sh

# 浏览器扩展
cd device/extension
npm install
npm run build         # 然后 Chrome 加载未打包扩展，指向该目录

# 桌面端 Python 运行时（供服务器下发的 runtime=python 工具用，按需）
cd device/linux       # 或 device/windows / device/mac
npm run setup:python  # 在 device_runtime/python/.venv 安装 requirements.txt
```

## 注意点（重要）

- **本远程/CI 环境无法运行 Electron GUI**（需 X11、原生模块 robotjs）。能做的验证仅限：`npm install --ignore-scripts` + `tsc --noEmit` 编译检查。实际交互行为必须在本机验证。
- linux 端壳推荐 X11 会话；Wayland 下注入/窗口控制受限。
- mac 端壳需要在系统设置中允许辅助功能和屏幕录制权限，完整键鼠/截图能力才可用。
- `dist/`、`release/`、`node_modules/`、`.env`（保留 `.env.example`）已 gitignore；`extension/dist/` 现已补入 gitignore。
