# HeySure AI 2.0 - 对话快速上下文

本文档用于让下一次 AI 接手时快速进入状态，减少重复梳理成本。

## 1. 当前目标与状态

项目已升级为“统一 AI 卡片管理 + 卡片级配置生效 + 独立对话与 MCP 控制”架构，核心闭环已打通：

- 左侧管理员区域可直接创建 AI，并支持卡片级“设置/删除”
- 主脑、辅助管理员、执行 AI 都采用统一卡片模板展示（平台/实时状态/Token）
- 角色体系已收敛为两层：
  - 一级：`assistant_admin` / `digital_member`
  - 二级：`digital_member_role`（`manager` / `member`）
- 每个 AI 卡片支持：
  - MCP 工具查看（卡片底部悬浮区）
  - 独立对话入口（卡片底部悬浮区）
  - 卡片级独立配置入口（⚙）
- AI 运行控制已从卡片移到“AI 配置弹窗”的运行控制区（启动/停止）
- AI 配置弹窗已收敛为“配置信息”：
  - 可改：`name/ai_role/digital_member_role/platform/token_limit/workspace_root/api_key/base_url/model/prompt/mcp_tools`
  - 不改：代数、生命周期、项目名、当前行为、数据库连接等状态信息
- 聊天已按 `ai_config_id + ai_kind` 隔离，支持每个 AI 独立会话历史
- 对话种类已按角色自动映射：
  - `assistant_admin -> ai_kind=assistant`
  - `digital_member -> ai_kind=core`
- 聊天会话操作（新建/删除/切换）统一进顶部下拉框
- 聊天会话下拉已改为“任务分组视图”：同名任务会话归组（`任务: XXX · 第N代`），点击组后展开代际会话
- 会话下拉默认仅展开“普通对话”；若无普通对话，则仅展开一个任务组；分组为紫色、具体会话项为绿色
- 聊天默认会话选择策略：优先普通对话；若不存在普通对话再回落到任务会话
- 对话前置 Prompt 气泡已改为固定高度，支持在气泡内滚动查看完整内容（避免过长 Prompt 挤压消息区）
- 聊天已移除“实时思考/思考历史”独立栏目，对话历史即完整上下文
- 聊天空闲态“实时增量同步”已移除；当前策略为“每次打开 AI 对话弹窗重新加载会话与历史”
- 对话支持“后端 run 持续执行”：即使关闭弹窗或刷新页面，任务仍可继续；前端可通过 run 状态接口重连显示
- 用户对话“终止”按钮链路已修复（2026-03-24）：
  - 前端点击“终止”后会立即停止轮询并将本地状态切为 `stopped`（避免“按钮按了但界面继续转圈”）
  - 后端 `POST /api/chat/run/{run_id}/stop` 会立即将 `queued/running` 置为 `stopped`，并写入 `finished_at`
  - stop 接口会清理 run live 缓存文本，避免前端继续显示旧增量
  - worker 在线程启动前和流式循环中都会检查 `stop_requested`
- 聊天界面支持快捷修改当前 AI 的 `workspace_root` 与 `token_limit`
- MCP 调用支持实时状态广播（running/idle/error）
- MCP 卡片状态链路补齐：前端 `GodDashboard` 已订阅 `mcp:status`（`ui:join` 房间），卡片“最近MCP”可实时跳变
- MCP 调用结束后服务端不再清空 `current_mcp_tool`（`idle` 时保留最近工具名），避免卡片展示“暂无调用”抖动
- AI 卡片“实时状态”栏文案与判定已收敛：
  - 标题：`当前行为 -> 实时状态`
  - 顶部状态标签：`working` 时按实时上下文细分为 `与用户沟通中 / 工作中 / 等待中 / 空闲中`
  - 仅显示“等待中的定时任务”（`queued/paused/scheduled/next`），定时任务完成后不再显示在该块
  - `最近一次完成` 文案改为 `最近任务`
- MCP 调用支持两种解析格式（JSON 与 XML-like `<tool>/<arguments>`）
- MCP 工具提示支持参数标注（每个工具展示必填/可选参数与类型，并附调用示例）
- MCP 调用链路已新增“后端 run 自动执行模式”：前端发起后端任务后，即使关闭对话弹窗/页面，服务端仍可继续执行，直到完成或手动终止
- `GodDashboard` 已完成“页面编排 + 领域 composable + 弹窗组件”拆分（2026-03-23 二次收敛）：
  - 页面编排：`web/src/components/GodDashboard.vue`（薄编排层，主要做组合与事件转发）
  - 数据总线域：`web/src/components/god-dashboard/useDashboardData.ts`（AI/项目加载、socket、轮询刷新、项目 CRUD）
  - UI 控制域：`web/src/components/god-dashboard/useDashboardUi.ts`（菜单/筛选/指引弹窗/分组计算）
  - 系统设置域：`web/src/components/god-dashboard/useDashboardSystemSettings.ts`（系统设置同步与保存、主题/字号应用）
  - 任务域：`web/src/components/god-dashboard/useTaskManagement.ts` + `modals/TaskManagementModal.vue`
  - AI 配置域：`web/src/components/god-dashboard/useAiConfigManagement.ts` + `modals/AiConfigModal.vue`
  - MCP/目录域：`web/src/components/god-dashboard/useMcpAndWorkspaceModal.ts` + 对应 modal
  - 已移除旧的本地模拟繁衍/任务 tick 控制逻辑（`tickAgent/reproduce/taskQueue`），避免与后端真实调度链路混用
- 后端流式阶段新增 `live_phase`（`generating` / `waiting_mcp`）与 `current_tool`，前端可显示“生成中/等待MCP返回”
- 后端流式状态接口支持增量文本游标（`after`）返回 `live_delta/live_len`，前端采用增量补帧，减少跳跃感
- MCP 结果展示已内嵌到同一 AI 气泡内（固定最大高度、自动换行、可滚动）
- MCP 调用执行策略已收敛为“单次调用-等待结果-再决策”（避免多工具批量导致幻觉扩散）
- AI 配置支持 `MCP 调用无需确认` 开关（按 AI 维度保存）
- MCP/工具块执行状态与结果支持持久化恢复（刷新后尽量保持已执行态与结果展示）
- 聊天流式结束时，服务端可对 MCP 失败场景主动追加提示（格式错误/无权限/工具不存在）
- 系统全能设置已收敛：
  - 移除“能量配额”和“神经网络配置”
  - 移除“核心回应”和“上下文配置”栏目
  - MCP 配置与默认任务提示词改为互斥折叠面板（默认全部折叠）
  - 新增全局监督阈值：`default_supervision_idle_seconds`（AI 停止思考超过 N 秒后自动监督追问）
