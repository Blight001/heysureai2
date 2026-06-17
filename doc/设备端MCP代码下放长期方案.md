# 设备端 MCP 代码下放长期方案

> 本文描述一个长期方向：把 Windows 设备与浏览器插件中的“写死 MCP 工具实现”逐步迁移到服务器代码库，
> 由服务器统一保存、审计、版本化并下发。设备端不再作为 MCP 目录真相源，而退化为受控运行器与本地能力承载层。
>
> 这不是一次性重构清单，而是一份模糊但可落地的方向方案，用于后续拆阶段实现。

## 1. 一句话目标

服务器成为设备 MCP 工具代码的唯一真相源；Windows 客户端与浏览器插件只负责接收、校验、缓存、执行服务器下发的工具代码，并返回结果。

最终形态：

```
AI 调用 MCP
  -> Server 查询工具定义 / 权限 / 版本
  -> Server 把调用参数与工具代码派发给目标设备
  -> Windows 设备 / 浏览器插件在本地运行
  -> 返回结果、日志、截图、错误、耗时
  -> Server 记录调用统计与失败轨迹
```

## 2. 核心判断

当前 `device/windows/src/tools/*.ts` 与 `device/extension/src/lib/tools/*.ts` 中的很多代码，本质上不是“必须写死在设备端的 MCP”，而是“本地能力的某种封装”。

如果设备端预置了 Python / PowerShell / CMD / 浏览器脚本执行环境，服务器完全可以保存工具代码并下发执行。例如：

```json
{
  "name": "mouse.click",
  "runtime": "python",
  "input_schema": {
    "type": "object",
    "properties": {
      "x": { "type": "number" },
      "y": { "type": "number" }
    },
    "required": ["x", "y"]
  },
  "code": "import pyautogui\npyautogui.click(args['x'], args['y'])\nreturn {'ok': True}"
}
```

设备端不需要知道 `mouse.click` 是一个 MCP 工具；它只需要知道：

- 这是服务器签发的代码；
- 运行时是 Python；
- 参数是 `{x, y}`；
- 超时、权限、工作目录、环境变量是什么；
- 执行后把结果返回服务器。

## 3. 目标架构

### 3.1 Server：工具代码库

服务器负责保存和治理所有设备端 MCP 工具。

建议抽象为 `EndpointToolDefinition`：

| 字段 | 含义 |
| --- | --- |
| `name` | MCP 工具名，如 `mouse.click`、`browser.dom.query` |
| `device_type` | `desktop` / `browser` / `any` |
| `runtime` | `python` / `powershell` / `cmd` / `browser_js` / `node_js` / `program` |
| `input_schema` | AI 可见参数 schema |
| `description` | AI 可见工具说明 |
| `code` | 工具实现代码 |
| `permissions` | 文件、网络、进程、键鼠、剪贴板、浏览器页等权限声明 |
| `enabled` | 是否启用 |
| `version` | 当前版本 |
| `status` | `draft` / `active` / `disabled` / `archived` |
| `owner` | `web` / `ai` / `migration` / `system` |

现有 `DeviceDynamicTool` / `DeviceDynamicToolVersion` 可以作为第一版基础，但长期上需要更明确区分：

- “工具定义”：AI 看到和调用的 MCP；
- “运行包”：设备实际执行的代码与依赖；
- “权限策略”：能否运行、是否需要确认、能访问哪些资源；
- “版本记录”：可回滚但不回滚副作用。

### 3.2 Windows 设备：受控执行器

Windows 客户端长期只保留几类底座能力：

| 模块 | 职责 |
| --- | --- |
| `tool_config_sync` | 登录/上线后拉取或接收服务器下发的工具包 |
| `python_runner` | 在固定 venv 中运行 Python 代码 |
| `powershell_runner` | 执行受控 PowerShell |
| `cmd_runner` | 执行受控 CMD |
| `node_runner` | 可选，运行 Node/Electron 侧脚本 |
| `artifact_bridge` | 返回截图、文件、结构化结果 |
| `permission_guard` | 本地二次校验权限与用户确认 |
| `process_guard` | 超时、中止、并发限制、日志截断 |

