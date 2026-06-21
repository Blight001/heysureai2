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

// 标签（二级分组）的展示顺序。按所属大类成段组织，便于阅读与维护；
// 大类（一级分组）的归属与顺序分别见 TAG_PARENT 与 PARENT_ORDER。
const MCP_TOOL_TAG_ORDER = [
  // 服务端 · 系统管理
  '概览',
  'Prompt',
  'MCP',
  // 服务端 · 基础能力
  '任务',
  '工作区',
  '通用',
  '发消息',
  '会话管理',
  // 服务端 · 知识与进化
  '归档',
  '知识总结',
  '进化',
  // 桌面端 · 系统操作
  '终端',
  '进程',
  '文件系统',
  'Git',
  // 桌面端 · 图形交互
  '键鼠输入',
  '屏幕',
  '窗口',
  '剪贴板',
  '桌面能力',
  // 浏览器
  '导航',
  '观察',
  '交互',
  '数据',
  '状态',
  '卡片',
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
  // device/extension/.../definitions.ts；Web 端无法直接 import 扩展代码，故镜像于此）。
  // 兼容旧的按动词拆分的工具名（browser_cookie_get、browser_click 等），它们已被合并为
  // 带 action 的工具（browser_tab / browser_action / browser_cookie 等），但历史 scope
  // 里可能仍存有旧名。
  // 浏览器端来源本身已是「浏览器 MCP」，故标签去掉冗余的「浏览器」前缀，
  // 直接作为来源下的二级分组（导航 / 观察 / 交互 / 数据 / 状态 / 卡片）。
  // browser_tab 现已涵盖跳转 URL / 前进后退 / 列出标签等页面级导航，归入「导航」。
  if (['browser_tab', 'browser_navigate', 'browser_history', 'browser_history_back', 'browser_history_forward', 'browser_tab_list', 'browser_tab_open', 'browser_tab_close', 'browser_tab_switch', 'browser_tab_navigate', 'browser_tab_replace', 'browser_tab_back', 'browser_tab_forward'].includes(name)) return '导航'
  if (['browser_observe', 'browser_screenshot', 'browser_find_text', 'browser_performance', 'browser_network_log', 'browser_iframe_list'].includes(name)) return '观察'
  // browser_action 聚合了点击/双击/右键/滚动/输入/键盘按键。
  if (['browser_action', 'browser_click', 'browser_double_click', 'browser_right_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_wait', 'browser_drag'].includes(name)) return '交互'
  if (['browser_evaluate', 'browser_extract', 'browser_clipboard_write', 'browser_file_upload', 'browser_download'].includes(name)) return '数据'
  if (['browser_cookie', 'browser_storage', 'browser_session', 'browser_profile'].includes(name)) return '状态'
  if (hasMcpPrefix(name, 'card')) return '卡片'
  // 旧的按动词拆分工具名一律归到「状态」。
  if (/^browser_(cookie|storage|session|profile)_/.test(name)) return '状态'
  if (hasMcpPrefix(name, 'browser')) return '观察'

  return ''
}