- 数字社会管理员卡片（`digital_member_role=manager`）底部操作新增“读取目录”：
  - 入口位于“查看 MCP”旁
  - 点击弹窗显示当前 AI 的目录结构 + Git Diff（不再在全局设置里展示）
- 每个 AI 可单独配置：
  - `token_limit`
  - `api_key/base_url/model/prompt`
  - `workspace_root`（工作目录，前端强制非空，默认 `.`）
  - `mcp_tools`（权限列表）
  - `mcp_auto_approve`（前端本地持久开关）
- 辅助管理员（`assistant_admin`）专项规则：
  - 无 token 上限（`token_limit=0`）
  - 卡片不显示生命周期
  - 默认全 MCP 权限 + 工作目录根（`.`）
  - 任务系统能力已放开：可通过 MCP/接口代理创建与查询任务，默认路由到可用 `digital_member`（优先 `manager`），也可显式传 `target_ai_config_id`
- 所有 AI 的 `base_url/model/prompt` 默认值已改为空，需用户自行配置
- 运行控制中的“清空当前记录 Token”按钮已从前端移除；后端接口保留（预留后续复用）
- Token 统计管理增强：
  - 撤销/删除/清空会话后，服务端会重建 token 快照，避免历史残留
- 数字生命成员的 AI 配置新增“系统自动控制”任务机制：
  - 支持任务列表（任务说明/优先级/定时触发）
  - 支持手动触发任务入队（配置页“立即触发”）
  - 调度策略支持优先级抢占：高优任务触发时可暂停低优任务并切换新会话执行
  - 被暂停任务改为“手动恢复”，不再自动恢复（防止暂停失效）
  - 若 AI 未调用 `task.complete` 标记完成，系统会自动监督追问直到完成（监督在当前代执行，不新建下一代）
  - 传承提示默认开启：当会话 token 超过 AI 配置 `token_limit` 时，本轮结束后自动提示传承（文案可配置）
- MCP 任务系统工具已拆分创建语义（推荐优先使用新工具）：
  - `task.create_immediate`：立即执行任务（不使用定时参数）
  - `task.create_scheduled`：一次性定时任务（`schedule_at` 或 `schedule_duration_minutes`）
  - `task.create_recurring`：循环定时任务（`schedule_duration_minutes` + 可选 `schedule_run_immediately`，不使用 `schedule_at`）
  - 兼容入口：`task.create`（历史混合语义保留，建议仅兼容旧提示词时使用）
  - 其他工具：`task.list` / `task.get_current` / `task.inherit` / `task.complete`
- `task.create_immediate/task.create_scheduled/task.create_recurring/task.list/task.get_current` 返回已补充定时结构化字段：`schedule_at_unix/schedule_at_local/schedule_at_utc`，用于避免 AI 口头换算时间出错
- MCP 文件读取策略收敛：
  - `workspace.read_files` 增加默认限流（`max_files=5`、`max_total_bytes=120000`、`max_single_file_bytes=50000`）
  - 新增 `workspace.read_file_by_name`（按文件名匹配后读取，默认优先精确匹配，兼容模糊）
  - 旧 `mcp_tools` 配置自动兼容 `workspace.read_file_by_name`（无需手动改历史配置）
- MCP 文件写入/编辑参数结构升级（2026-03-24）：
  - `workspace.write_file` 支持结构化参数：`target + content + options`（并兼容旧 `path/content/create/overwrite`）
  - `workspace.edit_file` 支持结构化 `edits`（`replace/set/append/prepend`）+ `options`（并兼容旧 `search/replace/create_if_missing`）
  - 新旧模式共存，建议提示词优先使用结构化模式以提高灵活性与可维护性
- `admin.list_agents` / `admin.get_overview` 已扩展为“双视角”：
  - `connected_agents`：Socket 在线且可 dispatch 的外部 Agent
  - `managed_agents`：当前用户 AI 配置运行态（便于排查“看起来没 agent”但实际有 AI 配置的情况）
- 任务列表与执行记录的状态色块已修复并统一：
  - 绿色：执行中
  - 黄色：等待执行
  - 蓝色：定时任务
  - 灰色：已完成
- 任务“删除”语义已调整为强制终止：
  - 强制停止当前 run 思考
  - 强制删除该任务相关对话消息与会话记录
  - 任务执行记录本身从数据库硬删除（不是仅标记 cancelled）
- 任务执行记录支持批量删除（前端多选 + 全选 + 批量删除）
- 任务详情支持查看完整任务并在详情内切换代际；详情页新增展示“本代 AI Prompt”
- 任务创建交互已改为“独立弹窗”：
  - 任务列表弹窗内点击“创建任务”会打开二级创建弹窗（不再内嵌折叠面板）
  - 创建弹窗字段与提交逻辑沿用原有 `taskCreateForm` / `submitTaskForAgent`
- 已完成任务支持“使用模板新建”：
  - 入口：任务执行记录中 `completed` 行旁按钮 `使用模板新建`
  - 行为：自动打开创建弹窗并回填该任务的标题/内容/优先级/定时/覆盖参数
- 数字生命成员 AI 卡片新增“任务情况”栏，展示：
  - 当前进行/等待中的定时任务
  - 最近任务
  - 每条任务独立展示“任务代数 + 任务生命周期(Token)”
- 定时任务执行时机修复（防“创建后立即执行”）：
  - 手动创建且 `schedule_enabled=true` 时，若未填写 `schedule_at`，后端自动使用 `now + duration_minutes`
  - 手动定时任务入队 `trigger_type` 改为 `schedule`（不再固定 `manual`）
  - 调度器判定兼容旧数据：若无 `schedule_at`，按 `created_at + duration_minutes` 判定到时
  - 前端提交 `schedule_at` 时优先转 Unix 秒时间戳，减少时区解析误差
