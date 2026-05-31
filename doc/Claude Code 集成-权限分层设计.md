# Claude Code 集成 - 权限分层设计

本文记录在 agent 端(Electron 桌面端)集成 Claude Code CLI 时的权限模型。
权限是整套方案中最复杂的一环,需要在动手前先达成共识。

## 1. 背景与边界

### 1.1 集成形态

- Claude Code CLI 嵌入 `agent/windows`(后续扩展 `agent/linux`),不进服务器
- Electron 主进程通过 `child_process` 起子进程:
  `claude --print --output-format stream-json --input-format stream-json ...`
- API key:MVP 由用户自填(`electron-store` 加密存储),后续支持服务器发放
- 工具暴露:本地 stdio MCP server 只补 Claude 没有的能力(键鼠模拟、屏幕捕获、
  窗口管理),Read/Write/Bash 沿用 Claude 自带
- 任务触发:用户在 agent UI 主动发起,或由 `connector_runtime` 下发任务到 agent

### 1.2 Skill 来源

- 当前:服务器下发(可信)
- 后续:Claude Skills 官方仓库、ClowHub(待确认完整名称)、用户本地
- 三种来源信任级别不同,权限策略不同

### 1.3 为什么权限要专门设计

三类风险面:

1. **CLI 默认权限模式不适配后端化的使用方式**
   `default` 模式每次工具调用都问用户,会卡住自动任务流;`bypassPermissions`
   一刀切又放弃了所有边界。需要按场景分别配置。
2. **服务器下发任务是新增的攻击面**
   即使可信服务器,被劫持的下发通道也可能让 Claude 在用户机器上做超出预期的事。
3. **第三方 skill 等价于远程代码下发**
   skill 文件包含可执行 bash / 脚本片段,启用即执行,等同于 RCE,
   不能与本地用户编写的 skill 一视同仁。

## 2. 权限分层

四层从外到内,任一层拒绝即整个调用拒绝。

### 2.1 第一层:CLI 权限模式

按 session / task 场景选择 `--permission-mode`:

| 场景 | 模式 | 说明 |
|---|---|---|
| 普通对话(用户在 UI 自己发起) | `acceptEdits` | 文件编辑自动批准,其他工具询问(由第三层 hook 接管询问) |
| 服务器下发的明确任务 | `bypassPermissions` | 任务包内已声明 allowedTools,放权给后续层 |
| 用户标记为"高风险"或预览模式 | `plan` | 只规划不执行,生成可读步骤,用户确认后再切真执行 |

**不允许** 全局默认 `bypassPermissions`。

### 2.2 第二层:工具白名单 / 黑名单

每个 session 和 task 独立配置:

- `--allowedTools` 限定本次 session 能用的工具集合
- `--disallowedTools` 显式禁用危险工具(`Bash(rm:*)`, `Bash(sudo:*)`, ...)
- 服务器下发任务时,任务包自带白名单;本地用户发起的对话用 agent 设置里的默认白名单

工具命名遵循 Claude Code 规范:
- 内置:`Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` ...
- MCP:`mcp__<server>__<tool>`,例如 `mcp__heysure-local__screenshot`

### 2.3 第三层:运行时 hook 拦截 + UI 确认

Claude Code 支持 `PreToolUse` / `PostToolUse` hook。Electron 主进程注册 hook:

- `PreToolUse` 触发 → 主进程根据规则决定 `allow / deny / ask`
- `ask` 路径推 renderer 弹窗,展示工具名、参数摘要、风险标签
- 用户选项:`本次允许` / `本次拒绝` / `始终允许此工具` / `始终拒绝此工具`
- 偏好持久化到 `electron-store`,可在 agent 设置里清空

**必备 UI 元素:**

- 全局"紧急停止"按钮(任何窗口可见),按下立即 SIGTERM 所有 Claude 子进程
- 实时执行指示器:"Claude 正在调用 `mcp__heysure-local__click`(参数:...)"
- 历史决策面板:能看到 / 撤销曾经的"始终允许"决定

