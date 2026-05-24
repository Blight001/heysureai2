# HeySure Agent — 浏览器扩展

Chrome MV3 扩展。两种工作模式并存：

1. **Browser-Agent**：通过 socket.io 连接到 HeySure 服务端，作为浏览器自动化
   Agent 执行服务端下发的 MCP 工具任务。
2. **软件端客户端**：登录账号后管理 AI 成员、对话、安排任务（与 Web 控制台
   等价的精简版）。

## 构建 & 加载

```bash
npm install
npm run build        # 输出到 dist/
npm run dev          # esbuild watch 模式
```

加载方法：Chrome → 扩展程序 → 加载已解压的扩展程序 → 选择本目录。

## 目录结构

```
agent/extension/
├── manifest.json           # MV3 manifest（service worker / content scripts / 权限）
├── popup.html              # 弹窗 UI 骨架 + 内联样式
├── build.js                # esbuild 入口配置
├── tsconfig.json           # 编译配置（仅用于类型检查；打包走 esbuild）
├── icons/                  # 16/48/128 图标 + 源 logo
├── scripts/
│   └── gen-icons.js        # 从源 logo 生成三种尺寸图标
├── dist/                   # 构建产物（manifest 引用，需要随仓库一起入库）
└── src/
    ├── background.ts       # service worker 入口：socket.io、任务派发、popup 端口
    ├── content/            # 内容脚本（注入到所有页面）
    │   ├── index.ts        #   入口 + chrome.runtime 消息分派
    │   ├── fx.ts           #   虚拟鼠标 / 视觉效果
    │   ├── dom.ts          #   纯 DOM 工具（可见性、文本匹配、选择器路径等）
    │   ├── viewport.ts     #   页面位置上下文（scrollY、当前章节、可见标题）
    │   ├── popups.ts       #   弹窗/对话框检测与关闭
    │   └── actions.ts      #   点击/输入/滚动/拖拽/提取 等具体动作
    ├── popup/              # 弹窗 UI 逻辑
    │   ├── index.ts        #   主入口：DOM 引用、状态、tab 切换、所有交互
    │   └── markdown.ts     #   纯渲染工具：Markdown / MCP 调用块 / 推理块
    └── lib/                # 跨入口共享的库代码
        ├── types.ts        #   AgentSettings、ChatMessage、MemoryCard、消息类型等
        ├── storage.ts      #   chrome.storage 封装（设置 / 鉴权 / 历史 / 卡片）
        ├── ai.ts           #   Anthropic / OpenAI 兼容的 callAI
        ├── client.ts       #   软件端 REST 客户端（登录、AI 成员、任务）
        ├── cards.ts        #   卡片导入/导出/合并解析
        └── tools/          # MCP 工具目录
            ├── index.ts    #   对外公开 API（re-export）
            ├── definitions.ts   # BROWSER_TOOLS schema + SEARCH_ENGINES
            ├── browser.ts  #   browser_* 工具实现 + executeBrowserOnly 路由
            ├── cards.ts    #   card_* 工具实现 + runCardSteps 引擎
            ├── router.ts   #   合并路由 executeBrowserTool（browser_* + card_*）
            └── executor.ts #   executeTask：服务端任务执行器（含 AI agent 循环）
```

## 三个入口的协作

```
┌────────────────┐  socket.io  ┌────────────┐
│  HeySure 服务端 │ ───tasks──▶ │ background │ ── chrome.tabs.sendMessage ──▶ content
│ (chat run/jobs)│ ◀──results── │  worker    │                                ▲
└────────────────┘             └─────┬──────┘                                │
                                     │ port: "popup"                         │
                                     ▼                                       │
                                ┌──────────┐                                 │
                                │  popup   │ ────── DOM actions ─────────────┘
                                └──────────┘
```

- **background**：服务端的 socket、AI 循环、卡片执行调度都在这里。
  调 `lib/tools` 实际执行工具。
- **content**：注入到每个网页，负责真正动 DOM。background 通过
  `chrome.tabs.sendMessage` 发请求；content/actions.ts 根据 `action` 字段分派
  到对应处理函数。
- **popup**：扩展弹窗。通过 `chrome.runtime.connect({ name: 'popup' })`
  与 background 双向通信；可以本地直连 AI（用户配置的 AI Key），也可以走
  服务端 AI 成员（登录账号后）。

## 工具体系（lib/tools/）

工具分两类：

- `browser_*`：通过 chrome API 或 content script 操作浏览器（导航、点击、
  输入、截图、滚动、提取等）。实现位于 `browser.ts`。
- `card_*`：记忆卡片，即一组 `browser_*` 步骤组成的可重用工作流。
  实现位于 `cards.ts`，运行引擎 `runCardSteps` 负责按顺序执行步骤、上报进度、
  在失败时返回 `failedStep` 供 AI 诊断后用 `card_update_step` 修复。

`executeBrowserTool(name, args)` 根据前缀分派到对应路由；`executeTask` 是
服务端任务的总入口：要么直跑指定工具，要么进入 AI agentic 循环让模型自行
选择工具。

## 开发须知

- TypeScript 类型检查：`npx tsc --noEmit`
- 修改 src/ 后必须 `npm run build` 更新 dist/（manifest 直接引用 dist/）
- 图标变更：把新 logo 放到 `icons/extension_logo.png`，运行 `npm run icons`
- 切换包的 popup UI 在 `popup.html` + `src/popup/`；服务端通信在
  `src/background.ts` + `src/lib/client.ts`