- 定时任务新增“循环运行”能力：
  - 创建任务新增字段：`schedule_loop_enabled` / `schedule_run_immediately`
  - 交互规则：开启循环后禁用“定时日期”（不再设置绝对日期），可选“首次立即执行”
  - 后端任务完成路径：当定时任务在 `task.complete` 完成后，自动续建下一条同配置定时任务（下次触发时间 = `完成时间 + duration_minutes`）
- AI 卡片“思考流”展示策略已收敛：
  - 卡片仅显示当前运行实时文本（`latest_thinking` 来自 run live text），不拼接历史会话
  - 无新实时内容 5 秒后自动显示“空闲中”
  - 长文本单向滚动到底停止，不反弹；新内容到来继续滚动
  - 面板在有实时思考时会提升刷新频率（约 600ms）以减少卡顿
- 任务运行时 Prompt 增强：
  - 显示真实生效工作目录（绝对路径），不再仅显示 `.` 原始配置值
  - 新增“任务运行时 MCP 调用规则”与“调用模板（`<mcp-call>` + fenced JSON 兼容模板）”
  - 任务运行时白名单会强制注入 `task.get_current/task.complete/task.list`
- 任务死循环防护增强：
  - 重复调用白名单外同一工具达到阈值后终止 run（error）
  - 调度器在上次 run 为 `error/stopped` 时会将任务置为 `paused`，等待人工恢复
  - 自动监督轮次有上限（在当前代内重试，超过后转 `paused`）

## 2. 关键文件入口

### 前端（Vue）

- `web/src/components/GodDashboard.vue`
  - 页面级编排容器；负责组合各领域 composable 与模板事件汇聚
  - 当存在实时思考文本时刷新间隔会切到高频档（约 600ms）
- `web/src/components/god-dashboard/useDashboardData.ts`
  - `GodDashboard` 数据总线层：AI/项目加载、MCP socket 实时订阅、2s 轮询刷新、项目 CRUD
- `web/src/components/god-dashboard/useDashboardUi.ts`
  - `GodDashboard` UI 控制层：右键菜单、筛选开关、指引弹窗、卡片分组与布局计算
- `web/src/components/god-dashboard/useDashboardSystemSettings.ts`
  - `GodDashboard` 系统设置层：用户设置回填、主题/字号应用、系统设置保存
- `web/src/components/god-dashboard/useTaskManagement.ts`
  - 任务域状态与行为封装（任务列表/代际/创建/暂停恢复删除/批量删除）
  - 支持已完成任务“使用模板新建”回填创建表单
  - 支持循环定时字段：`schedule_loop_enabled/schedule_run_immediately`
- `web/src/components/god-dashboard/modals/TaskManagementModal.vue`
  - 任务管理弹窗（任务列表 + 任务详情 + 创建任务二级弹窗）
  - 创建弹窗已支持“循环运行/首次立即执行”，循环模式禁用绝对日期输入
- `web/src/components/god-dashboard/useAiConfigManagement.ts`
  - AI 配置域状态与行为封装（配置详情加载/保存/删除/MCP权限/工作目录）
- `web/src/components/god-dashboard/modals/AiConfigModal.vue`
  - AI 配置弹窗（基础配置 + 权限及系统设置）
- `web/src/components/god-dashboard/types.ts`
  - `GodDashboard` 领域共享类型定义（`Agent/User/McpToolDefinition` 等）
- `web/src/components/god-dashboard/mcpTools.ts`
  - MCP 工具中文元数据、参数类型中文化与参数行解析
- `web/src/components/god-dashboard/useMcpAndWorkspaceModal.ts`
  - MCP 工具弹窗与“读取目录”弹窗的状态管理与数据加载封装
- `web/src/components/god-dashboard/modals/McpToolsModal.vue`
  - MCP 工具说明弹窗（中文标签/说明/参数表）
- `web/src/components/god-dashboard/modals/WorkspaceContextModal.vue`
  - 目录树与 Git Diff 弹窗（含刷新/错误态/变更路径）
- `web/src/services/taskApi.ts`
  - 任务系统前端 API 封装层（任务列表/执行记录/代际详情/触发/暂停/恢复/删除）
  - `schedule_at` 支持 `number|string|null`（前端会优先传 Unix 秒时间戳）
  - `task-trigger` 载荷新增：`schedule_loop_enabled/schedule_run_immediately`
- `web/src/utils/taskSystem.ts`
  - 任务系统前端领域工具层（任务状态映射、payload 标签解析、system_auto_control 归一化）
  - `TaskCreateForm` 已扩展循环定时字段，并在 payload 标签中展示“循环运行/首次立即执行”
- `web/src/components/BrainCorePanel.vue`
  - 左侧管理员区域 AI 卡片容器（含“新建 AI”入口）
- `web/src/components/AgentCard.vue`
  - 统一 AI 卡片模板（状态 + 底部悬浮 MCP/对话 + 设置入口）
  - 状态栏标题改为“实时状态”，并细分“与用户沟通中/工作中/等待中/空闲中”
  - 数字社会管理员卡片底部操作新增“读取目录”按钮（在“查看 MCP”旁）
  - 数字生命成员卡片新增“任务情况栏”（当前进行/等待中的定时任务 + 最近任务 + 任务级代数/生命周期）
  - 思考显示改为实时流文本源（非历史拼接）；5 秒空闲回退“空闲中”；长文本单向滚动到底停止
- `web/src/components/chat/ChatInterface.vue`
  - 聊天主逻辑（按 AI 隔离会话/token，含会话下拉操作与 AI 快捷配置）
  - run 启动/轮询/终止、流式增量显示、MCP 等待态展示
  - 已移除空闲态历史增量同步；改为打开弹窗时初始化会话/历史
- `web/src/components/chat/InlineContent.vue`
  - MCP/工具块 UI（确认态、已执行态、结果滚动展示）
- `web/src/utils/chatParser.ts`
  - MCP 调用块解析（兼容 JSON 与 XML-like 两种格式）
