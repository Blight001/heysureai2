# 设备端 win/linux 去重重构计划

> 目标：消除 `device/windows/src` 与 `device/linux/src` 之间的同源重复代码，
> 把真正通用的逻辑收敛到单一真相源，平台差异以显式抽象暴露。
> 本文是**精确到文件的执行计划**，不含 MCP 代码下放方向（见 `设备端MCP代码下放长期方案.md`）。

## 0. 背景与约束（来自实地核对）

- 两端是**各自独立的 Electron 工程**：独立 `package.json` / `tsconfig.json`，
  `rootDir: ./src`、`outDir: ./dist`、`main: dist/main.js`，electron-builder 各自打包 `dist/**/*` + `src/**/*`。
- 没有 monorepo workspace / pnpm / lerna 工具链；`module: commonjs`、`strict: false`。
- 本远程/CI 环境**无法运行 Electron GUI**，验证手段仅限：
  `npm install --ignore-scripts` + `npx tsc --noEmit`（编译检查）。运行行为须本机验证。
- 构建已有 `node scripts/copy-renderer.js` 这类"构建期拷贝"前例，可复用同模式。

## 1. 当前重复现状（核对结果）

### 1.1 逐字节完全相同（14 个，去重首选）

```
constants.ts
server-url.ts
ipc/device.ts
services/activity-log.ts
services/auth-state.ts
services/avatar-cache.ts
services/reauth.ts
services/server-client.ts
tools/clipboard.ts
tools/display.ts
tools/filesystem.ts
tools/keyboard.ts
tools/vision.ts
tools/shared/robot.ts
```

### 1.2 仅平台常量/字符串不同（可参数化后共享）

| 文件 | 差异点 |
| --- | --- |
| `executor/registry.ts` | `IS_WINDOWS`↔`IS_LINUX`、`'windows'`↔`'linux'` 平台标记、文案 |
| `ipc/ai-config.ts` | `deviceId` 前缀 `win-desktop-`↔`linux-desktop-`、`agentName` |
| `services/device-runtime.ts` | `agentName` 文案 |
| `executor/index.ts` | 仅一处等价写法差异（无语义差） |
| `windows/main-window.ts` | 图标路径 `icon.ico`↔`desktop.png` |
| `windows/tray.ts` | 图标路径 + 注释 |

> 这些差异可收敛为一个**平台配置对象**（`platformProfile`），共享文件读取配置而非写死。

### 1.3 平台实现分叉（**不去重**，保持双份）

`capture-bridge.ts`、`device.ts`、`tools/hands.ts`、`mouse.ts`、`mouth.ts`、
`process.ts`、`screen.ts`、`shell.ts`、`window.ts`、`platform.ts`、`store.ts`、
`preload.ts`、`main.ts`、`renderer/*`、`ipc/{auth,index,mcp,settings}.ts`、
`executor/{catalog,dynamic,infer}.ts` 等：行数与实现差异大，属平台相关逻辑，本次不动。

### 1.4 平台独有文件（保持原位）

- windows 独有：`ipc/offline-chat.ts`、`renderer/offline-chat.*`、`services/offline-ai.ts`、`tools/{text-input,uia}.ts`、`tools/shared/{coordinates,powershell}.ts`、`windows/offline-chat-window.ts`
- linux 独有：`tools/{ear,git}.ts`、`tools/shared/command.ts`

## 2. 引用方案选型

三种可行方式，按本工程实际约束权衡：

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. 构建期同步拷贝（**推荐**） | 真相源放 `device/shared/src/`，各工程构建前用脚本拷贝进自己的 `src/_shared/`（gitignore） | 不改 tsconfig / electron-builder；无运行时解析问题；与现有 `copy-renderer.js` 同模式 | 需纪律：只改 `device/shared`，不改拷贝副本；新增同步脚本 |
| B. TS Project References + paths | `device/shared` 设 `composite:true`，各工程 `references` + `paths` 别名 | 标准做法、IDE 友好 | commonjs 下运行时 `require` 别名不解析，需 `tsc-alias`；electron-builder `files` 难以向上跨目录纳入 `../shared/dist` |
| C. 抽成 npm workspace | 根建 workspace，shared 作为本地包 | 最规范 | 改动最大，需引入根 `package.json`/workspace，打包链路全改，风险高 |

**推荐方案 A**：改动面最小、可在本环境用 `tsc` 验证、不触碰打包链路，符合"渐进整改"。B/C 留作后续若进一步整合时升级。

## 3. 目标目录结构（方案 A：布局保持的覆盖式同步）

> 实施时的关键发现：14 个"完全相同"文件并非自洽，它们通过相对路径**依赖平台特定文件**
> （如 `ipc/device.ts`→`../store`、`services/server-client.ts`→`../store`、
> `tools/vision.ts`→`./screen`、`services/auth-state.ts`→`../windows/main-window`）。
> 因此**不能**放进独立子目录 `src/_shared/`（会破坏这些相对导入）。
> 正确做法：`shared/src/` **镜像各壳 `src/` 的原始布局**，同步时**覆盖拷贝**到 `src/` 同名位置，
> 相对导入即解析到各壳自己的平台实现，零改写。

