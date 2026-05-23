import type { McpToolDefinition, McpToolParamRow } from './types'

export interface McpToolGroup {
  tag: string
  tools: string[]
}

export interface McpToolSourceGroup {
  source: 'server' | 'desktop' | 'browser'
  title: string
  groups: McpToolGroup[]
  tools: string[]
}

export const DESKTOP_AGENT_MCP_TOOLS = [
  'fs.list',
  'fs.read',
  'fs.write',
  'shell.run',
  'git.diff',
  'keyboard.type',
  'keyboard.press',
  'mouse.move',
  'mouse.click',
  'mouse.double_click',
  'mouse.right_click',
  'mouse.scroll',
  'mouse.drag',
  'screen.capture',
  'screen.capture_region',
  'screen.info',
  'clipboard.get',
  'clipboard.set',
  'window.list',
  'window.focus',
  'window.close',
  'process.list',
  'process.kill',
]

export const BROWSER_AGENT_MCP_TOOLS = [
  'browser_navigate',
  'browser_screenshot',
  'browser_click',
  'browser_type',
  'browser_get_content',
  'browser_search',
  'browser_scroll',
  'browser_wait',
  'browser_evaluate',
  'browser_extract',
  'browser_find_text',
  'browser_fill_form',
  'browser_select',
  'browser_tab_list',
  'browser_tab_open',
  'browser_tab_close',
  'browser_history_back',
  'browser_history_forward',
  'browser_clipboard_write',
  'browser_storage_get',
  'browser_hover',
  'browser_page_info',
  'browser_right_click',
  'browser_double_click',
  'browser_drag',
  'browser_press_key',
  'card_list',
  'card_get',
  'card_save',
  'card_update_step',
  'card_run',
  'card_delete',
]

export const ENDPOINT_AGENT_MCP_TOOLS = [
  ...DESKTOP_AGENT_MCP_TOOLS,
  ...BROWSER_AGENT_MCP_TOOLS,
]