- `web/src/components/chat/ChatHeader.vue`
  - 会话下拉（切换 + 新建 + 删除当前会话）
  - 任务分组视图（同任务名聚合；默认只展开普通对话）
- `web/src/components/SystemSettingsPanel.vue`
  - 仅系统级设置（无 AI 模型/Token 配置入口）
  - MCP 配置与默认任务提示词采用手风琴互斥折叠（默认全折叠）
  - 已移除“核心回应”“上下文配置”栏目

### 后端（FastAPI + Socket.IO）

- `server/api/app.py`
  - 启动入口，含定时扫描任务与任务调度轮询（`process_task_scheduler`）
  - 路由自动注册支持入口标记：仅注册 `IS_ROUTER_ENTRY != False` 的模块（避免拆分子模块重复挂载）
- `server/api/routers/ai.py`（聚合入口，已拆分）
  - 实际实现拆分到：
    - `server/api/routers/ai_base.py`（共享 helper + router）
    - `server/api/routers/ai_config_routes.py`（配置 CRUD / 启停 / MCP 开关）
    - `server/api/routers/ai_task_routes.py`（任务触发 / 任务队列 / 代际详情）
    - `server/api/routers/ai_misc_routes.py`（`/cards`、runtime、token、session）
  - AI 配置管理、删除、卡片聚合接口（`/api/ai/cards`）；`workspace_root` 后端兜底规范化（空值转 `.`）
  - 角色归一化：除 `assistant_admin` 外统一归并为 `digital_member`
  - 细分角色：`digital_member_role`（`manager` / `member`）
  - 新增任务手动触发接口：`POST /api/ai/configs/{config_id}/task-trigger`
  - `task-trigger` 已支持 `assistant_admin` 代理任务调度到 `digital_member`（默认自动选择，可传 `target_ai_config_id`）
  - 任务队列操作接口：`pause/resume/stop/delete` 与代际详情查询
  - 任务代际统计按“唯一 generation”聚合；同代多次监督 run 不增加代数
  - `DELETE /task-jobs/{job_id}` 为硬删除（并强制终止 run + 删除任务对话记录）
  - `/api/ai/cards` 已补充任务摘要：`task_current_or_recent` / `task_recent_completed`（含任务级代数与token生命周期）
  - 手动定时任务创建路径已修复：
    - `schedule_enabled=true` 且 `schedule_at` 为空时，自动写入 `now + duration_minutes`
    - `trigger_type` 根据定时开关在 `schedule/manual` 间切换
    - 循环定时字段已接入：`loop_enabled/run_immediately`
    - 循环 + 立即执行时首次 `schedule_at=now`
  - `/api/ai/cards` 已补充运行态字段：`user_chat_active/active_run_status/active_run_phase`
  - 保留清空 token 接口：`/api/ai/configs/{config_id}/clear-tokens`（当前 UI 未暴露）
- `server/api/task_system.py`
  - 任务系统后端公共封装层：`system_auto_control` 归一化、任务 payload 解析、任务 active run 判定、代际编号解析
  - `extract_task_payload` 已支持 `schedule_loop_enabled/schedule_run_immediately`
  - MCP 白名单兼容工具：`with_task_create_compat` / `with_workspace_read_by_name_compat`
  - `with_task_create_compat` 会自动补齐 `task.create_immediate/task.create_scheduled/task.create_recurring/task.create` 创建工具组（兼容历史配置）
- `server/api/routers/chat.py`（聚合入口，已拆分）
  - 实际实现拆分到：
    - `server/api/routers/chat_base.py`（共享状态与常量）
    - `server/api/routers/chat_prompt_utils.py`（MCP 解析/提示与 run live 状态工具）
    - `server/api/routers/chat_persistence.py`（消息/会话/token 快照持久化）
    - `server/api/routers/chat_runtime_helpers.py`（AI 运行时解析与任务运行辅助）
    - `server/api/routers/chat_scheduler.py`（任务调度与 `_start_task_run`）
    - `server/api/routers/chat_worker.py`（后台 run worker）
    - `server/api/routers/chat_history_routes.py`、`chat_action_routes.py`（路由实现）
  - 聊天保存/查询/会话管理；后端 run 执行编排、流式状态输出、MCP 等待控制
  - 新增任务调度内核（定时入队、优先级抢占、手动恢复、监督追问）
  - 监督追问在当前代会话内执行：复用 `session_task_<job_id>_gN`，不创建 `gN+1`
  - 任务下发消息已精简为核心字段（任务ID/代际/标题/优先级/要求/完成动作），避免提示冗长
  - `assistant/core` 两种 `ai_kind` 均走 `AssistantAIConfig` 配置（不再回退 user.admin_*）
  - 任务运行时系统 Prompt 注入：绝对工作目录 + MCP 调用规则 + 白名单 + 调用模板
  - MCP 调用解析支持 `<mcp-call>` 与 fenced JSON 双格式
  - 任务防循环：白名单外重复调用熔断、错误 run 自动暂停、防止监督轮次无限增长
  - 任务调度器时间判定已兼容旧任务 payload：无 `schedule_at` 时使用 `created_at + duration_minutes`
  - 在 `task.complete` 完成分支中，循环定时任务会自动续建下一条 `queued/schedule` 任务
  - MCP 失败兜底提示拼接；会话变更后 token 快照重建
  - MCP 白名单解析已兼容任务创建工具组（`task.create_immediate/task.create_scheduled/task.create_recurring/task.create`）与 `workspace.read_file_by_name`（历史 `mcp_tools` 配置可直接使用）
  - run 终止链路已收敛：
    - `chat_action_routes.stop_chat_run` 会立即落库 `stopped` 并清理 live 缓存
    - `chat_worker._run_worker` 在线程启动前会先检查 `stop_requested`
- `server/api/routers/mcp.py`
  - MCP 工具调用入口（含任务创建工具组与 `workspace.read_file_by_name` 的历史白名单兼容）