### 2.4 第四层:本地 MCP server 自身权限

MCP server(`services/localMcpServer`)在 tool handler 里再做一层校验:

| 工具 | 权限点 |
|---|---|
| `screenshot` | 首次调用走 OS 级权限弹窗(Win 直接通过,mac 需 ScreenCapture 授权,Linux Wayland 受限);维持"截屏总开关" |
| `click / type / key` | 没有 OS 弹窗,MCP server 维持"键鼠操作总开关",默认关,renderer 切换;每次调用记录到操作日志 |
| `fs.read / fs.write`(若启用) | 限定在用户授权目录,默认仅 `userData/`,白名单外的路径直接拒绝 |
| `window.activate` | 同键鼠总开关 |

第四层与第三层的关系:第三层是 Claude 调用进入 MCP server **之前** 的拦截,
第四层是 MCP server 自身的硬边界。任一拒绝即失败。

## 3. 服务器下发任务的权限边界

这是 agent 路线引入的新攻击面,**单独制定策略**。

### 3.1 任务下发协议

`connector_runtime` 下发的 `claude-code` 类型任务必须携带权限策略包:

```jsonc
{
  "task_type": "claude-code",
  "task_id": "...",
  "prompt": "...",
  "permission_policy": {
    "permission_mode": "bypassPermissions" | "acceptEdits" | "plan",
    "allowed_tools": ["Read", "Bash(git:*)", "mcp__heysure-local__screenshot"],
    "disallowed_tools": ["Bash(rm:*)"],
    "max_steps": 20,
    "workdir": "userData/tasks/<task_id>/",
    "require_user_confirmation": ["mcp__heysure-local__click", "mcp__heysure-local__type"],
    "timeout_seconds": 600
  }
}
```

### 3.2 agent 本地硬上限

agent 维护一份"服务器最多能让我干什么"的本地策略文件
(`userData/server-task-policy.json`),用户可在设置里编辑。
服务器策略与本地硬上限取交集 — 服务器无法突破本地上限。

默认硬上限示例:
- 永远禁用 `Bash(sudo:*)`, `Bash(rm:-rf*)`, 任意网络下载执行
- 键鼠 / 截屏始终需要用户确认(`require_user_confirmation` 不可被服务器关掉)
- `workdir` 必须落在 `userData/tasks/` 子目录,不允许跳出

### 3.3 task 隔离

每个服务器任务一个临时 workdir,跑完清理。生成的 `.mcp.json` 也在 workdir 内,
不污染用户的常规对话 session。

### 3.4 task 结果回传

回传内容:最终 assistant 消息、工具调用列表、退出原因、token 用量。
**默认不回传** thinking 块全文(隐私 + 带宽),仅回传摘要。
用户可在设置里改成"回传完整 thinking"。

## 4. Skill 仓库权限

skill 文件包含可执行内容,需要按来源分级。

### 4.1 来源分级

| 来源 | 信任等级 | 默认策略 |
|---|---|---|
| 用户本地编写(`userData/.claude/skills/local/`) | 高 | 直接启用 |
| 服务器下发(`userData/.claude/skills/server/`) | 中 | 启用前列出 skill 名 + 摘要,用户一次性确认本服务器 |
| Claude Skills 官方仓库 | 中 | 同上,且锁定到具体 release 版本 |
| ClowHub / 其他第三方仓库 | 低 | 每个 skill 独立确认,默认 `plan` 模式预览,工具白名单严格 |

### 4.2 启用流程

1. 用户在 agent UI"Skill 市场"页选中要装的 skill
2. 拉取到 cache 目录,展示 SKILL.md 全文 + 声明使用的工具列表
3. 用户确认 → 写入 `userData/.claude/skills/<source>/<skill-name>/`
4. 注入到 session 的工具白名单中(白名单与 skill 声明的工具取交集)