export const MCP_TOOL_ZH_META: Record<string, { label: string; description: string; tag: string }> = {
  'workspace.list_files': { label: '列出文件', description: '查看当前工作目录下可访问的文件与目录。', tag: '工作区' },
  'workspace.get_file_tree': { label: '目录树', description: '获取目录树结构，便于快速理解工程层级。', tag: '工作区' },
  'workspace.read_files': { label: '读取文件', description: '按路径批量读取文件内容。', tag: '工作区' },
  'workspace.write_file': { label: '写入文件', description: '支持结构化参数（target/content/options）与兼容旧字段的文件写入。', tag: '工作区' },
  'workspace.edit_file': { label: '编辑文件', description: '支持结构化 edits（replace/set/append/prepend）并兼容旧 search/replace。', tag: '工作区' },
  'workspace.delete_path': { label: '删除路径', description: '删除指定文件或目录，请谨慎操作。', tag: '工作区' },
  'workspace.run_command': { label: '执行命令', description: '在工作目录中执行终端命令。', tag: '工作区' },
  'workspace.git_diff': { label: 'Git 变更', description: '查看当前工作目录的 Git 差异。', tag: '工作区' },
  'admin.list_agents': { label: '列出智能体', description: '查看系统中的 AI 成员列表。', tag: '管理' },
  'admin.get_overview': { label: '管理总览', description: '获取系统运行状态与关键统计。', tag: '管理' },
  'admin.dispatch_flow': { label: '分派流程', description: '向指定 AI 下发流程或任务。', tag: '管理' },
  'admin.dispatch_task': { label: '分派端侧任务', description: '通过已连接的端侧 Agent 执行任务；具体目标由桌面端 MCP 或浏览器 MCP 来源决定。', tag: '管理' },
  'project.list_projects': { label: '项目列表', description: '查看当前用户下的项目信息。', tag: '项目' },
  'project.create_project': { label: '创建项目', description: '创建新的项目记录。', tag: '项目' },
  'project.update_project': { label: '更新项目', description: '更新项目信息与成员绑定。', tag: '项目' },
  'project.delete_project': { label: '删除项目', description: '删除项目记录，请谨慎操作。', tag: '项目' },
  'task.create_immediate': { label: '创建即时任务', description: '立即执行任务；不使用任何定时参数。核心参数：title、instruction。', tag: '任务' },
  'task.create_scheduled': { label: '创建定时任务', description: '一次性定时任务；使用 schedule_at 或 schedule_duration_minutes（二选一）。', tag: '任务' },
  'task.create_recurring': { label: '创建循环任务', description: '循环任务；使用 schedule_duration_minutes 作为间隔，可选 schedule_run_immediately 首次立即执行。', tag: '任务' },
  'task.create': { label: '创建任务(兼容)', description: '兼容入口，建议优先使用上面三类创建工具。', tag: '任务' },
  'task.list': { label: '任务队列', description: '查看当前 AI 的任务队列情况。', tag: '任务' },
  'task.get_current': { label: '当前任务', description: '读取当前执行中的任务详情。', tag: '任务' },
  'task.inherit': { label: '提交传承', description: '提交任务传承摘要与上下文。', tag: '任务' },
  'task.complete': { label: '标记完成', description: '将当前任务标记为完成。', tag: '任务' },
  'task.wait_all': { label: '等待子任务', description: '阻塞等待指定子任务全部完成或超时后返回各自结果摘要，常用于并行编排。', tag: '任务' },
  'prompt.list_targets': { label: 'Prompt 目标', description: '列出当前 AI 基础 prompt 目标与全局/系统 prompt 模板键。', tag: 'Prompt' },
  'prompt.read_ai': { label: '读取 AI Prompt', description: '读取指定 AI 实际使用的基础 prompt；未指定时读取当前 AI。', tag: 'Prompt' },
  'prompt.write_ai': { label: '修改 AI Prompt', description: '按行修改指定 AI 的 prompt；整段覆盖必须显式使用 replace_all。', tag: 'Prompt' },
  'prompt.read_system': { label: '读取系统 Prompt', description: '读取全局注入模板/旧版兜底 prompt；当前 AI 基础 prompt 请用读取 AI Prompt。', tag: 'Prompt' },
  'prompt.write_system': { label: '修改系统 Prompt', description: '按行修改全局注入模板/旧版兜底 prompt；整段覆盖必须显式使用 replace_all。', tag: 'Prompt' },
  'feishu.send_message': { label: '飞书发消息', description: '通过与该 AI 绑定的飞书机器人发送文本消息。', tag: '飞书' },
  'memory.write': { label: '写入记忆', description: '沉淀高价值的结构化记忆（事实/决策/经验/待办/风险/模板）供后续检索。', tag: '记忆' },
  'memory.search': { label: '检索记忆', description: '按关键词、类型、项目或标签搜索已存储的记忆。', tag: '记忆' },
  'memory.list': { label: '记忆列表', description: '列出已存储的记忆，可按类型/项目过滤。', tag: '记忆' },
  'memory.update': { label: '更新记忆', description: '更新已有记忆的内容/标签/类型/置信度。', tag: '记忆' },
  'memory.archive': { label: '归档记忆', description: '归档（软删除）记忆，使其默认检索时不再出现。', tag: '记忆' },
  'evolution.input': { label: '提交进化建议', description: '提交对提示词/工具/流程的改进建议，交由核心管理者评审。', tag: '进化' },
  'evolution.list': { label: '进化建议列表', description: '列出已提交的进化建议，可按评审状态过滤。', tag: '进化' },
  'evolution.review': { label: '评审进化建议', description: '评审进化建议：接受/拒绝/应用（核心管理者）。', tag: '进化' },
  'human.ask': { label: '询问人类', description: '暂停当前任务并向人类提问（确认/选择/文本），阻塞直至回答或超时。', tag: '协作' },
}