- `server/api/mcp.py`（聚合入口，已拆分）
  - 实际实现拆分到：
    - `server/api/mcp_core.py`（registry 核心、状态广播、工作目录解析）
    - `server/api/mcp_workspace_tools.py`（workspace/admin 工具）
    - `server/api/mcp_project_tools.py`（project 工具）
    - `server/api/mcp_task_tools.py`（task 工具、定时参数校验）
    - `server/api/mcp_registry_setup.py`（工具注册表）
  - MCP 工具注册与调用逻辑、状态广播、按 `ai_config_id` 解析工作目录
  - MCP 调用结束进入 `idle` 时保留最近工具名（供卡片“最近MCP”展示）
  - 新增任务工具：`task.create_immediate` / `task.create_scheduled` / `task.create_recurring` / `task.create(兼容)` / `task.list` / `task.get_current` / `task.inherit` / `task.complete`
  - 定时参数强校验入口：`_parse_schedule_at_strict` / `_task_create_impl`（无时区时间会拒绝）
  - 任务创建三分语义：
    - `task.create_immediate`：仅立即执行语义
    - `task.create_scheduled`：一次性定时语义（支持 `schedule_at`）
    - `task.create_recurring`：循环语义（不使用 `schedule_at`，用 `schedule_duration_minutes`）
  - 规则约束：
    - `task.create_scheduled`：`schedule_at` 与 `schedule_duration_minutes` 必须二选一
    - `task.create_recurring`：禁止传 `schedule_at`
  - 三类创建工具均支持 `assistant_admin` 代理投递（自动/显式目标）
  - `task.create_immediate/task.create_scheduled/task.create_recurring/task.list/task.get_current` 返回定时结构化字段（`schedule_at_unix/local/utc`）
  - `workspace.get_file_tree` 支持按 `path` 或 `name`（目录名检索）获取目标目录树
  - `workspace.read_files` 已加读取限流；新增 `workspace.read_file_by_name` 以降低一次性上下文 token
- `server/api/socket_events.py`
  - Socket 事件（含 `ui:join` 房间订阅）
- `server/api/ai_service.py`
  - 默认 AI 初始化（主脑/辅助管理员/执行AI）、开关文件同步、定时扫描逻辑
  - 默认种子角色：主脑为 `digital_member + manager`；执行AI为 `digital_member + member`
- `server/api/models.py`
  - 数据模型定义（AI 扩展字段、会话、token 分段、运行态）
  - `AssistantAIConfig` 新增 `digital_member_role`
  - 新增 `ChatRun`（会话级后台运行任务：状态、终止标记、错误信息）
- `server/api/database.py`
  - 建表与轻量迁移（含 AI 扩展字段迁移）
  - 旧角色数据迁移：`admin/worker -> digital_member`，并补齐 `digital_member_role`

## 3. 新增/重要数据模型

- `AssistantAIConfig`
  - 每用户多条 AI 配置（`assistant_admin` / `digital_member`）
  - 关键字段：`ai_role/digital_member_role/platform/generation/token_limit/lifecycle_status/current_behavior`
  - 权限与资源字段：`mcp_tools/workspace_root/database_uri`
  - 新增自动控制字段：`system_auto_control`（任务调度配置）/ `auto_last_trigger_at`
- `ChatSession`
  - 会话实体，避免仅依赖 `ChatMessage` 推导
- `TokenUsageSnapshot`
  - 分段 token 累计（`bucket=YYYY-MM-DD`）
- `AIRuntimeStatus`
  - 运行态、MCP 开关、当前工具状态
- `ChatMessage`（已扩展）
  - `ai_config_id`
  - `ai_kind`（`assistant` / `core`）
- `ChatRun`
  - 会话级后台任务：`queued/running/completed/error/stopped`
  - 支持 `stop_requested`（手动终止）与错误信息回传
- `AITaskJob`
  - 数字生命成员任务队列实体（`queued/running/paused/completed`）
  - 支持优先级、任务会话绑定、监督次数、最近运行信息、任务级 payload 覆盖参数

## 4. 关键接口速查

### AI 管理

- `GET /api/ai/configs`
- `POST /api/ai/configs`
- `PUT /api/ai/configs/{config_id}`
- `DELETE /api/ai/configs/{config_id}`
- `POST /api/ai/configs/{config_id}/toggle-run`
- `POST /api/ai/configs/{config_id}/toggle-mcp`
- `POST /api/ai/configs/{config_id}/clear-tokens`
- `GET /api/ai/cards`
- `GET /api/ai/runtime-status`
- `GET /api/ai/token-snapshots`
- `GET /api/ai/configs/{config_id}/task-list`
- `GET /api/ai/configs/{config_id}/task-jobs`
- `GET /api/ai/configs/{config_id}/task-jobs/{job_id}/generations`
- `POST /api/ai/configs/{config_id}/task-jobs/{job_id}/pause`
- `POST /api/ai/configs/{config_id}/task-jobs/{job_id}/resume`
- `POST /api/ai/configs/{config_id}/task-jobs/{job_id}/stop`
- `DELETE /api/ai/configs/{config_id}/task-jobs/{job_id}`

### 会话与聊天

- `GET /api/chat/sessions?ai_kind=assistant&ai_config_id=...`
- `POST /api/chat/sessions`
- `DELETE /api/chat/sessions/{session_id}?ai_kind=...&ai_config_id=...`
- `GET /api/chat/history?...`
  - 支持 `after_id` 增量拉取（用于轮询后端运行中的新消息）
- `GET /api/chat/total-tokens?...`
- `POST /api/chat/stream`（body: `messages + ai_config_id + ai_kind`）
  - `ai_kind` 使用约定：辅助管理员 `assistant`，数字生命成员 `core`
- `PATCH /api/chat/{msg_id}/tags`（用于消息级 MCP/工具块状态持久化）
- `POST /api/chat/run/start`（启动后端对话运行）
- `GET /api/chat/run/status/{run_id}`（查询运行状态，支持 `after` 返回 `live_delta/live_len`）
- `GET /api/chat/run/active?...`（查询当前会话是否存在进行中 run）
- `POST /api/chat/run/{run_id}/stop`（手动终止 run）
  - 语义：立即停止（`queued/running -> stopped`），并清理 live 文本缓存

### MCP

- `GET /api/mcp/tools`
- `POST /api/mcp/call`
  - 支持 `ai_config_id`
  - 会校验启停与 MCP 开关
  - 工具执行根目录按该 AI 的 `workspace_root` 解析
