# 浏览器 MCP 工具整理方案

## 背景

浏览器扩展（`agent/extension`）对外暴露的 `browser_*` MCP 工具增长到 **47 个**，
在工具列表、权限编辑器、AI 的 `list_tools` 里都显得「又多又杂」。本方案在不削减
任何实际能力的前提下，把工具收敛、分类统一，降低认知与维护成本。

## 问题诊断

1. **CRUD 类工具把列表撑大了。** 状态管理类操作按「资源 × 动作」拆成了一堆同质工具，
   占了将近一半：
   - `browser_cookie_list / get / set / delete`（4）
   - `browser_storage_get / set / remove / list`（4）
   - `browser_session_save / list / restore / delete`（4）
   - `browser_tab_list / open / close`（3）
   - `browser_history_back / forward`（2）
   - `browser_profile_info / set`（2）

   合计 **19 个**工具，本质是 6 组资源上的增删查改。

2. **分类逻辑在 3 处各写了一份。** 工具该归到哪个「浏览器 X」分组，分别硬编码在：
   - `agent/extension/src/lib/tools/definitions.ts`（数组顺序隐含分组）
   - `web/src/utils/mcpTools.ts`（`getEndpointCapabilityTag`）
   - `web/src/components/dashboard/modals/AgentMcpScopeEditor.vue`（`browserIntro`）

   三处各自维护一份 `browser_*` 名单，加新工具要改三遍，且已经出现不一致
   （Web 端把 storage 全家归到「浏览器数据」，权限编辑器又单独分了 session / cookie / profile）。

3. **`browser.ts` 918 行**把 helper、47 个实现、路由揉在一起，可读性差。

## 整理目标

- **工具数 47 → 34**：把上面 19 个 CRUD 工具收敛为 6 个带 `action` 参数的工具。
- **能力不减**：每个被合并的旧工具，都能用「新工具 + action」一一对应地表达。
- **分类单一来源**：在 `definitions.ts` 用一份 `BROWSER_TOOL_CATEGORIES` 描述分组，
  扩展端的 popup 直接用它；服务端 / Web 端按统一前缀规则归类，去掉重复名单。
- **向后兼容**：旧工具名（`browser_cookie_get` 等）仍可被调用，路由层把它们改写为
  「新工具 + action」。已保存的权限 scope 不会因为改名而报错——离线/在线能力按名取交集，
  旧名只是不再出现在能力列表里。

## 合并设计

| 新工具 | 合并的旧工具 | `action` 取值 |
| --- | --- | --- |
| `browser_tab` | `tab_list` / `tab_open` / `tab_close` | `list` / `open` / `close` |
| `browser_history` | `history_back` / `history_forward` | `back` / `forward` |
| `browser_cookie` | `cookie_list` / `cookie_get` / `cookie_set` / `cookie_delete` | `list` / `get` / `set` / `delete` |
| `browser_storage` | `storage_get` / `storage_set` / `storage_remove` / `storage_list` | `get` / `set` / `remove` / `list` |
| `browser_session` | `session_save` / `session_list` / `session_restore` / `session_delete` | `save` / `list` / `restore` / `delete` |
| `browser_profile` | `profile_info` / `profile_set` | `info` / `set` |

合并工具的其余参数沿用原工具（如 `cookie` 的 `name/value/domain/...`、`storage` 的
`key/value/type/prefix/...`），只是多了一个必填的 `action` 来选动作。

**保持独立**的核心操作不动（导航、点击、输入、截图、滚动等高频且语义清晰的工具
拆开更利于 AI 理解），避免过度合并。

## 分类（5 大类，34 工具）

| 分类 | 工具 |
| --- | --- |
| 导航与搜索 | `navigate` `search` `history` |
| 页面观察 | `screenshot` `get_content` `dom_snapshot` `page_info` `find_text` `find_popups` `performance` `network_log` `iframe_list` |
| 页面交互 | `click` `double_click` `right_click` `type` `press_key` `hover` `scroll` `wait` `drag` `fill_form` `select` `close_popup` |
| 数据与脚本 | `evaluate` `extract` `clipboard_write` `file_upload` `download` |
| 浏览器状态 | `tab` `cookie` `storage` `session` `profile` |

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `agent/extension/src/lib/tools/definitions.ts` | 按分类重排；新增 6 个合并工具的 schema；导出 `BROWSER_TOOL_CATEGORIES` |
| `agent/extension/src/lib/tools/browser.ts` | 新增 6 个按 `action` 分发的 handler；旧实现保留为内部函数；路由表用「新工具 + 旧名别名」 |
| `agent/extension/src/lib/tools/executor.ts` | `inferTool` 里 `browser_tab_list` → `browser_tab` |
| `agent/extension/src/popup/mcp.ts` | 工具列表按 `BROWSER_TOOL_CATEGORIES` 分组展示 |
| `web/src/utils/mcpTools.ts` | `browser_*` 改为按统一前缀归类，去掉冗长名单 |
| `web/src/components/dashboard/modals/AgentMcpScopeEditor.vue` | `browserIntro` 改为按新分类，删冗余名单 |
| `README` / `doc/prompt/浏览器助手prompt.md` | 同步工具说明 |

## 兼容性与风险

- **AI 调用**：模型每轮通过 `list_tools` 拿到的是新工具表，会用新名；少量历史习惯
  用旧名的调用由路由别名兜底。
- **已保存权限**：scope 以工具名取交集，旧名从能力表移除后自动失效，不会报错；
  用户重开权限编辑器即可看到收敛后的新工具并勾选。
- **构建**：扩展用 esbuild 打包，Web 用 Vite + tsc，改动均为同语言内重构，类型可校验。