### 4.3 skill 沙箱

- 低信任来源的 skill 默认运行在 `plan` 模式预览,用户看完计划再切真执行
- skill 声明的 `bash` 命令走严格白名单匹配,不允许任意 `Bash`
- skill 不允许声明 `mcp__heysure-local__*` 工具(本地敏感工具只能由 agent 自身配置授权)

### 4.4 同名冲突

多源同名 skill 按 `本地 > 服务器 > 官方 > 第三方` 优先级,UI 给出冲突提示。

## 5. 思考(extended thinking)的处理

thinking 不是权限问题,但与服务器下发/回传策略相关,放这里统一记录。

| 决策 | 默认 |
|---|---|
| 默认是否开启 | 关 |
| 用户对话开关 | 是,renderer 一个 toggle |
| 任务级开关 | 服务器下发的任务可在 `permission_policy` 里要求开启 |
| 回传服务器 | 否,只回传 assistant 文本与工具调用 |
| renderer 展示 | 折叠,可展开 |

## 6. 跨平台考量

- robotjs 在 Linux Wayland 下基本不工作,需要 `xdotool` (X11) 或 `ydotool` (Wayland, 需 root) 兜底
- 截屏 Linux 也按显示协议分流:`gnome-screenshot` / `grim`
- 上述差异封装在本地 MCP server 内,Claude 看到的工具签名跨平台一致
- 文件路径全部用 Node `path` 模块,不写死分隔符

## 7. 能力分发与知识库对接

`librarian`(图书管理员)知识库已经为后续沉淀预留了两个内置栏目,Claude Code
集成方案直接复用它们作为"能力包"的载体,不再造一套知识管理。

### 7.1 现有栏目与新概念的对齐

| 知识库栏目(title) | 当前 summary | 在本方案里承载 | 文件形态 |
|---|---|---|---|
| **传承思想** | 预留沉淀 Markdown 思想文档 | **Skill**(Claude Code 的 SKILL.md + 资源) | `<skill>/SKILL.md` (+ 资源目录) |
| **传承技能** | 预留沉淀 Python 脚本技能 | **Tool**(MCP tool 定义 + 实现) | `<tool>/tool.json` + 脚本 |

> 注:`server/api/services/librarian_service.py` 里目前的变量命名是反的 —
> `builtin.inheritance_skills` 实际对应 title "传承技能"(=Tool),
> `builtin.inheritance_tools` 实际对应 title "传承思想"(=Skill)。
> 建议落地新分栏时把变量名与 title 对齐,或改为
> `builtin.inheritance_thoughts` / `builtin.inheritance_skills`。
> 这是一次性破坏改动,改完语义清晰。

### 7.2 "传承思想"(Skill)分栏

| 子分栏 | 来源 | 落盘路径 | 信任档 |
|---|---|---|---|
| **沉淀 skills** | 用户在本机创作 + AI 间转授积累 | `userData/.claude/skills/local/<skill_id>/` | 高 |
| **网络互联 skills** | Claude Skills 官方仓库 / ClowHub / 其他源 | `userData/.claude/skills/remote/<source>/<skill_id>/` | 低/中,沿用 §4 来源分级 |

UI 上"传承思想"展开两个 tab,数据层用 `subcategory` 字段(`local` / `remote`)区分,
拉取/同步/缓存/权限策略按 §4 分别处理。前端入口复用
`web/src/components/dashboard/panels/KnowledgeBasePanel.vue`。

### 7.3 "传承技能"(Tool)分栏

与思想对齐,同样两个子分栏:

| 子分栏 | 来源 | 落盘路径 |
|---|---|---|
| **沉淀 tools** | 用户/AI 在本机创作的 MCP tool 包 | `userData/mcp-tools/local/<tool_id>/` |
| **网络互联 tools** | 从外部源拉取的 MCP tool 包 | `userData/mcp-tools/remote/<source>/<tool_id>/` |