- `workspace.get_file_tree`（通过 MCP tools 暴露）
  - 可按 `path` 获取指定目录树
  - 可按 `name` 检索目录名并返回匹配路径列表与目标目录树
- `workspace.read_files`
  - 支持按相对 `paths` 批量读取对应文件内容
  - 默认读取限流：`max_files=5`、`max_total_bytes=120000`、`max_single_file_bytes=50000`（可在参数内显式覆盖）
  - 若传目录会返回错误（避免“把整个目录当文件读”）
- `workspace.read_file_by_name`
  - 按 `name/names` 检索文件并读取（支持 `allow_partial/case_sensitive/max_matches/read_all_matches`）
  - 读取阶段复用 `workspace.read_files` 的同一限流策略
- 任务系统 MCP：
  - `task.create_immediate`（创建立即执行任务；`assistant_admin` 可代理到 `digital_member`，支持 `target_ai_config_id`）
  - `task.create_scheduled`（创建一次性定时任务；`schedule_at` 与 `schedule_duration_minutes` 二选一；`schedule_at` 仅支持 Unix 秒或带时区 ISO-8601）
  - `task.create_recurring`（创建循环定时任务；仅用 `schedule_duration_minutes` + 可选 `schedule_run_immediately`；不要传 `schedule_at`）
  - `task.create`（兼容旧调用，混合语义入口，建议新提示词避免使用）
  - `task.list`（查看任务队列）
  - `task.get_current`（获取当前任务）
  - `task.inherit`（提交传承摘要）
  - `task.complete`（任务完成标记）
  - `task.create_immediate/task.create_scheduled/task.create_recurring/task.list/task.get_current` 返回包含 `schedule_at_unix/schedule_at_local/schedule_at_utc` 的定时结构，建议优先使用这些字段对外展示时间

## 5. 配置文件开关机制

- 开关文件位置：
  - `server/data/workspace/<user_id>/SystemSetting/ai_switches.json`
- 写入来源：
  - AI 配置弹窗的启动/停止操作与 MCP 开关操作（后端接口仍保留）
- 读取来源：
  - 服务端 `app.py` 的定时任务每 3 秒扫描并同步 DB 状态

## 6. 目前未完全落地（下一步建议）

- 已完成“卡片配置生效 + 工作目录隔离 + 删除/创建闭环 + MCP 可视化执行闭环”，但仍有可继续完善点：
  - 任务执行记录已支持批量删除，但当前为逐条请求删除；可升级为后端批量删除接口减少请求开销
  - 任务调度防循环目前采用阈值策略（重复违规调用、监督轮次上限）；可升级为更细粒度异常策略（重复输出检测、错误分类回退）
  - MCP 执行状态当前主要持久化在消息 `tags`，可升级为独立状态表（`message_id + block_signature`）以提升可靠性
  - 聊天上下文文件树与文件选择仍偏全局视角，可进一步按当前对话 AI 的 `workspace_root` 动态过滤
  - run 的 live 状态目前为进程内内存缓存；若服务重启将丢失进行中流式片段，可升级为持久化任务队列/状态存储
  - 生命周期状态目前主要由配置与展示驱动，自动化策略引擎（调度/繁衍）可继续演进

## 7. 本地验证命令

- 后端语法检查：
  - `python -m compileall server/api`
- 前端类型检查：
  - `cd web && npx vue-tsc --noEmit`

## 8. 任务监督与代际（下次修改前先看）

### 8.1 硬约束（不要改反）

- 监督触发（`trigger_type=supervision`）必须在当前代执行，不得新开代。
- 只有 `manual/schedule/preempt/resume` 这类“开始新任务轮次”的触发才允许创建新代。
- `generation_count` 必须表示“唯一代数数量”，不是 run 数量。
- 代际详情接口中，同一代若有多次监督 run，只展示该代最新 run 作为该代入口。
- 多任务场景下，系统提示会直接下发目标任务；`task.get_current` 仅作可选核对工具（如调用建议带 `job_id`）。

### 8.2 核心代码入口

- `server/api/routers/chat_scheduler.py`
  - `_start_task_run`：决定是否新建代，监督逻辑在这里卡住。
  - `process_task_scheduler`：无 active run 时触发 supervision run 的调度入口。
- `server/api/routers/ai_task_routes.py`
  - `get_ai_task_jobs`：执行记录列表里的 `generation_count/latest_generation` 计算。
  - `get_task_job_generations`：代际详情聚合逻辑（同代去重）。
- `server/api/task_system.py`
  - `parse_generation_from_session_id`：代号解析工具，避免各处重复写正则。

### 8.3 最小回归检查（每次改完都跑一遍）

1. 手动触发任务，首次运行后应是 `session_task_<job_id>_g1`。
2. 故意不调用 `task.complete`，等待自动监督触发。
3. 预期：新 run 仍在 `g1` 会话内，`generation_count` 仍为 `1`，而不是变成 `2`。
4. 调用 `task.complete` 后，任务应转为 `completed`，不再被监督追问。
5. 连续监督超过阈值后，任务应转为 `paused`（等待人工恢复）。

## 9. 2026-03-24 快速定位索引（高频改动）

### 9.0 配置改动最快路径（拆分后）

- 改“上帝面板主控制逻辑（数据刷新/socket/项目 CRUD）”：
  - 先看：`web/src/components/god-dashboard/useDashboardData.ts`
  - 页面编排与事件绑定看：`web/src/components/GodDashboard.vue`
- 改“上帝面板 UI 行为（右键菜单/筛选/指引弹窗/分组显示）”：
  - 先看：`web/src/components/god-dashboard/useDashboardUi.ts`
  - UI 看：`web/src/components/GodDashboard.vue`
- 改“AI 配置弹窗字段/保存逻辑/工作目录权限”：
  - 先看：`web/src/components/god-dashboard/useAiConfigManagement.ts`
  - 再看 UI：`web/src/components/god-dashboard/modals/AiConfigModal.vue`