这意味着 `device/windows/src/tools/keyboard.ts`、`mouse.ts`、`clipboard.ts`、`screen.ts`、`window.ts`、`filesystem.ts`、`process.ts` 不再长期作为“固定 MCP 工具目录”存在。

它们可以逐步演化为：

1. 迁移样例：用于生成服务器端默认工具定义；
2. 兼容层：短期继续提供给动态 JS 的 `cap.call(...)`；
3. 最终被 Python / PowerShell / CMD / Node 代码替代，或只保留极少量无法用通用运行时稳定覆盖的 Electron 原生桥。

### 3.3 浏览器插件：页面内执行器

浏览器插件的约束比 Windows 更强，因为扩展权限、内容脚本隔离、页面 CSP、跨域请求都有限制。

浏览器端长期可以保留以下底座：

| 模块 | 职责 |
| --- | --- |
| `tool_config_sync` | 接收服务器下发的 browser 工具包 |
| `browser_js_runner` | 在扩展安全上下文运行工具代码 |
| `content_script_bridge` | 向目标页面注入或转发 DOM 操作 |
| `tab_bridge` | 标签页查询、切换、导航、截图 |
| `permission_guard` | 检查 host permissions、activeTab、用户确认 |
| `result_bridge` | 返回 DOM 结果、截图、下载文件、错误 |

浏览器插件里原本写死的 `browser.*` MCP 可以变成服务器保存的 `browser_js` 工具：

```js
const tab = await browser.tabs.query({ active: true, currentWindow: true })
const [{ result }] = await browser.scripting.executeScript({
  target: { tabId: tab[0].id },
  func: (selector) => document.querySelector(selector)?.textContent || '',
  args: [args.selector],
})
return { text: result }
```

插件端仍然必须保留“执行这段代码的桥”，但不必把每个工具的业务逻辑写死在插件代码里。

## 4. 代码下发与调用协议

### 4.1 工具包同步

设备上线：

```
device.register
  -> server 校验账号 / 设备 / 版本
  -> server 返回或推送 tool_config_revision
  -> device 若 revision 不一致，拉取工具包
  -> device 缓存到本地 server-authored config
  -> device 回报 applied_revision
```

工具编辑：

```
web / AI 修改工具
  -> server 写版本记录
  -> server 生成新 revision
  -> server 推送 device:tool-config
  -> online device 热加载
  -> offline device 下次上线补拉
```

### 4.2 单次调用

```
AI -> mcp tool args
Server:
  1. 解析工具名
  2. 检查 AI 权限 / 角色 / 任务覆盖范围
  3. 找目标设备
  4. 检查工具版本与设备 applied_revision
  5. 派发 run_tool {tool_name, version, runtime, args, timeout}

Device:
  1. 校验工具版本与签名
  2. 检查本地权限
  3. 准备临时目录 / 环境变量 / stdin
  4. 执行代码
  5. 返回 result / stdout / stderr / artifacts / error
```

## 5. Windows 长期实现方向

### 5.1 Python 优先

Windows 自动化的通用工具可以优先迁到 Python：

| 能力 | 可能库 |
| --- | --- |
| 鼠标键盘 | `pyautogui`、`pynput` |
| 剪贴板 | `pyperclip` |
| 截图 | `mss`、`Pillow`、`pyautogui.screenshot` |
| 窗口管理 | `pygetwindow`、`pywinauto`、`uiautomation` |
| UIA | `uiautomation`、`pywinauto` |
| 进程 | `psutil` |
| 文件 | Python 标准库 |
| OCR / 视觉 | 后续可接 `opencv-python`、模型服务或系统 OCR |

第一阶段可以预置一个固定 venv：

```
device_runtime/
  python/
    .venv/
    requirements.lock
    runner.py
```