Tool 风险高于 skill(本身是可执行代码,Claude 会自动调用),
**网络互联 tools 默认不允许 AI 间转授,只能由用户主动装载并确认源**。

### 7.4 统一抽象:能力包(Capability)

skill 与 tool 用同一个 `Capability` 抽象表示,差异在 `kind`:

```jsonc
{
  "capability_id": "skill.web-summarize.v3",
  "kind": "skill" | "tool",
  "subcategory": "local" | "remote",
  "source": "user" | "ai:<ai_id>" | "remote:claude-skills" | "remote:clowhub" | ...,
  "title": "网页摘要",
  "summary": "...",
  "version": "3.0.1",
  "manifest": { /* SKILL.md frontmatter 或 tool.json */ },
  "files": [...],
  "declared_tools": ["Read", "WebFetch"],         // skill 声明使用的工具
  "provides_tools": ["mcp__local__summarize"],    // tool 类型才有
  "trust_tier": "high" | "medium" | "low",
  "transferable_by_ai": true | false              // 是否允许 AI 间转授,见 §7.6
}
```

librarian 现有"流程知识"记录可直接扩展这些字段(`subcategory`、`kind`、
`trust_tier`、`transferable_by_ai`),不必新建表。

### 7.5 装载与卸载(用户 → AI)

每个 AI 配置(`ai_config`)新增两个关联字段:

- `installed_skills`: capability_id 列表
- `installed_tools`: capability_id 列表

UI 操作:
- 在"传承思想 / 传承技能"列表里选中能力包 → 选目标 AI → 点"装载到此 AI"
- 在 AI 详情页"已装载能力"区域单独卸载

后端动作:
- 装载:写 `ai_config.installed_*`,在该 AI 下次启动 Claude Code session 时生效
- 卸载:反向

**装载不等于立即生效。** Claude CLI 启动后不热加载 `.mcp.json` 与 skills 目录,
运行中的 session 看不到新装的能力,需要新会话生效。UI 必须给出
"已装载,新会话生效"提示。

### 7.6 AI ↔ AI 转授

发起方 AI 通过新增 MCP tool 把自己已装载的能力授予另一个 AI(实现位置
`server/api/mcp/tools/`,与现有 `ai.send_message` 同层):

- `capability.grant(target_ai_id, capability_id, reason)`
- `capability.revoke(target_ai_id, capability_id)`

**约束(关键安全设计):**

1. 只能转授 `transferable_by_ai = true` 的能力包
2. 默认值:
   - 沉淀来源(`subcategory=local`) → true
   - 网络互联来源(`subcategory=remote`) → false
   - tool 比 skill 更严:网络互联 tool 强制 false,用户也不能改
3. 受授方默认不自动接受,生成一条 pending grant,等用户在 UI 确认
   - 用户可对 `<发起 AI, 受授 AI, 能力分类>` 三元组设白名单跳过确认
   - 跨用户场景(多用户)的转授永远需要确认,不允许白名单
4. 转授审计:新增 `capability_grant_log` 表,记录
   `from_ai / to_ai / capability_id / ts / reason / decision`,UI 可查

**为什么要这么严?**
AI 间转授等价于"一个 AI 替另一个 AI 决定信任新能力"。如果不卡,
一个被劫持或越权运行的 AI 可以把恶意远程能力批量授予整个数字社会的其他 AI,
权限边界形同虚设。

### 7.7 运行时注入:session 启动时构建工具/技能视图

每次 agent 端启动 Claude Code 子进程时,基于目标 AI 的装载清单,在 workdir
内动态构建:

- `.mcp.json` — 由 `installed_tools` 中的 tool 包合并 + 本地系统 MCP server
  (键鼠/截屏)生成
- `.claude/skills/` — `installed_skills` 中的 skill 文件软链接进来(Linux/mac)
  或拷贝(Windows)
- `--allowedTools` / `--disallowedTools` — 从 capability 的 `declared_tools` /
  `provides_tools` 汇总,与 §3 服务器策略包取交集

