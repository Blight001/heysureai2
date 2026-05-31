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
├── icons/                  # 16/48/128 图标
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
    ├── popup/              # 弹窗 UI 逻辑（按职责拆分的模块）
    │   ├── index.ts        #   编排层：background 端口分派、启动流程、装配监听
    │   ├── state.ts        #   共享可变状态单例 + 常量
    │   ├── dom.ts          #   集中缓存的 DOM 元素引用
    │   ├── helpers.ts      #   纯/派生工具（头像、角色、useServerChat 等）
    │   ├── ui.ts           #   表现层：主题/状态/活动流/tab/弹窗/目标横幅
    │   ├── members.ts      #   登录登出 + AI 成员加载/渲染/选择
    │   ├── chat.ts         #   对话子系统（服务端轮询 + 本地、会话、消息操作）
    │   ├── tasks.ts        #   任务安排与作业列表
    │   ├── settings.ts     #   设置表单：加载/保存/预设/测试连接/连接控制
    │   └── markdown.ts     #   纯渲染工具：Markdown / MCP 调用块 / 推理块
    └── lib/                # 跨入口共享的库代码
        ├── types.ts        #   AgentSettings、ChatMessage、消息类型等
        ├── storage.ts      #   chrome.storage 封装（设置 / 鉴权 / 历史）
        ├── ai.ts           #   Anthropic / OpenAI 兼容的 callAI
        ├── client.ts       #   软件端 REST 客户端（登录、AI 成员、任务）
        └── tools/          # MCP 工具目录
            ├── index.ts    #   对外公开 API（re-export）
            ├── definitions.ts   # BROWSER_TOOLS schema + SEARCH_ENGINES
            ├── browser.ts  #   browser_* 工具实现 + executeBrowserOnly 路由
            ├── router.ts   #   executeBrowserTool 路由（browser_*）
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

- **background**：服务端的 socket、AI 循环和任务执行调度都在这里。
  调 `lib/tools` 实际执行工具。
- **content**：注入到每个网页，负责真正动 DOM。background 通过
  `chrome.tabs.sendMessage` 发请求；content/actions.ts 根据 `action` 字段分派
  到对应处理函数。
- **popup**：扩展弹窗。通过 `chrome.runtime.connect({ name: 'popup' })`
  与 background 双向通信；可以本地直连 AI（用户配置的 AI Key），也可以走
  服务端 AI 成员（登录账号后）。

## 工具体系（lib/tools/）

工具以 `browser_*` 为主：通过 chrome API 或 content script 操作浏览器（导航、点击、
  输入、截图、滚动、提取等）。实现位于 `browser.ts`。

`executeBrowserTool(name, args)` 执行浏览器工具；`executeTask` 是
服务端任务的总入口：要么直跑指定工具，要么进入 AI agentic 循环让模型自行
选择工具。

## 开发须知

- TypeScript 类型检查：`npx tsc --noEmit`
- 修改 src/ 后必须 `npm run build` 更新 dist/（manifest 直接引用 dist/）
- 切换包的 popup UI 在 `popup.html` + `src/popup/`；服务端通信在
  `src/background.ts` + `src/lib/client.ts`
