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
  'browser_find_popups',
  'browser_close_popup',
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
  'workspace.run_command': { label: '执行命令', description: '在工作目录中执行终端命令。', tag: '工作区' },
  'admin.list_agents': { label: '列出智能体', description: '查看系统中的 AI 成员列表。', tag: '管理与项目' },
  'admin.get_overview': { label: '管理总览', description: '获取系统运行状态与关键统计。', tag: '管理与项目' },
  'admin.dispatch_flow': { label: '分派流程', description: '向指定 AI 下发流程或任务。', tag: '管理与项目' },
  'project.list_projects': { label: '项目列表', description: '查看当前用户下的项目信息。', tag: '管理与项目' },
  'project.create_project': { label: '创建项目', description: '创建新的项目记录。', tag: '管理与项目' },
  'project.update_project': { label: '更新项目', description: '更新项目信息与成员绑定。', tag: '管理与项目' },
  'project.delete_project': { label: '删除项目', description: '删除项目记录，请谨慎操作。', tag: '管理与项目' },
  'task.create_immediate': { label: '创建即时任务', description: '立即执行任务；不使用任何定时参数。核心参数：title、instruction。', tag: '计划与记忆' },
  'task.create_scheduled': { label: '创建定时任务', description: '一次性定时任务；使用 schedule_at 或 schedule_duration_minutes（二选一）。', tag: '计划与记忆' },
  'task.create_recurring': { label: '创建循环任务', description: '循环任务；使用 schedule_duration_minutes 作为间隔，可选 schedule_run_immediately 首次立即执行。', tag: '计划与记忆' },
  'task.create': { label: '创建任务(兼容)', description: '兼容入口，建议优先使用上面三类创建工具。', tag: '计划与记忆' },
  'task.list': { label: '任务队列', description: '查看当前 AI 的任务队列情况。', tag: '计划与记忆' },
  'task.get_current': { label: '当前任务', description: '读取当前执行中的任务详情。', tag: '计划与记忆' },
  'task.inherit': { label: '提交传承', description: '提交任务传承摘要与上下文。', tag: '计划与记忆' },
  'task.complete': { label: '标记完成', description: '将当前任务标记为完成。', tag: '计划与记忆' },
  'task.wait_all': { label: '等待子任务', description: '阻塞等待指定子任务全部完成或超时后返回各自结果摘要，常用于并行编排。', tag: '计划与记忆' },
  'prompt.list_targets': { label: 'Prompt 目标', description: '列出当前 AI 基础 prompt 目标与全局/系统 prompt 模板键。', tag: 'Prompt' },
  'prompt.read_ai': { label: '读取 AI Prompt', description: '读取指定 AI 实际使用的基础 prompt；未指定时读取当前 AI。', tag: 'Prompt' },
  'prompt.write_ai': { label: '修改 AI Prompt', description: '按行修改指定 AI 的 prompt；整段覆盖必须显式使用 replace_all。', tag: 'Prompt' },
  'prompt.read_system': { label: '读取系统 Prompt', description: '读取全局注入模板/旧版兜底 prompt；当前 AI 基础 prompt 请用读取 AI Prompt。', tag: 'Prompt' },
  'prompt.write_system': { label: '修改系统 Prompt', description: '按行修改全局注入模板/旧版兜底 prompt；整段覆盖必须显式使用 replace_all。', tag: 'Prompt' },
  'user.send_message': { label: '发送用户消息', description: '向用户发送文本消息；当前默认通过绑定的飞书机器人投递。', tag: '协作' },
  'conversation.forget_before_current': { label: '忘记前文', description: '删除当前会话里当前用户消息之前的内容，保留当前消息及之后内容。', tag: '协作' },
  'ai.send_message': { label: '发送 AI 消息', description: '向另一个 AI 发送消息并立即返回；对方会通过 AI 消息回复流程返回结果。', tag: '协作' },
  'memory.write': { label: '写入记忆', description: '沉淀高价值的结构化记忆（事实/决策/经验/待办/风险/模板）供后续检索。', tag: '计划与记忆' },
  'memory.search': { label: '检索记忆', description: '按关键词、类型、项目或标签搜索已存储的记忆。', tag: '计划与记忆' },
  'memory.list': { label: '记忆列表', description: '列出已存储的记忆，可按类型/项目过滤。', tag: '计划与记忆' },
  'memory.update': { label: '更新记忆', description: '更新已有记忆的内容/标签/类型/置信度。', tag: '计划与记忆' },
  'memory.archive': { label: '归档记忆', description: '归档（软删除）记忆，使其默认检索时不再出现。', tag: '计划与记忆' },
  'librarian.propose': { label: '提交知识流程', description: '向图书管理员提交可复用流程，等待审批后进入知识库。', tag: '计划与记忆' },
  'librarian.consult': { label: '咨询图书管理员', description: '按问题检索图书管理员知识库中的相关流程与做法。', tag: '协作' },
  'librarian.list_topics': { label: '知识主题列表', description: '浏览图书管理员已收录的流程标题与触发关键词。', tag: '计划与记忆' },
  'librarian.read': { label: '读取知识流程', description: '按 memory_id 读取图书管理员知识库中的完整流程内容。', tag: '计划与记忆' },
  'librarian.archive': { label: '归档知识流程', description: '归档图书管理员知识库中的流程条目。', tag: '计划与记忆' },
  'evolution.input': { label: '提交进化建议', description: '提交对提示词/工具/流程的改进建议，交由核心管理者评审。', tag: '进化' },
  'evolution.list': { label: '进化建议列表', description: '列出已提交的进化建议，可按评审状态过滤。', tag: '进化' },
  'evolution.review': { label: '评审进化建议', description: '评审进化建议：接受/拒绝/应用（核心管理者）。', tag: '进化' },
  'fs.list': { label: '列出文件', description: '列出工作区目录中的文件和子目录。', tag: '文件系统' },
  'fs.read': { label: '读取文件', description: '读取工作区中的文件内容。', tag: '文件系统' },
  'fs.write': { label: '写入文件', description: '在工作区中创建或覆盖文件内容。', tag: '文件系统' },
  'shell.run': { label: '运行命令', description: '在本机或工作区环境中执行命令行指令。', tag: '终端' },
  'git.diff': { label: '查看差异', description: '查看当前工作区与 Git 基线之间的改动差异。', tag: 'Git' },
  'keyboard.type': { label: '键盘输入', description: '向当前焦点位置输入文本。', tag: '键鼠输入' },
  'keyboard.press': { label: '按键', description: '向当前焦点位置发送单个或组合键。', tag: '键鼠输入' },
  'mouse.move': { label: '移动鼠标', description: '将鼠标移动到指定坐标。', tag: '键鼠输入' },
  'mouse.click': { label: '单击鼠标', description: '在指定坐标执行单击。', tag: '键鼠输入' },
  'mouse.double_click': { label: '双击鼠标', description: '在指定坐标执行双击。', tag: '键鼠输入' },
  'mouse.right_click': { label: '右键单击', description: '在指定坐标执行右键单击。', tag: '键鼠输入' },
  'mouse.scroll': { label: '滚动鼠标', description: '在指定坐标执行鼠标滚轮滚动。', tag: '键鼠输入' },
  'mouse.drag': { label: '拖拽鼠标', description: '从一个坐标拖拽到另一个坐标。', tag: '键鼠输入' },
  'screen.capture': { label: '截取屏幕', description: '截取整个屏幕的图像。', tag: '屏幕' },
  'screen.capture_region': { label: '截取区域', description: '截取屏幕中的指定区域。', tag: '屏幕' },
  'screen.info': { label: '屏幕信息', description: '读取当前屏幕的分辨率与显示信息。', tag: '屏幕' },
  'clipboard.get': { label: '读取剪贴板', description: '读取系统剪贴板内容。', tag: '剪贴板' },
  'clipboard.set': { label: '写入剪贴板', description: '将文本写入系统剪贴板。', tag: '剪贴板' },
  'window.list': { label: '列出窗口', description: '列出当前可见窗口。', tag: '窗口' },
  'window.focus': { label: '聚焦窗口', description: '激活并切换到指定窗口。', tag: '窗口' },
  'window.close': { label: '关闭窗口', description: '关闭指定窗口。', tag: '窗口' },
  'process.list': { label: '列出进程', description: '列出当前系统中的进程。', tag: '进程' },
  'process.kill': { label: '结束进程', description: '按名称或 PID 结束进程。', tag: '进程' },
  'browser_navigate': { label: '跳转页面', description: '打开或跳转到指定 URL；可选择在新标签页中打开。', tag: '浏览器导航' },
  'browser_screenshot': { label: '截取屏幕', description: '截取当前标签页可见区域的 PNG 截图。', tag: '浏览器页面' },
  'browser_click': { label: '点击元素', description: '通过 CSS 选择器、文本或坐标点击页面元素。', tag: '浏览器交互' },
  'browser_type': { label: '输入内容', description: '向输入框或文本区域输入文本。', tag: '浏览器交互' },
  'browser_get_content': { label: '读取内容', description: '读取当前页面的可见文本、标题、地址和基础元信息。', tag: '浏览器页面' },
  'browser_search': { label: '搜索网页', description: '使用搜索引擎检索网页并打开结果页。', tag: '浏览器导航' },
  'browser_scroll': { label: '滚动页面', description: '按方向或目标元素滚动页面，并返回滚动结果。', tag: '浏览器交互' },
  'browser_wait': { label: '等待页面', description: '等待指定元素出现或等待固定时长。', tag: '浏览器交互' },
  'browser_evaluate': { label: '执行脚本', description: '在当前页面上下文中执行 JavaScript 并返回结果。', tag: '浏览器数据' },
  'browser_extract': { label: '提取数据', description: '按选择器提取结构化页面数据，例如文本、链接和图片地址。', tag: '浏览器页面' },
  'browser_find_text': { label: '查找文本', description: '查找页面中包含指定文本的元素。', tag: '浏览器页面' },
  'browser_find_popups': { label: '查找弹窗', description: '检测当前页面可见的弹窗、模态框、抽屉、遮罩，并返回可能的关闭按钮。', tag: '浏览器页面' },
  'browser_close_popup': { label: '关闭弹窗', description: '关闭当前页面弹窗；优先点击关闭按钮，必要时使用 Escape 或遮罩点击兜底。', tag: '浏览器页面' },
  'browser_fill_form': { label: '填写表单', description: '一次性填写多个表单字段，并可在完成后提交。', tag: '浏览器交互' },
  'browser_select': { label: '选择选项', description: '在下拉框中选择指定的值或可见文本。', tag: '浏览器交互' },
  'browser_tab_list': { label: '标签页列表', description: '列出当前浏览器中的所有标签页。', tag: '浏览器标签页' },
  'browser_tab_open': { label: '新开标签页', description: '使用指定 URL 打开一个新的标签页。', tag: '浏览器标签页' },
  'browser_tab_close': { label: '关闭标签页', description: '关闭指定标签页；未指定时关闭当前活动标签页。', tag: '浏览器标签页' },
  'browser_history_back': { label: '后退', description: '让当前标签页返回上一页。', tag: '浏览器导航' },
  'browser_history_forward': { label: '前进', description: '让当前标签页前进到下一页。', tag: '浏览器导航' },
  'browser_clipboard_write': { label: '写入剪贴板', description: '将文本写入系统剪贴板。', tag: '浏览器数据' },
  'browser_storage_get': { label: '读取存储', description: '读取页面 localStorage 或 sessionStorage 中的键值。', tag: '浏览器数据' },
  'browser_hover': { label: '悬停元素', description: '将鼠标悬停在元素上以触发提示或悬浮菜单。', tag: '浏览器交互' },
  'browser_page_info': { label: '页面信息', description: '读取当前页面的滚动位置、视口、标题、可见章节和元素数量。', tag: '浏览器页面' },
  'browser_right_click': { label: '右键点击', description: '通过选择器、文本或坐标对元素执行右键点击。', tag: '浏览器交互' },
  'browser_double_click': { label: '双击元素', description: '通过选择器、文本或坐标对元素执行双击。', tag: '浏览器交互' },
  'browser_drag': { label: '拖拽元素', description: '从源元素或坐标拖拽到目标元素或坐标。', tag: '浏览器交互' },
  'browser_press_key': { label: '按键操作', description: '对当前页面发送键盘按键，可组合 Ctrl、Shift、Alt、Meta。', tag: '浏览器交互' },
  'card_list': { label: '列出卡片', description: '查看当前浏览器记忆卡片列表。', tag: '浏览器卡片' },
  'card_get': { label: '读取卡片', description: '按名称或 ID 读取单个浏览器记忆卡片。', tag: '浏览器卡片' },
  'card_save': { label: '保存卡片', description: '创建或更新一张浏览器记忆卡片及其步骤。', tag: '浏览器卡片' },
  'card_update_step': { label: '更新卡片步骤', description: '修改已有卡片中的单个自动化步骤。', tag: '浏览器卡片' },
  'card_run': { label: '运行卡片', description: '执行一张浏览器记忆卡片中的全部步骤。', tag: '浏览器卡片' },
  'card_delete': { label: '删除卡片', description: '删除指定的浏览器记忆卡片。', tag: '浏览器卡片' },
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

