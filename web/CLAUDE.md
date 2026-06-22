# CLAUDE.md — web/ 前端控制台 (HeySure-Web)

Vue 3 + Vite + TypeScript + Tailwind 的单页控制台。端口 **58150**，dev 时通过 vite proxy 把 `/api` `/socket.io` `/avatars` `/tmp-images` 转发到后端 `:3000`。

**注意**：本目录是独立仓库 `HeySure-Web`。完整项目使用时请通过上层 workspace（init-env）拉取其余组件。

**两个 Vite 入口**：`index.html`（主控制台）+ `game/index.html`（Agent 进化与实战区域，dev 访问 `/game/`）。

## 目录

```
src/
  api/           ← 后端接口封装，按域分文件
                   http.ts — 统一 axios/fetch 客户端（token/超时/错误处理）
                   auth.ts / chat.ts / ai.ts / mcp.ts / devices.ts
                   task.ts / admin.ts / workshop.ts / librarian.ts
                   workspace.ts / world.ts / projects.ts / deviceTools.ts
  components/    ← Vue 组件，按域分目录
                   chat/       聊天界面（ChatInterface/ChatMessage/ChatInput/TaskProgressPanel…）
                   dashboard/  仪表盘（AgentCard/BrainCorePanel/LibraryMcpUnifiedPanel…）
                   home/       首页（HomePage）
                   librarian/  知识库（ProposalReviewModal）
                   common/     通用（LoginModal/ProfileModal/MessageDialog/AmbientBackground…）
  composables/   ← 组合式逻辑（useAuth / useMessage / useTask / dashboard/*）
  constants/     ← 静态常量（dashboard / mcp）
  types/         ← TS 类型定义（agent / mcp / user / admin / index）
  utils/         ← 工具函数（chatMarkdown / chatParser / mcpTools / mcpFormat /
                              avatar / taskSystem / permission…）
  styles/        ← main.css（Tailwind 全局样式）
  App.vue main.ts ← 应用入口
```

## 组件 → API → 后端路由 对照

| 组件/功能 | 调用 API 文件 | 后端路由文件 |
| --- | --- | --- |
| 登录 / 注册 | `api/auth.ts` | `gateway/routers/auth.py` |
| 聊天发消息 / 历史 | `api/chat.ts` | `gateway/routers/chat.py` |
| AI 成员列表 / 配置 | `api/ai.ts` | `gateway/routers/ai.py` |
| MCP 工具列表 / 调用 | `api/mcp.ts` | `gateway/routers/mcp.py` |
| 设备列表 / 状态 | `api/devices.ts` | `gateway/routers/devices.py` |
| 任务创建 / 查询 | `api/task.ts` | `gateway/routers/ai_task_routes.py` |
| 知识工坊 | `api/workshop.ts` | `gateway/routers/workshop.py` |
| 图书馆审核 | `api/librarian.ts` | `gateway/routers/librarian_routes.py` |
| 系统管理 | `api/admin.ts` | `gateway/routers/admin.py` |
| 设备工具调用 | `api/deviceTools.ts` | `gateway/routers/device_mcp_routes.py` |

## MCP 工具相关文件

| 文件 | 职责 |
| --- | --- |
| `src/utils/mcpTools.ts` | 工具展示名称、图标、分组逻辑 |
| `src/utils/mcpFormat.ts` | 工具调用结果格式化渲染 |
| `src/constants/mcp.ts` | 工具类型常量、分类映射 |
| `src/api/mcp.ts` | 工具列表/调用/权限设置接口 |

## Socket.IO 实时事件（前端监听）

| 事件名 | 来源 | 触发场景 |
| --- | --- | --- |
| `chat_message` | Gateway / AI Runtime | 推理完成，推送新消息 |
| `chat_stream` | AI Runtime | 流式输出逐 token |
| `task_update` | Gateway 调度器 | 任务状态变更 |
| `device_status` | Connector Runtime | 端侧设备上下线 |
| `agent_presence` | Gateway | AI 成员在线状态变化 |

监听位置：`src/composables/useMessage.ts`（聊天）、`src/composables/dashboard/`（仪表盘状态）

## "改 X 去哪里"

| 需求 | 位置 |
| --- | --- |
| 调某个后端接口 | `src/api/<域>.ts`，新接口加在对应域文件，复用 `http.ts` |
| 改某个页面/组件 | `src/components/<域>/` |
| 跨组件复用逻辑 | `src/composables/` |
| 共享类型 | `src/types/` |
| MCP 工具展示/格式化 | `src/utils/mcpTools.ts` + `mcpFormat.ts` + `constants/mcp.ts` |
| 任务系统前端解析 | `src/utils/taskSystem.ts` |
| 统一请求配置（超时/token） | `src/api/http.ts` |

## 前端 7 大设计原则

| 原则 | 项目约定 |
| --- | --- |
| 开闭原则 | 新功能优先加在现有域目录的独立组件 / composable / 常量文件里，通过 props、emits、配置表扩展 |
| 依赖倒置原则 | 组件依赖 `src/api`、`src/composables`、`src/constants`、`src/types` 的稳定接口，不直接拼请求 |
| 里氏代换原则 | 共享类型里的对象契约保持可替换，不假设特殊子形态 |
| 合成-聚合复用原则 | 跨页面逻辑放 composable，静态表放 constants，纯格式化放 utils |
| 单一职责原则 | 组件→视图编排；API→请求；composable→状态流程；utils→无副作用转换 |
| 迪米特法则 | 一个模块只调相邻层，不穿透其它组件内部状态 |
| 接口隔离原则 | 新增类型/常量/API 时按域拆小接口，不堆进单个大组件 |

## 常见问题排查

| 症状 | 排查位置 |
| --- | --- |
| API 请求 401 | `src/api/http.ts` token 处理 / 后端 JWT_SECRET 是否一致 |
| API 请求 404 | 检查 `src/api/` 对应文件的路径；后端路由是否注册 |
| Socket.IO 无法连接 | vite proxy 配置（`vite.config.ts`）/ Connector Runtime (3002) 是否运行 |
| 聊天消息不显示 | `composables/useMessage.ts` socket 事件监听；`chat_message` 事件是否收到 |
| MCP 工具不显示 | `api/mcp.ts` 返回数据；`utils/mcpTools.ts` 工具映射是否包含该工具 |
| 任务进度不更新 | `composables/` 中 `task_update` 事件是否在监听 |
| 样式不生效 | Tailwind 类名是否在 `main.css` 的 content 扫描路径内；构建是否刷新 |

## 命令

```bash
npm install
npm run dev      # 启动开发服务器，端口 58150
npm run build    # vue-tsc 类型检查 + vite build → web/dist（gitignored）
```

## 注意点

- **构建配置只保留 `vite.config.ts`**（曾同时存在 `.js`/`.ts` 两份，已清理）。
- **改接口契约时**，前端 `src/api/` 与后端 `gateway/routers/` 要同步。
- **`web/dist`、`node_modules`、`package-lock.json`** 已 gitignore，不要提交。
- **游戏世界**相关代码在 `game/` 目录下，资产生成约定见 [`game/README.md`](game/README.md)。
