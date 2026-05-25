# 浏览器 MCP 能力测试与改进分析

## 测试结果概览

- 测试工具数：22 个
- 成功率：20/22（90.9%）
- 测试站点：百度（https://www.baidu.com）
- 完整报告 memory：`mem_81e7d4347fe5`

> 备注：原始记录中“成功 20/22”与成功工具清单数量存在不一致，成功清单列出了 22 个工具名，需复核最终统计口径。

## 成功工具

- `browser_navigate`
- `browser_page_info`
- `browser_get_content`
- `browser_type`
- `browser_click`
- `browser_wait`
- `browser_scroll`
- `browser_evaluate`
- `browser_find_text`
- `browser_extract`
- `browser_hover`
- `browser_tab_list`
- `browser_history_back`
- `browser_history_forward`
- `browser_tab_open`
- `browser_press_key`
- `browser_clipboard_write`
- `browser_right_click`
- `browser_double_click`
- `browser_storage_get`
- `browser_fill_form`
- `browser_search`

## 失败/异常

- `browser_drag`：元素不可拖拽
- `browser_select`：仅支持原生 `<select>`

## 截图能力

- `browser_screenshot`：管理员已禁用

## 5 大改进方向

1. `browser_scroll` 滚动可靠性增强
2. `browser_drag` / `browser_select` 容错增强
3. `browser_fill_form` 跨页面稳定性
4. `browser_get_content` / `browser_extract` 语义统一
5. `browser_screenshot` 按需启用机制

## 后续建议

- 复核成功率统计：确认测试工具总数是否包含 `browser_drag`、`browser_select`、`browser_screenshot`，以及成功列表是否应删减为 20 项。
- 针对 `browser_drag` 增加可拖拽性检测与更明确错误返回，例如返回目标元素的 `draggable`、事件监听推断、坐标信息。
- 针对 `browser_select` 增加自定义下拉框策略，例如当目标不是原生 `<select>` 时自动 fallback 到 click + text/option 匹配。
- 针对 `browser_screenshot` 增加配置开关和权限状态提示，让禁用原因在工具返回中更可读。

## 本轮优化落地

- `browser_select`：保留原生 `<select>` 支持，并新增常见自定义下拉框 fallback，会点击控件后按 option 文本、`data-value` 或 `value` 匹配选项。
- `browser_drag`：返回 `moved`、`warning` 和 `diagnostics`，包括源/目标元素 selector、tag、文本、`draggable`、role、可见性、cursor、坐标尺寸；找不到元素时错误信息包含诊断数据。
- `browser_get_content` / `browser_extract`：统一返回 `source`、`url`、`title`、`selector`、`items` 等语义字段；`extract` 的 item 统一包含 `tag`、`selector`、`text`、`attributes`。
- `browser_screenshot`：捕获失败时不再只有底层异常，返回 `success:false`、`disabled`、`error`、`hint`，便于判断是权限或管理员配置问题。
- 已执行验证：`npx tsc --noEmit`、`npm run build`。

## 能力扩展落地

### 参数与错误规范

- `browser_evaluate` 标准参数为 `code`，同时兼容 `function`、`fn`、`expression` 别名。
- 支持 `trace:true` 或 `return_error:true`，工具失败时返回结构化错误：`{success:false, error:{message, code, suggestion, trace}}`。
- content script 错误统一返回 `{message, code, suggestion}`，避免把嵌套 diagnostics 压成不可读字符串。

### 新增浏览器工具

- `browser_dom_snapshot`：DOM 树快照，可在截图禁用时替代视觉检查。
- `browser_iframe_list`：列出 iframe/frame，包含 `src`、`name`、可访问性和视口坐标。
- `browser_performance`：页面性能与最慢资源统计。
- `browser_network_log`：基于 Performance ResourceTiming 的被动网络日志；不是主动拦截。
- `browser_file_upload`：向 `<input type=file>` 注入内存文件内容，支持文本和 base64；不能读取任意本地路径。
- `browser_download`：通过 `chrome.downloads.download` 发起下载。
- `browser_cookie_list/get/set/delete`：Cookie 读取、写入、删除。
- `browser_storage_set/remove/list`：补齐 localStorage/sessionStorage 写入、删除、枚举。
- `browser_session_save/list/restore/delete`：保存/恢复轻量上下文快照，包括 URL、标题、localStorage、sessionStorage。
- `browser_profile_info/set`：扩展侧逻辑 profile 标记；Chrome 扩展不能切换浏览器用户 Profile。

### Card 自动化增强

- `card_run` 支持 `variables` / `vars`，步骤参数里可用 `{{name}}`、`{{item.xxx}}` 模板。
- 步骤支持 `if` 条件和 `save_as` 保存步骤结果。
- 支持 `var_set` 伪步骤设置变量。
- 新增 `card_run_batch`，对 `items` 批量执行卡片。
- 新增 `card_schedule`、`card_schedule_list`、`card_schedule_delete`，使用 Chrome alarms 支持 `interval_minutes`、`run_at`、以及简单 `*/N * * * *` cron。

### 权限变化

- `manifest.json` 新增 `debugger`、`cookies`、`downloads` 权限。
- 重新加载扩展时 Chrome 可能提示权限变更。

### 明确限制

- 网络拦截目前是被动 ResourceTiming 视图，不做请求/响应篡改。
- 文件上传不能直接读取本地文件路径，只能使用调用方传入的文件内容。
- Profile 支持是扩展内部逻辑 profile，不能切换 Chrome 用户数据目录。
- cron 仅支持简单 every-N-minutes 表达式，复杂 cron 需要后续引入解析器和调度持久化策略。