const MCP_TOOL_TAG_ORDER = [
  '工作区',
  '管理与项目',
  '文件系统',
  '终端',
  'Git',
  '键鼠输入',
  '屏幕',
  '剪贴板',
  '窗口',
  '进程',
  '浏览器导航',
  '浏览器页面',
  '浏览器交互',
  '浏览器数据',
  '浏览器标签页',
  '浏览器卡片',
  '计划与记忆',
  'Prompt',
  '进化',
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

  if (['browser_navigate', 'browser_search', 'browser_history_back', 'browser_history_forward'].includes(name)) return '浏览器导航'
  if (['browser_screenshot', 'browser_get_content', 'browser_extract', 'browser_find_text', 'browser_find_popups', 'browser_close_popup', 'browser_page_info'].includes(name)) return '浏览器页面'
  if (['browser_click', 'browser_type', 'browser_scroll', 'browser_wait', 'browser_fill_form', 'browser_select', 'browser_hover', 'browser_right_click', 'browser_double_click', 'browser_drag', 'browser_press_key'].includes(name)) return '浏览器交互'
  if (['browser_evaluate', 'browser_clipboard_write', 'browser_storage_get'].includes(name)) return '浏览器数据'
  if (['browser_tab_list', 'browser_tab_open', 'browser_tab_close'].includes(name)) return '浏览器标签页'
  if (hasMcpPrefix(name, 'card')) return '浏览器卡片'
  if (hasMcpPrefix(name, 'browser')) return '浏览器页面'

  return ''
}

