import type { McpToolDefinition, McpToolParamRow } from '@/types'

export interface McpToolGroup {
  tag: string
  tools: string[]
}

export interface McpToolParentGroup {
  title: string
  groups: McpToolGroup[]
  tools: string[]
}

export interface McpToolSourceGroup {
  source: 'server' | 'desktop' | 'browser'
  title: string
  groups: McpToolGroup[]
  parentGroups: McpToolParentGroup[]
  tools: string[]
}

const normalizeMcpSchemaType = (rawType: unknown) => {
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

const MCP_TOOL_TAG_ORDER = [
  'MCP',
  '工作区',
  '系统总览',
  '项目',
  '任务',
  '文件系统',
  '终端',
  'Git',
  '键鼠输入',
  '屏幕',
  '剪贴板',
  '窗口',
  '进程',
  '浏览器导航',
  '浏览器观察',
  '浏览器交互',
  '浏览器数据',
  '浏览器状态',
  '浏览器卡片',
  '记忆',
  '归档',
  '总结',
  '进化',
  'Prompt',
  '发消息',
  '协作',
  '通用',
]

const hasMcpPrefix = (name: string, prefix: string) => name.startsWith(`${prefix}.`) || name.startsWith(`${prefix}_`)

const getEndpointCapabilityTag = (name: string) => {
  if (hasMcpPrefix(name, 'fs')) return '文件系统'
  if (hasMcpPrefix(name, 'shell')) return '终端'
  if (hasMcpPrefix(name, 'git')) return 'Git'
  if (hasMcpPrefix(name, 'keyboard') || hasMcpPrefix(name, 'mouse')) return '键鼠输入'
  if (hasMcpPrefix(name, 'screen')) return '屏幕'
  if (hasMcpPrefix(name, 'clipboard')) return '剪贴板'
  if (hasMcpPrefix(name, 'window')) return '窗口'
  if (hasMcpPrefix(name, 'process')) return '进程'

  // 浏览器工具分类与扩展端 BROWSER_TOOL_CATEGORIES 保持一致（单一来源在
  // agent/extension/.../definitions.ts；Web 端无法直接 import 扩展代码，故镜像于此）。
  // 兼容旧的按动词拆分的工具名（browser_cookie_get 等），它们已被合并为
  // browser_cookie 等带 action 的工具，但历史 scope 里可能仍存有旧名。
  if (['browser_navigate', 'browser_search', 'browser_history', 'browser_history_back', 'browser_history_forward'].includes(name)) return '浏览器导航'
  if (['browser_screenshot', 'browser_get_content', 'browser_dom_snapshot', 'browser_page_info', 'browser_find_text', 'browser_find_popups', 'browser_performance', 'browser_network_log', 'browser_iframe_list'].includes(name)) return '浏览器观察'
  if (['browser_click', 'browser_double_click', 'browser_right_click', 'browser_type', 'browser_press_key', 'browser_hover', 'browser_scroll', 'browser_wait', 'browser_drag', 'browser_fill_form', 'browser_select', 'browser_close_popup'].includes(name)) return '浏览器交互'
  if (['browser_evaluate', 'browser_extract', 'browser_clipboard_write', 'browser_file_upload', 'browser_download'].includes(name)) return '浏览器数据'
  if (['browser_tab', 'browser_cookie', 'browser_storage', 'browser_session', 'browser_profile'].includes(name)) return '浏览器状态'
  if (hasMcpPrefix(name, 'card')) return '浏览器卡片'
  // 旧的按动词拆分工具名一律归到「浏览器状态」。
  if (/^browser_(tab|cookie|storage|session|profile)_/.test(name)) return '浏览器状态'
  if (hasMcpPrefix(name, 'browser')) return '浏览器观察'

  return ''
}

const getMcpToolFallbackTag = (name: string) => {
  const endpointCapabilityTag = getEndpointCapabilityTag(name)
  if (endpointCapabilityTag) return endpointCapabilityTag
  if (hasMcpPrefix(name, 'workspace')) return '工作区'
  if (hasMcpPrefix(name, 'admin')) return '系统总览'
  if (hasMcpPrefix(name, 'desktop')) return '桌面能力'
  if (hasMcpPrefix(name, 'project')) return '项目'
  if (hasMcpPrefix(name, 'task')) return '任务'
  if (hasMcpPrefix(name, 'prompt')) return 'Prompt'
  if (name === 'memory.archive' || name === 'librarian.archive') return '归档'
  if (hasMcpPrefix(name, 'memory')) return '记忆'
  if (hasMcpPrefix(name, 'librarian')) return '总结'
  if (hasMcpPrefix(name, 'evolution')) return '进化'
  // 发消息：发给用户 / 发给其他 AI，单独成栏，不再混入「协作」。
  if (hasMcpPrefix(name, 'message')) return '发消息'
  if (hasMcpPrefix(name, 'feishu')) return '协作'
  if (hasMcpPrefix(name, 'conversation')) return '协作'
  return '通用'
}

const getSourceTag = (source?: McpToolDefinition['mcpSource']) => {
  if (source === 'desktop') return '桌面端MCP'
  if (source === 'browser') return '浏览器MCP'
  return ''
}

const getMcpToolSource = (name: string): 'server' | 'desktop' | 'browser' => {
  const normalized = String(name || '').trim()
  if (!normalized) return 'server'
  if (hasMcpPrefix(normalized, 'browser') || hasMcpPrefix(normalized, 'card')) {
    return 'browser'
  }
  return 'server'
}

// UI now shows the raw MCP tool name directly. We keep the function name for
// call-site compatibility.
export const getMcpToolZhLabel = (name: string) => {
  const normalized = String(name || '').trim()
  return normalized || '未命名工具'
}

const getMcpToolZhTag = (name: string) => getMcpToolFallbackTag(name)

const MEMORY_PREFIX_ORDER = ['memory', 'librarian']
const TASK_TOOL_ORDER = [
  'task.create',
  'task.update',
  'task.delete',
  'task.list',
  'task.inherit',
  'task.complete',
]

const getTaskToolRank = (name: string) => {
  const toolRank = TASK_TOOL_ORDER.includes(name) ? TASK_TOOL_ORDER.indexOf(name) : 999
  return { toolRank }
}

const getMemoryToolRank = (name: string) => {
  const prefix = name.split(/[._]/)[0] || ''
  const prefixRank = MEMORY_PREFIX_ORDER.includes(prefix)
    ? MEMORY_PREFIX_ORDER.indexOf(prefix)
    : MEMORY_PREFIX_ORDER.length
  return { prefixRank }
}

const compareMcpToolByZh = (a: string, b: string, tag = '') => {
  if (tag === '任务') {
    const ar = getTaskToolRank(a)
    const br = getTaskToolRank(b)
    if (ar.toolRank !== br.toolRank) return ar.toolRank - br.toolRank
  }
  if (tag === '记忆') {
    const ar = getMemoryToolRank(a)
    const br = getMemoryToolRank(b)
    if (ar.prefixRank !== br.prefixRank) return ar.prefixRank - br.prefixRank
  }
  return getMcpToolZhLabel(a).localeCompare(getMcpToolZhLabel(b), 'zh-Hans-CN')
}

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
      tools: rows.sort((a, b) => compareMcpToolByZh(a, b, tag)),
    }))
    .sort((a, b) => {
      const aRank = MCP_TOOL_TAG_ORDER.includes(a.tag) ? MCP_TOOL_TAG_ORDER.indexOf(a.tag) : MCP_TOOL_TAG_ORDER.length
      const bRank = MCP_TOOL_TAG_ORDER.includes(b.tag) ? MCP_TOOL_TAG_ORDER.indexOf(b.tag) : MCP_TOOL_TAG_ORDER.length
      if (aRank !== bRank) return aRank - bRank
      return a.tag.localeCompare(b.tag, 'zh-Hans-CN')
    })
}