export const normalizeMcpSchemaType = (rawType: unknown) => {
  const toZh = (text: string) => {
    const mapped = text
      .split('|')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        if (part === 'string') return '文本'
        if (part === 'number') return '数字'
        if (part === 'integer') return '整数'
        if (part === 'boolean') return '布尔'
        if (part === 'array') return '数组'
        if (part === 'object') return '对象'
        if (part === 'null') return '空'
        if (part === 'any') return '任意'
        return part
      })
    return mapped.join(' | ') || '任意'
  }

  if (Array.isArray(rawType)) {
    return toZh(rawType.map(item => String(item || '').trim()).filter(Boolean).join(' | ') || 'any')
  }
  const text = String(rawType || '').trim()
  return toZh(text || 'any')
}

const MCP_TOOL_TAG_ORDER = ['工作区', '管理', '桌面端MCP', '浏览器MCP', '项目', '任务', 'Prompt', '飞书', '记忆', '进化', '协作', '通用']

const hasMcpPrefix = (name: string, prefix: string) => name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}_`)

const getMcpToolFallbackTag = (name: string) => {
  if (hasMcpPrefix(name, 'workspace')) return '工作区'
  if (hasMcpPrefix(name, 'admin')) return '管理'
  if (hasMcpPrefix(name, 'browser')) return '浏览器MCP'
  if (hasMcpPrefix(name, 'card')) return '浏览器MCP'
  if (hasMcpPrefix(name, 'desktop')) return '桌面端MCP'
  if (['fs', 'shell', 'git', 'keyboard', 'mouse', 'screen', 'clipboard', 'window', 'process'].some(prefix => hasMcpPrefix(name, prefix))) return '桌面端MCP'
  if (hasMcpPrefix(name, 'project')) return '项目'
  if (hasMcpPrefix(name, 'task')) return '任务'
  if (hasMcpPrefix(name, 'prompt')) return 'Prompt'
  if (hasMcpPrefix(name, 'memory')) return '记忆'
  if (hasMcpPrefix(name, 'evolution')) return '进化'
  if (hasMcpPrefix(name, 'feishu')) return '飞书'
  if (hasMcpPrefix(name, 'human')) return '协作'
  return '通用'
}

const getSourceTag = (source?: McpToolDefinition['mcpSource']) => {
  if (source === 'desktop') return '桌面端MCP'
  if (source === 'browser') return '浏览器MCP'
  return ''
}

export const getMcpToolSource = (name: string): 'server' | 'desktop' | 'browser' => {
  const normalized = String(name || '').trim()
  if (!normalized) return 'server'
  if (BROWSER_AGENT_MCP_TOOLS.includes(normalized) || hasMcpPrefix(normalized, 'browser') || hasMcpPrefix(normalized, 'card')) {
    return 'browser'
  }
  if (DESKTOP_AGENT_MCP_TOOLS.includes(normalized)) return 'desktop'
  return 'server'
}

// Chinese-first label for a tool: the Chinese name leads, the English call name
// follows as a secondary reference.
export const getMcpToolZhLabel = (name: string) => MCP_TOOL_ZH_META[name]?.label || name

export const getMcpToolZhTag = (name: string) => MCP_TOOL_ZH_META[name]?.tag || getMcpToolFallbackTag(name)

export const groupMcpToolsByZhTag = (tools: string[]): McpToolGroup[] => {
  const groups = new Map<string, string[]>()
  for (const tool of tools) {
    const name = String(tool || '').trim()
    if (!name) continue
    const tag = getMcpToolZhTag(name)
    const rows = groups.get(tag) || []
    rows.push(name)
    groups.set(tag, rows)
  }
  return Array.from(groups.entries())
    .map(([tag, rows]) => ({
      tag,
      tools: rows.sort((a, b) => getMcpToolZhLabel(a).localeCompare(getMcpToolZhLabel(b), 'zh-Hans-CN')),
    }))
    .sort((a, b) => {
      const aRank = MCP_TOOL_TAG_ORDER.includes(a.tag) ? MCP_TOOL_TAG_ORDER.indexOf(a.tag) : MCP_TOOL_TAG_ORDER.length
      const bRank = MCP_TOOL_TAG_ORDER.includes(b.tag) ? MCP_TOOL_TAG_ORDER.indexOf(b.tag) : MCP_TOOL_TAG_ORDER.length
      if (aRank !== bRank) return aRank - bRank
      return a.tag.localeCompare(b.tag, 'zh-Hans-CN')
    })
}

export const groupMcpToolsBySource = (tools: string[]): McpToolSourceGroup[] => {
  const sourceTitles: Record<McpToolSourceGroup['source'], string> = {
    server: '服务端 MCP',
    desktop: '桌面端 MCP',
    browser: '浏览器 MCP',
  }
  const buckets: Record<McpToolSourceGroup['source'], string[]> = {
    server: [],
    desktop: [],
    browser: [],
  }
  for (const rawTool of tools) {
    const tool = String(rawTool || '').trim()
    if (!tool) continue
    buckets[getMcpToolSource(tool)].push(tool)
  }
  return (['server', 'desktop', 'browser'] as const)
    .map(source => {
      const sourceTools = Array.from(new Set(buckets[source])).sort((a, b) => getMcpToolZhLabel(a).localeCompare(getMcpToolZhLabel(b), 'zh-Hans-CN'))
      return {
        source,
        title: sourceTitles[source],
        tools: sourceTools,
        groups: groupMcpToolsByZhTag(sourceTools),
      }
    })
    .filter(section => section.tools.length > 0)
}

export const withMcpToolLocale = (tool: McpToolDefinition): McpToolDefinition => {
  const meta = MCP_TOOL_ZH_META[tool.name]
  const sourceTag = getSourceTag(tool.mcpSource)
  const isDesktopCapability = tool.mcpSource === 'desktop'
  const isBrowserCapability = tool.mcpSource === 'browser' || hasMcpPrefix(tool.name, 'browser') || hasMcpPrefix(tool.name, 'card')
  const rawDescription = String(tool.description || '').trim()
  const sourceSpecificDescription = (() => {
    if (tool.name === 'admin.dispatch_task' && tool.mcpSource === 'desktop') {
      return '通过已连接的桌面端 Agent 分派任务，可进一步调用 fs.*、shell.*、git.*、keyboard.*、mouse.*、screen.*、clipboard.*、window.*、process.* 等桌面能力。'
    }
    if (tool.name === 'admin.dispatch_task' && tool.mcpSource === 'browser') {
      return '通过已连接的浏览器插件分派任务，可进一步调用 browser_* 与 card_* 浏览器自动化能力。'
    }
    if (isDesktopCapability) return '桌面端 Agent 上报的执行能力。服务端 AI 需要通过 admin.dispatch_task 下发到已连接桌面端执行。'
    if (isBrowserCapability) return '浏览器插件上报的执行能力。服务端 AI 需要通过 admin.dispatch_task 下发到已连接插件执行。'
    return ''
  })()
  const zhDescription = sourceSpecificDescription
    || meta?.description
    || rawDescription
    || '暂无中文说明'
  const tags = sourceTag ? [sourceTag] : [getMcpToolZhTag(tool.name)]
  if (tool.destructive) tags.push('高风险')
  const sourceSpecificLabel = (() => {
    if (tool.name === 'admin.dispatch_task' && tool.mcpSource === 'desktop') return '分派到桌面端'
    if (tool.name === 'admin.dispatch_task' && tool.mcpSource === 'browser') return '分派到浏览器插件'
    return ''
  })()
  return {
    ...tool,
    zhLabel: sourceSpecificLabel || meta?.label || tool.name,
    zhDescription,
    zhTags: tags,
  }
}

export const getMcpToolParamRows = (tool: McpToolDefinition): McpToolParamRow[] => {
  const schema = (tool.inputSchema && typeof tool.inputSchema === 'object') ? tool.inputSchema : {}
  const properties = (schema.properties && typeof schema.properties === 'object')
    ? schema.properties as Record<string, any>
    : {}
  const requiredSet = new Set(
    Array.isArray(schema.required)
      ? schema.required.map((item: unknown) => String(item || '').trim()).filter(Boolean)
      : []
  )

  return Object.entries(properties)
    .map(([name, cfg]) => ({
      name,
      type: normalizeMcpSchemaType((cfg as any)?.type),
      required: requiredSet.has(name),
      description: String((cfg as any)?.description || '').trim(),
    }))
    .sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}