const getMcpToolFallbackTag = (name: string) => {
  const endpointCapabilityTag = getEndpointCapabilityTag(name)
  if (endpointCapabilityTag) return endpointCapabilityTag
  if (hasMcpPrefix(name, 'workspace')) return '工作区'
  if (hasMcpPrefix(name, 'admin')) return '管理与项目'
  if (hasMcpPrefix(name, 'desktop')) return '桌面能力'
  if (hasMcpPrefix(name, 'project')) return '管理与项目'
  if (hasMcpPrefix(name, 'task')) return '计划与记忆'
  if (hasMcpPrefix(name, 'prompt')) return 'Prompt'
  if (hasMcpPrefix(name, 'memory')) return '计划与记忆'
  if (name === 'librarian.consult') return '协作'
  if (hasMcpPrefix(name, 'librarian')) return '计划与记忆'
  if (hasMcpPrefix(name, 'evolution')) return '进化'
  if (hasMcpPrefix(name, 'feishu')) return '协作'
  if (hasMcpPrefix(name, 'conversation')) return '协作'
  if (hasMcpPrefix(name, 'user')) return '协作'
  if (hasMcpPrefix(name, 'ai')) return '协作'
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

const getMcpToolFallbackLabel = (name: string) => {
  const normalized = String(name || '').trim()
  if (!normalized) return '未命名工具'
  if (hasMcpPrefix(normalized, 'workspace')) return `工作区工具：${normalized}`
  if (hasMcpPrefix(normalized, 'admin')) return `管理工具：${normalized}`
  if (hasMcpPrefix(normalized, 'project')) return `项目工具：${normalized}`
  if (hasMcpPrefix(normalized, 'task')) return `任务工具：${normalized}`
  if (hasMcpPrefix(normalized, 'prompt')) return `Prompt 工具：${normalized}`
  if (hasMcpPrefix(normalized, 'memory')) return `记忆工具：${normalized}`
  if (hasMcpPrefix(normalized, 'librarian')) return `图书管理员工具：${normalized}`
  if (hasMcpPrefix(normalized, 'evolution')) return `进化工具：${normalized}`
  if (hasMcpPrefix(normalized, 'conversation')) return `对话工具：${normalized}`
  if (hasMcpPrefix(normalized, 'user')) return `用户协作工具：${normalized}`
  if (hasMcpPrefix(normalized, 'ai')) return `AI 协作工具：${normalized}`
  if (hasMcpPrefix(normalized, 'feishu')) return `飞书工具：${normalized}`
  if (hasMcpPrefix(normalized, 'browser')) return `浏览器工具：${normalized}`
  if (hasMcpPrefix(normalized, 'card')) return `浏览器卡片工具：${normalized}`
  return `通用工具：${normalized}`
}

// Chinese-first label for a tool: the Chinese name leads, the English call name
// follows as a secondary reference.
export const getMcpToolZhLabel = (name: string) => MCP_TOOL_ZH_META[name]?.label || getMcpToolFallbackLabel(name)

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

const getMcpToolGroupParent = (tag: string) => {
  if (tag === '管理与项目' || tag === 'Prompt') return '管理员'
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

  const parentOrder = ['管理员']
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
      const sourceTools = Array.from(new Set(buckets[source])).sort((a, b) => getMcpToolZhLabel(a).localeCompare(getMcpToolZhLabel(b), 'zh-Hans-CN'))
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
  const meta = MCP_TOOL_ZH_META[tool.name]
  const sourceTag = getSourceTag(tool.mcpSource)
  const isDesktopCapability = tool.mcpSource === 'desktop'
  const isBrowserCapability = tool.mcpSource === 'browser' || hasMcpPrefix(tool.name, 'browser') || hasMcpPrefix(tool.name, 'card')
  const rawDescription = String(tool.description || '').trim()
  const sourceSpecificDescription = (() => {
    if (isDesktopCapability) return '桌面端 Agent 上报的执行能力，可用于本机文件、命令行、鼠标键盘、窗口、屏幕和剪贴板操作。服务端 AI 可直接调用并在已连接桌面端执行。'
    if (isBrowserCapability) return '浏览器插件上报的执行能力，可用于网页导航、点击、输入、滚动、标签页管理、弹窗处理和页面数据读取。服务端 AI 可直接调用并在已连接浏览器插件执行。'
    return ''
  })()
  const zhDescription = meta?.description
    || sourceSpecificDescription
    || rawDescription
    || '暂无中文说明'
  const tags = sourceTag ? [sourceTag] : [getMcpToolZhTag(tool.name)]
  if (tool.destructive) tags.push('高风险')
  const sourceSpecificLabel = (() => {
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
