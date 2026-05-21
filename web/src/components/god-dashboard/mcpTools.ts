import type { McpToolDefinition, McpToolParamRow } from './types'

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

const getMcpToolFallbackTag = (name: string) => {
  if (name.startsWith('workspace.')) return '工作区'
  if (name.startsWith('admin.')) return '管理'
  if (name.startsWith('project.')) return '项目'
  if (name.startsWith('task.')) return '任务'
  return '通用'
}

export const withMcpToolLocale = (tool: McpToolDefinition): McpToolDefinition => {
  const meta = MCP_TOOL_ZH_META[tool.name]
  const rawDescription = String(tool.description || '').trim()
  const zhDescription = meta?.description || rawDescription || '暂无中文说明'
  const tags = [meta?.tag || getMcpToolFallbackTag(tool.name)]
  if (tool.destructive) tags.push('高风险')
  return {
    ...tool,
    zhLabel: meta?.label || tool.name,
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