- 改“任务管理弹窗/任务动作（创建、暂停、恢复、删除、批量删除）”：
  - 先看：`web/src/components/god-dashboard/useTaskManagement.ts`
  - 再看 UI：`web/src/components/god-dashboard/modals/TaskManagementModal.vue`
  - API 细节看：`web/src/services/taskApi.ts`
  - 本轮新增：创建任务已改为二级弹窗，入口仍在任务列表弹窗标题栏
- 改“全局系统设置（MCP 规范、默认任务提示词、主题字号）”：
  - 先看：`web/src/components/god-dashboard/useDashboardSystemSettings.ts`
  - UI 看：`web/src/components/SystemSettingsPanel.vue`
  - 页面挂载点看：`web/src/components/GodDashboard.vue`

### 9.1 AI 卡片 MCP 状态不同步

- 先看：`web/src/components/god-dashboard/useDashboardData.ts`
  - 关键词：`mcp:status` / `connectDashboardSocket` / `applyMcpStatusLive` / `rememberLatestRuntimeTool`
- 页面集成与生命周期看：`web/src/components/GodDashboard.vue`
- 再看：`server/api/mcp_core.py`
  - 关键词：`_set_runtime_status(... "idle", tool.name)`（结束时保留最近工具）

### 9.2 聊天窗口刷新策略（非空闲实时同步）

- 先看：`web/src/components/GodDashboard.vue`
  - 对话弹窗挂载方式：`v-if="chatTarget && chatModalOpen"`（每次打开重新挂载）
- 再看：`web/src/components/chat/ChatInterface.vue`
  - 关键词：`initializeSessions` / `onMounted`
  - 已移除空闲态轮询同步，当前是“打开即刷新”

### 9.3 会话下拉分组（任务归组）

- 先看：`web/src/components/chat/ChatHeader.vue`
  - 关键词：`parseTaskSessionName` / `taskSessionGroups` / `applyDefaultExpansion`
  - 默认展开：普通对话；无普通对话则展开一个任务组
- 再看：`web/src/components/chat/ChatInterface.vue`
  - 关键词：`pickPreferredSessionId`
  - 默认会话选择：优先普通对话，不存在再选任务会话

### 9.4 数字成员卡片“任务情况栏”

- 先看：`server/api/routers/ai_misc_routes.py`
  - `/api/ai/cards` 任务摘要字段：
    - `task_current_or_recent`
    - `task_recent_completed`
  - 字段包含：任务状态、任务代数、任务 token 生命周期
- 再看：`web/src/components/god-dashboard/useDashboardData.ts`
  - 关键词：`parseTaskSnapshot` / `taskCurrentOrRecent` / `taskRecentCompleted`
- 最后看：`web/src/components/AgentCard.vue`
  - 关键词：`实时状态` / `与用户沟通中` / `isRealtimeWorking` / `scheduledTaskSnapshot`

### 9.5 全局设置与目录上下文入口

- 全局设置折叠结构：
  - 看：`web/src/components/SystemSettingsPanel.vue`
  - 关键词：`activeConfigSection` / `toggleConfigSection` / `MCP 配置` / `默认任务提示词`
- AI 配置弹窗（字段、保存、工作目录、MCP 权限）：
  - 先看：`web/src/components/god-dashboard/useAiConfigManagement.ts`
  - UI 看：`web/src/components/god-dashboard/modals/AiConfigModal.vue`
- 读取目录弹窗（按 AI 配置隔离）：
  - 先看：`web/src/components/god-dashboard/useMcpAndWorkspaceModal.ts`
  - 关键词：`openAgentWorkspaceContext` / `loadAgentWorkspaceContext` / `workspace.get_file_tree` / `workspace.git_diff`
  - UI 看：`web/src/components/god-dashboard/modals/WorkspaceContextModal.vue`
  - 入口按钮看：`web/src/components/AgentCard.vue`（关键词：`读取目录`）
- MCP 工具说明弹窗：
  - 先看：`web/src/components/god-dashboard/mcpTools.ts`
  - UI 看：`web/src/components/god-dashboard/modals/McpToolsModal.vue`
- 监督超时阈值全局配置：
  - 看：`server/api/models.py`（`default_supervision_idle_seconds`）
  - 看：`server/api/routers/chat_scheduler.py`（`process_task_scheduler` 内监督触发间隔）

### 9.6 定时任务立即执行排查（高优先级）

- 先看：`server/api/routers/ai_task_routes.py`
  - 关键词：`trigger_ai_task` / `schedule_cfg` / `schedule_at` / `loop_enabled` / `run_immediately` / `trigger_type`
  - 关键规则：定时任务创建时若缺 `schedule_at`，自动回填 `now + duration_minutes`
  - 循环 + 立即执行：首次 `schedule_at=now`
- 再看：`server/api/routers/chat_scheduler.py`
  - 关键词：`process_task_scheduler` / `_is_job_time_ready` / `_create_loop_scheduled_job`
  - 关键规则：若 payload 缺 `schedule_at`，按 `created_at + duration_minutes` 判断是否到时
  - 循环续建触发点：`task.complete` 分支
- 前端提交链路看：
  - `web/src/components/god-dashboard/useTaskManagement.ts`
  - 关键词：`normalizedScheduleAt` / `schedule_loop_enabled` / `schedule_run_immediately`
  - 关键交互：循环模式禁用“定时日期”，并可选“首次立即执行”
  - `web/src/services/taskApi.ts`：`schedule_at` 类型为 `number|string|null`

### 9.7 已完成任务复用创建（高频）

- 入口按钮：
  - `web/src/components/god-dashboard/modals/TaskManagementModal.vue`
  - 关键词：`使用模板新建` / `onReuseTaskTemplate`
- 回填逻辑：
  - `web/src/components/god-dashboard/useTaskManagement.ts`
  - 关键词：`buildTaskCreateFormFromJob` / `openTaskCreatePanelFromJob`
- 页面接线：
  - `web/src/components/GodDashboard.vue`
  - 关键词：`on-reuse-task-template`

### 9.8 AI 卡片思考流卡顿/不连贯排查

- 刷新频率与调度：
  - `web/src/components/GodDashboard.vue`
  - 关键词：`DASHBOARD_REFRESH_STREAM_MS` / `hasLiveThinking` / `getDashboardRefreshInterval`