设备端 TypeScript 只负责启动：

```
python runner.py --tool-id ... --args-json ...
```

### 5.2 PowerShell / CMD 作为补充

不是所有 Windows 操作都适合 Python。PowerShell 可以作为系统管理工具运行时：

- 查询服务；
- 查询注册表；
- 启停进程；
- 调用系统命令；
- 管理文件权限；
- 执行诊断脚本。

长期不建议让任意 PowerShell 默认开放，应按工具声明分级：

| 风险 | 策略 |
| --- | --- |
| 只读命令 | 可自动执行，记录日志 |
| 写文件 / 改配置 | 需要 AI 权限 + 用户或管理员授权 |
| 删除 / 提权 / 下载执行 | 默认拒绝或强确认 |

### 5.3 本地底座最终保留什么

Windows 端最终仍应保留：

- 登录与 socket 通信；
- 工具包同步；
- Python / PowerShell / CMD runner；
- 依赖环境管理；
- 权限守卫；
- 执行日志；
- 进程中止；
- 本地确认弹窗；
- artifact 上传；
- 兼容旧工具的桥接层。

最终可以删除或降级为兼容层：

- 固定 MCP catalog；
- 每个工具对应一个 TypeScript handler 的模式；
- 设备主动把全部工具作为 MCP 目录上传给服务器的逻辑；
- 本地 `mcp.manage_dynamic_tool` 作为主要编辑入口。

## 6. 浏览器插件长期实现方向

### 6.1 Browser JS 工具由服务器保存

浏览器插件不能像 Windows 那样任意执行 Python，但可以执行服务器下发的受控 JS。

工具定义示例：

```json
{
  "name": "browser.page.extract_text",
  "device_type": "browser",
  "runtime": "browser_js",
  "permissions": ["active_tab", "read_dom"],
  "code": "return await bridge.contentScript(args.tabId, (selector) => document.querySelector(selector)?.innerText || '', [args.selector])"
}
```

插件端暴露的不是 MCP，而是 `bridge`：

- `bridge.tabs.query`
- `bridge.tabs.update`
- `bridge.scripting.execute`
- `bridge.contentScript`
- `bridge.captureVisibleTab`
- `bridge.storage`

### 6.2 插件权限模型更严格

浏览器端需要额外关心：

- 当前 tab 是否允许；
- host permissions 是否覆盖目标站点；
- 是否需要用户点击扩展后才有 `activeTab`；
- 页面 CSP 与 isolated world；
- 不能把服务器下发 JS 直接注入页面主世界，除非明确需要；
- 敏感站点可默认拒绝或强确认。

### 6.3 插件端最终保留什么

浏览器插件最终保留：

- 登录与服务器通信；
- 工具包同步；
- browser_js runner；
- content script bridge；
- tab / scripting / screenshot bridge；
- 权限守卫；
- 执行日志与错误回传；
- 旧版工具兼容层。

最终可以删除或降级：

- 插件端写死的 MCP 工具目录；
- 插件主动上报 MCP 工具作为主目录；
- 每个浏览器 MCP 工具一份固定 TypeScript 实现的模式。

## 7. 安全与治理

这个方案本质上把系统升级成“服务器远程执行本机代码”。因此安全层必须比当前更清楚。

### 7.1 最低安全基线

- 工具代码必须有版本与签名；
- 设备只执行当前账号服务器签发的工具；
- 每次执行必须记录工具名、版本、调用方 AI、参数摘要、耗时、结果、错误；
- 所有运行时必须有超时；
- stdout / stderr 必须截断；
- artifact 必须有大小上限；
- 高风险权限必须二次确认；
- 设备端必须能一键暂停远程执行。

### 7.2 权限声明

建议统一权限标签：

