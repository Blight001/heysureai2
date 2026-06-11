# CLAUDE.md — web/ 前端控制台

Vue 3 + Vite + TypeScript + Tailwind 的单页控制台。端口 **58150**，dev 时通过 vite proxy 把 `/api` `/socket.io` `/uploads` `/avatars` `/tmp-images` 转发到后端 `:3000`。

**两个 Vite 入口**：`index.html`（主控制台）+ `game/index.html`（Agent 进化与实战区域 / 游戏世界，dev 访问 `/game/`）。游戏世界的资产生成、帧布局约定见 [`game/README.md`](game/README.md)，设计方案见 [`../doc/Agent进化与实战区域设计方案.md`](../doc/Agent进化与实战区域设计方案.md)。

## 目录

```
src/
  api/         ← 后端接口封装，按域分文件 (auth/chat/agents/ai/projects/mcp/...)
               ← http.ts 是统一的 axios/fetch 客户端，其它都基于它
  components/  ← 组件，按域分目录：
                 chat/ 聊天界面   dashboard/ 仪表盘(含 cards/modals/panels)
                 home/ 首页       librarian/ 知识库   common/ 通用(登录/弹窗/资料)
  composables/ ← 组合式逻辑 (useAuth / useMessage / dashboard/*)
  constants/   ← 常量 (dashboard / mcp)
  types/       ← TS 类型 (agent / mcp / user / index)
  utils/       ← 工具 (chatMarkdown / chatParser / mcpTools / avatar / taskSystem ...)
  styles/      ← 全局样式 (main.css)
  App.vue main.ts ← 入口
```

## "改 X 去哪里"

| 需求 | 位置 |
| --- | --- |
| 调某个后端接口 | `src/api/<域>.ts`；新接口加在对应域文件，复用 `http.ts` |
| 改某个页面/组件 | `src/components/<域>/` |
| 跨组件复用逻辑 | `src/composables/` |
| 共享类型 | `src/types/` |
| MCP 工具展示/格式化 | `src/utils/mcpTools.ts` `mcpFormat.ts`、`constants/mcp.ts` |

## 命令

```bash
npm install
npm run dev      # 58150
npm run build    # vue-tsc 类型检查 + vite build → web/dist (gitignored)
```

## 注意点

- **构建配置只保留 `vite.config.ts`**（曾经同时存在 `.js`/`.ts` 两份，已清理）。
- 改接口契约时，前端 `src/api/` 与后端 `gateway/routers/` 要同步。
- `web/dist`、`node_modules`、`package-lock.json` 已 gitignore。