- 卡片内容与滚动：
  - `web/src/components/AgentCard.vue`
  - 关键词：`IDLE_THINKING_TEXT` / `syncThinkingFromLive` / `scheduleIdleThinking` / `startThinkingMotion`
- 后端数据来源：
  - `server/api/routers/ai_misc_routes.py`
  - 关键词：`latest_thinking`（来自 run live text，而非会话历史拼接）

### 9.9 MCP 任务与读文件（本轮新增）

- `assistant_admin` 创建任务报 `Only digital_member supports task scheduler`：
  - 先看：`server/api/mcp_task_tools.py`
  - 关键词：`_resolve_task_runtime_owner` / `target_ai_config_id`
  - 关键规则：默认自动路由到可用 `digital_member`（优先 `manager`），也可显式指定目标 AI
- 定时任务“口头时间”和真实执行时间不一致：
  - 先看：`task.create_scheduled/task.create_recurring/task.list/task.get_current` 返回里的 `schedule.schedule_at_local/utc/unix`
  - 不要让模型自行换算时区，优先直接引用结构化时间字段
- 任务创建 MCP 参数混淆（定时 vs 循环）：
  - 优先使用三分工具，不要用 `task.create` 混合语义
  - `task.create_scheduled`：`schedule_at` 与 `schedule_duration_minutes` 二选一
  - `task.create_scheduled.schedule_at`：仅允许 Unix 秒或带时区 ISO-8601（必须包含 `+08:00` 或 `Z`）
  - `task.create_recurring`：不要传 `schedule_at`，仅用 `schedule_duration_minutes`，可选 `schedule_run_immediately`
- MCP 读文件 token 过大：
  - 先看：`server/api/mcp_workspace_tools.py`
  - 关键词：`_read_files` / `max_files` / `max_total_bytes` / `max_single_file_bytes` / `_read_file_by_name`
  - 建议优先走 `workspace.read_file_by_name` 按名称精准读取，避免目录级批量拉取
- MCP 写文件/编辑文件结构化模式（本轮新增）：
  - 先看：`server/api/mcp_workspace_tools.py`
  - 关键词：`_extract_write_request` / `_extract_edit_operations` / `_apply_edit_operation`
  - 写文件推荐参数：`target.path` + `content.text` + `options(create/overwrite/create_dirs/if_exists)`
  - 编辑文件推荐参数：`target.path` + `edits[]` + `options(create_if_missing/create_content)`
  - 兼容性：旧 `path/search/replace/create_if_missing` 继续可用，前端旧链路无需改动

### 9.10 配置快改 SOP（定时任务）

- 场景 1：改定时任务时间格式规则
  - 后端主入口：`server/api/mcp_task_tools.py`
  - 先看函数：`_parse_schedule_at_strict` / `_task_create_impl` / `_enforce_task_schedule_mode`
  - 同步提示：`server/api/routers/chat_prompt_utils.py` 的 `_render_mcp_tool_item`（示例）与 `server/api/routers/chat_runtime_helpers.py` 的 `_build_task_mcp_rules`（运行时规则）
- 场景 2：改管理端任务创建表单与提交
  - 前端表单：`web/src/components/god-dashboard/useTaskManagement.ts`
  - 前端请求：`web/src/services/taskApi.ts`
  - 后端接口：`server/api/routers/ai_task_routes.py` 的 `trigger_ai_task`
- 场景 3：排查“时间看起来不对”
  - 不看口头描述，优先看结构化字段：
    - `schedule.schedule_at_unix`
    - `schedule.schedule_at_local`
    - `schedule.schedule_at_utc`
  - 接口来源：`task.create_scheduled/task.create_recurring/task.list/task.get_current`

- MCP 调用示例（推荐直接复用）
  - 一次性定时（绝对时间，带时区）：
    `{"tool":"task.create_scheduled","arguments":{"title":"晚间巡检","instruction":"执行巡检并汇总异常","schedule_at":"2026-03-24T21:30:00+08:00"}}`
  - 一次性定时（相对分钟）：
    `{"tool":"task.create_scheduled","arguments":{"title":"两小时后检查构建","instruction":"检查CI并更新记录","schedule_duration_minutes":120}}`
  - 循环任务：
    `{"tool":"task.create_recurring","arguments":{"title":"每30分钟检查CI","instruction":"失败时记录摘要","schedule_duration_minutes":30,"schedule_run_immediately":true}}`

- 禁止/高风险输入（会导致错乱或被拒绝）
  - `schedule_at: "2026-03-24 21:30:00"`（无时区）
  - `task.create_scheduled` 同时传 `schedule_at` + `schedule_duration_minutes`
  - `task.create_recurring` 传 `schedule_at`

- 每次改完最小回归（3 条）
  - `task.create_scheduled` 传无时区时间，应返回 400
  - `task.create_scheduled` 传带时区 ISO，`schedule_at_unix/local/utc` 三字段应一致可对照
  - `task.create_recurring` 传 `schedule_at`，应返回 400

### 9.11 用户对话“终止按钮无效”排查（本轮新增）

- 先看前端：
  - `web/src/components/chat/ChatInterface.vue`
  - 关键词：`stopCurrentRun` / `stopRunPolling` / `currentRunStatus='stopped'` / `clearLiveAssistantView`
- 再看后端 stop 接口：
  - `server/api/routers/chat_action_routes.py`
  - 关键词：`@router.post(\"/run/{run_id}/stop\")` / `row.status = \"stopped\"` / `finished_at` / `_clear_run_live_text`
- 再看后端 worker：
  - `server/api/routers/chat_worker.py`
  - 关键词：`_run_should_stop(run_id)`（线程启动前 + stream 循环内）
- 最小回归检查（终止链路）：
  1. 发送消息后 run 进入 `queued/running`，点击“终止”
  2. 预期：按钮点击后前端立即不再显示“后端流式生成中”
  3. `GET /api/chat/run/status/{run_id}` 返回 `status=stopped`
  4. 不应继续产生新的 live 增量文本

---

维护建议：每次完成较大结构改动后，更新本文件的“当前目标与状态 / 未完全落地”两节，保持接手成本最低。