| 权限 | 含义 |
| --- | --- |
| `keyboard` | 模拟键盘输入 |
| `mouse` | 移动/点击鼠标 |
| `clipboard.read` | 读取剪贴板 |
| `clipboard.write` | 写剪贴板 |
| `screen.read` | 截图 |
| `window.read` | 枚举窗口 |
| `window.write` | 聚焦/关闭/移动窗口 |
| `filesystem.read` | 读文件 |
| `filesystem.write` | 写文件 |
| `process.read` | 查进程 |
| `process.kill` | 结束进程 |
| `shell.read` | 只读命令 |
| `shell.write` | 写入型命令 |
| `network` | 访问网络 |
| `browser.dom.read` | 读取网页内容 |
| `browser.dom.write` | 修改网页 / 填表 / 点击 |

### 7.3 审批层级

| 来源 | 默认状态 |
| --- | --- |
| 系统迁移生成 | active，但需要内置审核 |
| 用户网页创建 | draft 或 active，取决于风险 |
| AI 自主创建 | draft |
| AI 修改高风险工具 | draft + 人审 |
| 低风险修正文案 / schema | 可自动保存，保留审计 |

## 8. 迁移路线

### 阶段一：服务器成为设备动态 MCP 主入口

- [ ] 保留现有设备内置工具；
- [ ] 网页端“传承技能”管理服务器保存的动态 MCP；
- [ ] 设备继续接收 `device:tool-config` 并缓存；
- [ ] Windows 动态工具支持 `runtime=python`；
- [ ] 浏览器动态工具支持 `runtime=browser_js`；
- [ ] 调用统计、失败记录、版本回滚可用。

### 阶段二：内置工具一次性播种到服务器

- [ ] 写迁移脚本，把 Windows / Browser 当前内置工具转成服务器工具定义；
- [ ] 设备上线不再自动播种内置工具；
- [ ] 服务器工具定义可覆盖旧内置工具；
- [ ] MCP 目录由服务器生成，而不是设备上报决定。

### 阶段三：设备上报 capability，不再上报 MCP

- [ ] 设备注册时只上报运行能力：`python`、`powershell`、`browser_js`、依赖版本、系统信息；
- [ ] Server 根据 capability 下发匹配工具；
- [ ] AI 可见 MCP 目录完全来自服务器 DB；
- [ ] 旧 `toolDefs` 上报变成兼容字段或调试字段。

### 阶段四：逐步删除 TypeScript 固定工具

- [ ] 对每个 `device/windows/src/tools/*.ts` 工具找到服务器端替代定义；
- [ ] 灰度：同名服务器工具优先，失败可回退旧 TS 工具；
- [ ] 连续稳定后删除或移入 legacy；
- [ ] 浏览器插件同理迁移固定工具到服务器定义。

### 阶段五：AI 自主进化进入闭环

- [ ] AI 只能提交工具 draft；
- [ ] Server 自动跑静态检查、权限分析、简单回放测试；
- [ ] 用户审批后 active；
- [ ] 工具成功率低自动降权或提示修复；
- [ ] 可从失败记录一键生成修复草案。

## 9. 关键取舍

### 好处

- 工具代码统一管理；
- 多设备一致；
- 可版本回滚；
- 可审计；
- AI 可以迭代工具而不需要改客户端代码；
- Windows 和浏览器插件都变薄；
- 新工具上线不需要重新打包客户端。

### 代价

- 安全复杂度显著提升；
- 运行环境依赖需要管理；
- Python / PowerShell / Browser JS 的错误边界不同；
- 设备端调试更依赖日志与 artifact；
- 某些底层能力仍可能需要 Electron / 扩展 API 桥；
- 需要设计工具签名、权限、灰度和回滚。

## 10. 最终愿景

长期看，设备端不是“带一堆写死工具的客户端”，而是“受控的本地执行节点”。

服务器保存工具知识、代码、版本与权限；设备提供运行环境、系统权限与本地反馈。  
AI 不再依赖客户端发布周期获得新能力，而是在服务器代码库中沉淀、修复、灰度和晋升工具。

这会把 HeySure 的 MCP 从“设备上报能力目录”推进到“服务器治理的可进化代码库”。
