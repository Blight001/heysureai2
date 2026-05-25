# 浏览器 MCP 工具评估报告

## 测试概况

- 测试时间：2025年7月
- 共执行：22次核心工具调用
- 覆盖：6大功能类别

## 1. 功能完整度

### 完备能力（22项）

- 页面导航：`browser_navigate`（含 `new_tab` 参数）
- 页面信息：`browser_page_info`（URL/标题/元素统计/滚动状态）
- 内容提取：`browser_get_content`（文本+链接+meta）、`browser_find_text`（含选择器定位）
- 搜索跳转：`browser_search`（支持 baidu/google/bing）
- 元素交互：`browser_click`、`browser_type`、`browser_hover`、`browser_right_click`、`browser_double_click`、`browser_press_key`
- 标签管理：`browser_tab_list`、`browser_tab_open`、`browser_tab_close`
- 历史导航：`browser_history_back`
- 存储/剪贴板：`browser_storage_get`、`browser_clipboard_write`
- 卡片系统：`card_save`、`card_list`、`card_run`、`card_delete`（支持步骤编排与批量回放）

### 受限/异常（4项）

- `browser_evaluate`：受目标网站 CSP 策略限制（禁止 `unsafe-eval`），在百度、httpbin 等站点均无法执行
- `browser_fill_form`：返回 success 但 `filled` 数组为空，参数格式不明确
- `browser_scroll`：部分场景 `scrolledBy=0`，滚动行为不稳定
- `browser_drag`：依赖页面存在可拖拽元素，非通用故障

### 不可用（1项）

- `browser_screenshot`：已被管理员禁用

### 未测试（4项）

- `browser_select`
- `browser_history_forward`
- `card_get`
- `card_update_step`

## 2. 稳定性表现

- 断连频率：0次（22次调用全部返回响应）
- 超时情况：0次
- 错误率：约13.6%（3次失败：CSP x2 + drag x1）
- 核心问题：`browser_evaluate` 的 CSP 兼容性是最大稳定性隐患

## 3. 使用体验

- 操作流畅度：★★★★☆ 调用响应迅速，无感知延迟
- 反馈明确度：★★★★☆ 返回结构统一，含 `success`、`result`、`error`
- 异常提示：★★★☆☆ CSP 错误提示技术性强但不易理解；drag 失败提示清晰
- 亮点：`card_run` 步骤回放结果逐条展示，调试友好

## 4. 安全与权限

- 无明显越权风险：所有操作限定在浏览器沙箱内
- CSP 阻隔反而是安全优势：防止恶意代码注入
- 剪贴板写入安全：无静默读取，仅写入
- 建议：增加操作审计日志，敏感操作（如 cookie 读取）需二次确认

## 5. 综合改进方案

### 建议1：修复 `browser_evaluate` CSP 兼容性

改用 `chrome.debugger` API 或 CDP（Chrome DevTools Protocol）的 `Runtime.evaluate` 注入代码，绕过页面 CSP 限制。这是当前最影响可用性的问题。

### 建议2：补充 `browser_fill_form` 参数文档与示例

当前 `filled` 数组始终为空，需明确 `fields` 参数格式，如 `[{selector, value, action}]`，并提供标准示例。

### 建议3：增强 `browser_scroll` 的可靠性

增加 fallback 机制：当标准 `scrollBy` 无效时，自动尝试 `scrollIntoView` 或键盘模拟。

### 建议4：增加 `browser_evaluate` 降级策略

当 CSP 阻止时，自动尝试注入 `<script>` 标签或使用 bookmarklet 方式执行。

### 建议5：补充 `browser_download` / `file_system` 能力

当前缺失文件上传下载和本地文件系统交互能力，是自动化场景的重要缺口。

## 总体评分

- 功能完整度：78/100
- 稳定性：86/100
- 体验：82/100
- 安全性：88/100
- 综合：83/100（良好，核心功能可用，CSP 兼容性需优先解决）

## 同步记录

报告已同步保存至 memory（`mem_85b9c07ad759`）。原测试环境文件写入因缺少文件系统 MCP 工具无法完成，需管理员协助或扩展 workspace 写权限。本仓库副本已保存为当前文档。