const getMcpToolGroupParent = (tag: string) => {
  if (tag === '系统总览' || tag === '项目' || tag === '任务' || tag === 'Prompt') return '系统'
  if (tag === '进化' || tag === '记忆' || tag === '归档' || tag === '总结') return '进化'
  return ''
}

export const groupMcpToolGroupsByParent = (groups: McpToolGroup[]): McpToolParentGroup[] => {
  const parentMap = new Map<string, McpToolGroup[]>()
  const standalone: McpToolParentGroup[] = []

  for (const group of groups) {
    const parent = getMcpToolGroupParent(group.tag)
    if (!parent) {
      standalone.push({ title: group.tag, groups: [group], tools: group.tools })
      continue
    }
    const rows = parentMap.get(parent) || []
    rows.push(group)
    parentMap.set(parent, rows)
  }

  const parentRows = Array.from(parentMap.entries()).map(([title, childGroups]) => ({
    title,
    groups: childGroups,
    tools: childGroups.flatMap(group => group.tools),
  }))

  const parentOrder = ['系统', '进化']
  return [...parentRows, ...standalone].sort((a, b) => {
    const aRank = parentOrder.includes(a.title) ? parentOrder.indexOf(a.title) : parentOrder.length
    const bRank = parentOrder.includes(b.title) ? parentOrder.indexOf(b.title) : parentOrder.length
    if (aRank !== bRank) return aRank - bRank
    const aGroup = a.groups[0]?.tag || a.title
    const bGroup = b.groups[0]?.tag || b.title
    const aTagRank = MCP_TOOL_TAG_ORDER.includes(aGroup) ? MCP_TOOL_TAG_ORDER.indexOf(aGroup) : MCP_TOOL_TAG_ORDER.length
    const bTagRank = MCP_TOOL_TAG_ORDER.includes(bGroup) ? MCP_TOOL_TAG_ORDER.indexOf(bGroup) : MCP_TOOL_TAG_ORDER.length
    if (aTagRank !== bTagRank) return aTagRank - bTagRank
    return a.title.localeCompare(b.title, 'zh-Hans-CN')
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
      const sourceTools = Array.from(new Set(buckets[source])).sort((a, b) => compareMcpToolByZh(a, b))
      const groups = groupMcpToolsByZhTag(sourceTools)
      return {
        source,
        title: sourceTitles[source],
        tools: sourceTools,
        groups,
        parentGroups: groupMcpToolGroupsByParent(groups),
      }
    })
    .filter(section => section.tools.length > 0)
}

export const withMcpToolLocale = (tool: McpToolDefinition): McpToolDefinition => {
  const sourceTag = getSourceTag(tool.mcpSource)
  const rawDescription = String(tool.description || '').trim()
  const zhDescription = rawDescription
  const tags = sourceTag ? [sourceTag] : [getMcpToolZhTag(tool.name)]
  if (tool.destructive) tags.push('高风险')
  return {
    ...tool,
    zhLabel: tool.name,
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