```
device/
  shared/
    src/                         # 镜像各壳 src/ 布局；同步时覆盖到 windows/src 与 linux/src
      constants.ts
      server-url.ts
      platform-profile.ts        # 新增：PlatformProfile 接口（平台差异的契约）
      ipc/{device,ai-config}.ts
      executor/{registry,index}.ts          # registry 经 platformProfile 参数化
      services/{activity-log,auth-state,avatar-cache,reauth,server-client,device-runtime}.ts
      tools/{clipboard,display,filesystem,keyboard,vision}.ts
      tools/shared/robot.ts
      windows/{main-window,tray}.ts          # 经 platformProfile 参数化
    README.md                    # 说明"此处为真相源，勿改副本"
  windows/
    scripts/sync-shared.js       # 构建前覆盖拷贝 ../../shared/src → ./src
    src/...                      # 同步进来的 21 个共享文件已 gitignore
  linux/
    scripts/sync-shared.js       # 同上
    src/...                      # 同上
```

> 平台差异统一收敛到各壳 `src/platform.ts` 导出的 `platformProfile`（`deviceIdPrefix` /
> `agentName` / `appIconFile` / `platform` / `isCurrentPlatform`），共享文件读取它而非写死常量。

## 4. 分阶段执行步骤

> 实际实施未拆成独立提交的多阶段，而是一次性完成（应"一口气搞完"的要求）。以下按逻辑分组记录最终做法。

### 准备
1. 建 `device/shared/src/`（镜像 app `src/` 布局）与 `device/shared/README.md`。
2. 在根 `.gitignore` 增加 "Device shared modules" 区块，列出两端 `src/` 下被同步覆盖的 21 个文件路径。

### 迁移 14 个完全相同文件
1. 把 1.1 的 14 个文件复制进 `device/shared/src/` 的**同名相对位置**（两端逐字节相同，取 windows 侧）。
2. 写 `scripts/sync-shared.js`（win + linux 各一份，逻辑相同）：构建前递归覆盖拷贝 `../../shared/src` → `./src`。
3. 修改两端 `package.json` 脚本，把同步前置：
   ```
   "dev":   "node scripts/sync-shared.js && tsc && node scripts/copy-renderer.js && electron dist/main.js",
   "build": "node scripts/sync-shared.js && tsc && node scripts/copy-renderer.js",
   ```
4. `git rm` 两端 `src/` 中这些原文件（成为生成物，由同步重建）。**无需改任何 import**——布局保持，相对路径不变。

### 参数化"仅常量不同"文件（1.2）
1. 在 `shared/src/platform-profile.ts` 定义接口：
   ```ts
   export interface PlatformProfile {
     platform: 'windows' | 'linux'
     isCurrentPlatform: boolean  // IS_WINDOWS | IS_LINUX
     deviceIdPrefix: string      // 'win-desktop-' | 'linux-desktop-'
     agentName: string           // 'Windows Agent' | 'Linux Agent'
     appIconFile: string         // 'icon.ico' | 'desktop.png'
   }
   ```
2. 各工程在 `src/platform.ts`（已分叉，保留，**不同步**）导出本端 `platformProfile` 实例。
3. 把 `executor/{registry,index}.ts`、`ipc/ai-config.ts`、`services/device-runtime.ts`、
   `windows/{main-window,tray}.ts` 迁入 `shared/src/` 同名位置，其中平台常量改读 `platformProfile`。
   `registry.ts` 的 `ToolPlatform` 收敛为 `'all' | 'windows' | 'linux'`，过滤改读 `profile`。
4. 验证：见第 5 节。

### 阶段 3：收尾
1. 更新 `device/CLAUDE.md`："win/linux 大量重复代码"一节改为指向 `device/shared/`，写明改通用逻辑只改 shared。
2. 复核 `.gitignore`：确认 `src/_shared/` 已忽略、未误提交副本。

## 5. 验证

### 本次（远程环境，网络受限，无法 `npm install`）已验证
- `node scripts/sync-shared.js` 两端均成功把 21 个共享文件覆盖进各自 `src/`。
- 用**临时 ambient shim**（为 electron / socket.io-client / robotjs / node 内置模块声明 `any`）
  跑全局 `tsc --noEmit`：**无任何 `Cannot find module './...'`（本地相对导入全部解析成功）**，
  改动文件（registry / ai-config / device-runtime / index / platform / platform-profile）零报错；
  仅剩的 `BrowserWindow`/`Tray`/`Buffer`/`NodeJS` 类报错是 shim 缺少真实类型所致，
  对原始代码同样存在，与本次重构无关。
- `git check-ignore` 确认两端 `src/` 下 21 个同步文件均被忽略，不会被重新跟踪。

### 待本机验证（须装依赖 / 跑 GUI，CI 不可）
- [ ] `cd device/windows && npm install && npm run build`（含真实 electron 类型的完整 `tsc`）
- [ ] `cd device/linux && npm install && npm run build`
- [ ] 两端能启动、登录、注册 endpoint，`deviceId` 前缀与 `agentName` 正确、工具目录过滤正确、托盘/窗口图标正常

## 6. 回滚与风险

- 每阶段独立提交，可单独 revert。
- 风险点：import 相对路径层级算错（编译即报错，低风险）；electron-builder 打包须确认 `_shared/` 编译产物随 `dist` 一并打入（`files: dist/**/*` 已覆盖）。
- 不在本次范围：1.3 的平台分叉文件、MCP 代码下放（另见长期方案）。

## 7. 预期收益

- 14 个文件单一真相源，消除"改一边忘另一边"的不一致风险。
- 平台差异显式收敛到 `platform-profile`，新增平台（如 mac）成本下降。
- 改动面可控，不触碰打包链路，可在本环境编译验证。
