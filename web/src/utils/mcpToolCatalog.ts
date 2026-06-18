export interface McpCatalogTool {
  name: string
  description?: string
  destructive?: boolean
}

export interface McpCatalogToolGroup {
  groupKey: string
  groupLabel: string
  groupKind?: 'workspace' | 'device'
  deviceId?: string
  deviceType?: string
  tools: McpCatalogTool[]
}

export const toolNamespace = (name: string): string => {
  const raw = String(name || '').trim()
  if (!raw) return 'other'
  if (raw.includes('.')) return raw.split('.', 1)[0]
  if (raw.includes('_')) return raw.split('_', 1)[0]
  return 'other'
}

export const shortToolDesc = (text: string, limit = 90): string => {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  for (const sep of ['。', '！', '？', '. ', '! ', '? ']) {
    const idx = raw.indexOf(sep)
    if (idx > 0 && idx <= limit) {
      const keep = idx + (['。', '！', '？'].includes(sep) ? 1 : 0)
      return raw.slice(0, keep).trim()
    }
  }
  if (raw.length <= limit) return raw
  return `${raw.slice(0, limit).trimEnd()}…`
}

export const stripPromptSection = (text: string, sectionTitle: string): string => {
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const escaped = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`\\n*\\[${escaped}\\]\\n[\\s\\S]*?(?=\\n\\[[^\\n]+\\]\\n|$)`)
  return src.replace(pattern, '').trim()
}

export const renderMcpToolCatalog = (tools: McpCatalogTool[]): string => {
  const normalized = tools
    .map(tool => ({
      name: String(tool?.name || '').trim(),
      description: shortToolDesc(String(tool?.description || '')),
      destructive: !!tool?.destructive,
    }))
    .filter(tool => tool.name)
    .sort((a, b) => {
      const namespaceRank = toolNamespace(a.name).localeCompare(toolNamespace(b.name))
      if (namespaceRank !== 0) return namespaceRank
      return a.name.localeCompare(b.name)
    })

  if (!normalized.length) return '- （空）'

  const groups = new Map<string, string[]>()
  for (const tool of normalized) {
    const namespace = toolNamespace(tool.name)
    const marker = tool.destructive ? ' !' : ''
    const line = tool.description
      ? `  - ${tool.name}${marker}: ${tool.description}`
      : `  - ${tool.name}${marker}`
    const bucket = groups.get(namespace) || []
    bucket.push(line)
    groups.set(namespace, bucket)
  }

  const lines: string[] = []
  for (const namespace of [...groups.keys()].sort()) {
    lines.push(`${namespace}/`)
    lines.push(...(groups.get(namespace) || []))
  }
  return lines.join('\n')
}

export const renderGroupedMcpToolCatalog = (groups: McpCatalogToolGroup[]): string => {
  const normalized = (Array.isArray(groups) ? groups : [])
    .map(group => ({
      groupKey: String(group?.groupKey || '').trim(),
      groupLabel: String(group?.groupLabel || '').trim(),
      tools: Array.isArray(group?.tools) ? group.tools : [],
    }))
    .filter(group => group.groupLabel || group.tools.length > 0)

  if (!normalized.length) return '- （空）'

  const sections: string[] = []
  for (const group of normalized) {
    const catalog = renderMcpToolCatalog(group.tools)
    const emptyDevice = group.groupKey === 'device:none'
    if (emptyDevice) {
      sections.push(`${group.groupLabel}\n- （当前无在线端侧设备）`)
      continue
    }
    if (!group.tools.length) {
      sections.push(`${group.groupLabel}\n- （当前无可用工具）`)
      continue
    }
    sections.push(group.groupLabel)
    sections.push(catalog)
  }
  return sections.join('\n\n')
}