session 结束清理 workdir,装载状态长期保存在 `ai_config`,下次重建。

### 7.8 与 §4 Skill 仓库权限的关系

§4 关注"skill 从哪儿来 / 启用前怎么审"(入库审查)。§7 关注"能力包怎么分发到
具体 AI"(装载 / 转授)。两者层叠:

1. 先按 §4 决定 skill / tool 是否进入"传承思想 / 传承技能"知识库
2. 再按 §7 决定能力包装到哪个 AI 上

两层都通过,某个 AI 才能在 session 里真正用上。

## 8. 实施路线

### MVP(最小可用)
- CLI 嵌入打包(electron-builder extraResources)
- 用户自填 API key,electron-store 存储
- `acceptEdits` 模式 + 紧急停止按钮 + 简单工具白名单
- 本地 MCP server 暴露 `screenshot` + `click` + `type`(总开关默认关)
- 仅支持用户在 UI 主动发起的对话

### v2
- 第三层 PreToolUse hook 接入,弹窗确认 + 偏好持久化
- `connector_runtime` 下发任务 + 权限策略包 + 本地硬上限
- 服务器下发 skill 通道
- `librarian` 栏目变量名与 title 对齐;"传承思想 / 传承技能"分别落地
  `local` / `remote` 子分栏字段
- `Capability` 抽象在数据层落地;`ai_config.installed_skills` /
  `installed_tools` 字段及"装载到此 AI"UI
- session 启动时的 `.mcp.json` / `.claude/skills/` 动态注入(§7.7)

### v3
- 接 Claude Skills 官方仓库,版本锁定
- 第三方 skill 仓库(ClowHub 等)对接,plan 预览
- skill 同名冲突 / 灰度发布
- AI ↔ AI 转授(`capability.grant` / `capability.revoke`)+ pending 确认 UI +
  `capability_grant_log` 审计
- 网络互联 tool 子分栏开放(默认禁止 AI 转授,见 §7.6)

### v4(可选)
- 服务器统一下发 API key(平台计费模式)
- 多 session 并行 / 后台任务队列
- Linux agent 跨发行版打包

## 9. 待回答的开放问题

- ClowHub 准确指向哪个项目?对接协议是什么?
- 服务器下发任务的"权限策略包"是否需要签名,防止下发通道被劫持?
- thinking 是否计入 agent 端的本地 token 配额限制?
- 用户本地写的 skill 与服务器下发的同名 skill 冲突,默认覆盖还是并存(命名空间隔离)?
- "紧急停止"按下后,正在进行的工具调用副作用(已点出去的鼠标、已写的文件)如何回滚或提示?
- "传承思想 / 传承技能"两个 builtin 栏目变量名 vs title 对齐,选哪种命名
  (调整变量名 / 改 title / 引入新 builtin id 并平滑迁移)?
- AI 转授时,受授方 AI 的"装载请求 pending"由谁审批 — 受授 AI 的所有者用户,
  还是双方 AI 都属于同一个数字社会的核心管理员?多用户场景下的归属边界?
- 转授的能力是"复制装载"还是"引用装载"?如果原作者修订能力包,已被转授给其他 AI
  的副本是否要同步更新(可选自动 / 手动同步 / 锁定版本)?
- 沉淀 skill / tool 的创作入口:用户直接在 UI 编辑器写,还是只能从已有对话
  "另存为能力包"导出?后者更安全但灵活度低。
- 网络互联 skill / tool 的拉取走 agent 本地直连源,还是经服务器代理(缓存 +
  审核)再下发?后者带宽/合规更可控,但增加一次跳。
- AI 在转授时是否可附带"使用建议 prompt"(让受授 AI 自带一段 how-to-use 指导)?
  这等同于让 AI 影响另一个 AI 的 prompt,可能放大风险。

这些问题不阻塞 MVP,但在 v2 之前需要给出答案。