const getMcpToolFallbackTag = (name: string) => {
  const endpointCapabilityTag = getEndpointCapabilityTag(name)
  if (endpointCapabilityTag) return endpointCapabilityTag
  // workspace.manage（文件）、workspace.run_command（终端）、workspace.search（联网搜索）同归「工作区」。
  if (hasMcpPrefix(name, 'workspace')) return '工作区'
  if (hasMcpPrefix(name, 'librarian')) return '图书馆'
  if (hasMcpPrefix(name, 'knowledge')) return '知识总结'
  if (hasMcpPrefix(name, 'admin')) return '概览'
  if (hasMcpPrefix(name, 'desktop')) return '桌面能力'
  if (hasMcpPrefix(name, 'task')) return '任务'
  if (hasMcpPrefix(name, 'prompt')) return 'Prompt'
  // 发消息：发给用户 / 发给其他 AI，单独成栏，不再混入「会话管理」。
  if (hasMcpPrefix(name, 'message')) return '发消息'
  if (hasMcpPrefix(name, 'feishu')) return '会话管理'
  if (hasMcpPrefix(name, 'conversation')) return '会话管理'
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

const MCP_TOOL_ZH_LABELS: Record<string, string> = {
  'mcp.list_tools': '工具列表',
  'mcp.describe_tool': '工具说明',
  'workspace.search': '联网搜索',
  'workspace.run_command': '执行命令',
  'workspace.manage': '文件管理',
  'admin.manage': '系统总览',
  'task.manage': '任务管理',
  'task.complete': '完成任务',
  'message.send_to_user': '发给用户',
  'message.send_to_ai': '发给 AI',
  'conversation.manage': '会话管理',
  'prompt.manage': 'Prompt 管理',
  'knowledge.manage': '知识库管理',
  'device_mcp.manage': '管理设备 MCP',
  'mcp.manage_dynamic_tool': '管理动态 MCP',
  'browser_mcp.manage_dynamic_tool': '管理动态 MCP',
  browser_observe: '页面观察',
  browser_screenshot: '页面截图',
  browser_action: '页面交互',
  browser_wait: '等待页面',
  browser_drag: '拖拽元素',
  browser_evaluate: '执行脚本',
  browser_extract: '提取数据',
  browser_clipboard_write: '写入剪贴板',
  browser_file_upload: '上传文件',
  browser_download: '下载文件',
  browser_tab: '标签页与导航',
  browser_cookie: '管理 Cookie',
  browser_storage: '管理存储',
  browser_session: '管理会话',
  'mouse.move': '鼠标移动',
  'mouse.click': '鼠标点击',
  'mouse.double_click': '鼠标双击',
  'mouse.right_click': '鼠标右键',
  'mouse.scroll': '鼠标滚动',
  'mouse.drag': '鼠标拖拽',
  'keyboard.type': '键盘输入',
  'keyboard.press': '键盘按键',
  'text.input': '大段文本输入',
  'speech.speak': '语音朗读',
  'vision.capture': '屏幕采集',
  'vision.capture_mouse': '鼠标区域采集',
  'display.box': '屏幕高亮',
  'display.clear': '清除高亮',
  'clipboard.get': '读取剪贴板',
  'clipboard.set': '写入剪贴板',
  'shell.run': '命令执行',
  'window.list': '窗口列表',
  'window.focus': '窗口聚焦',
  'window.close': '关闭窗口',
  'hands.start': '开始输入采集',
  'hands.stop': '停止输入采集',
  'hands.snapshot': '输入快照',
  'hands.events': '输入事件',
  'hands.mouse': '鼠标输入',
}

const MCP_NAMESPACE_ZH: Record<string, string> = {
  mcp: 'MCP',
  workspace: '工作区',
  admin: '管理',
  task: '任务',
  message: '消息',
  conversation: '会话',
  prompt: 'Prompt',
  file: '文件',
  knowledge: '知识库',
  librarian: '图书馆',
  browser: '浏览器',
  mouse: '鼠标',
  keyboard: '键盘',
  text: '文本',
  speech: '语音',
  vision: '视觉',
  hands: '手势',
  display: '显示',
  clipboard: '剪贴板',
  card: '卡片',
  shell: '命令行',
  window: '窗口',
  process: '进程',
  fs: '文件',
  git: 'Git',
  screen: '屏幕',
  desktop: '桌面',
  device: '设备',
  custom: '自定义',
}

const MCP_ACTION_ZH: Record<string, string> = {
  list: '列表',
  read: '读取',
  write: '写入',
  edit: '编辑',
  get: '获取',
  set: '设置',
  create: '创建',
  delete: '删除',
  update: '更新',
  search: '搜索',
  run: '执行',
  capture: '采集',
  click: '点击',
  type: '输入',
  press: '按键',
  move: '移动',
  scroll: '滚动',
  drag: '拖拽',
  focus: '聚焦',
  close: '关闭',
  start: '开始',
  stop: '停止',
  snapshot: '快照',
  events: '事件',
  manage: '管理',
  inspect: '检查',
  upsert: '更新',
}

const humanizeMcpToolAction = (action: string) => {
  const parts = String(action || '').split(/[._-]+/).filter(Boolean)
  if (!parts.length) return '操作'
  return parts.map(part => MCP_ACTION_ZH[part.toLowerCase()] || part).join('·')
}

const formatMcpToolZhFallback = (name: string) => {
  const normalized = String(name || '').trim()
  if (!normalized) return '未命名工具'
  const dotParts = normalized.split('.')
  if (dotParts.length >= 2) {
    const namespace = MCP_NAMESPACE_ZH[dotParts[0]] || dotParts[0]
    return `${namespace}·${humanizeMcpToolAction(dotParts.slice(1).join('.'))}`
  }
  if (normalized.startsWith('browser_')) {
    return `浏览器·${humanizeMcpToolAction(normalized.slice('browser_'.length))}`
  }
  return humanizeMcpToolAction(normalized)
}

export const getMcpToolZhLabel = (name: string) => {
  const normalized = String(name || '').trim()
  if (!normalized) return '未命名工具'
  return MCP_TOOL_ZH_LABELS[normalized] || formatMcpToolZhFallback(normalized)
}

const getMcpToolZhTag = (name: string) => getMcpToolFallbackTag(name)

const MEMORY_PREFIX_ORDER = ['memory']
const TASK_TOOL_ORDER = [
  'task.manage',
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

// 大类（一级分组）→ 其下标签（二级分组）的归属表。每个来源（服务端 / 桌面端 /
// 浏览器）内部据此把标签收拢成大类，形成「来源 → 大类 → 标签 → 工具」的层级。
// 浏览器标签不在表内（返回 ''），直接作为来源下的二级分组，避免与来源名重复。
const TAG_PARENT: Record<string, string> = {
  // 服务端
  '概览': '系统管理',
  'Prompt': '系统管理',
  'MCP': '系统管理',
  '任务': '基础能力',
  '工作区': '基础能力',
  '通用': '基础能力',
  '发消息': '基础能力',
  '会话管理': '基础能力',
  '归档': '知识与进化',
  '知识总结': '知识与进化',
  '图书馆': '知识与进化',
  '进化': '知识与进化',
  // 桌面端
  '终端': '系统操作',
  '进程': '系统操作',
  '文件系统': '系统操作',
  'Git': '系统操作',
  '键鼠输入': '图形交互',
  '屏幕': '图形交互',
  '窗口': '图形交互',
  '剪贴板': '图形交互',
  '桌面能力': '图形交互',
}

const PARENT_ORDER = ['基础能力', '系统管理', '知识与进化', '系统操作', '图形交互']

const getMcpToolGroupParent = (tag: string) => TAG_PARENT[tag] || ''

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

  const parentOrder = PARENT_ORDER
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
