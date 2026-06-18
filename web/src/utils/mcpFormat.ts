export const createMcpCallBlockPattern = () =>
  /<mcp[-_]call>\s*([\s\S]*?)\s*<\/\s*(?:mcp[-_]call|[｜|]*\s*DSML\s*[｜|]*\s*(?:invoke|tool[-_]?calls?))\s*>/gi

export const stripMcpCallBlocks = (raw?: string) => {
  return String(raw || '').replace(createMcpCallBlockPattern(), '').trim()
}

export interface McpToolBubbleSections {
  tool: string
  params: string
  result: string
  error: string
  copyText: string
}

const MCP_TOOL_LINE_RE = /^工具[：:]\s*.+$/m
const MCP_STATUS_LINE_RE = /^状态[：:]\s*.+$/m
const MCP_NEXT_SECTION_RE = /\n(?:\[(?:参数|结果|错误)\]|结果[：:]|错误[：:])\s*(?:\n|$)/

const stripLeadingMcpMetaLines = (raw: string) => {
  let body = String(raw || '').trim()
  let error = ''
  let changed = true
  while (changed) {
    changed = false
    const lines = body.split('\n')
    if (!lines.length) break
    const first = lines[0].trim()
    if (MCP_TOOL_LINE_RE.test(first) || MCP_STATUS_LINE_RE.test(first)) {
      body = lines.slice(1).join('\n').trim()
      changed = true
      continue
    }
    const errMatch = first.match(/^错误[：:]\s*(.+)$/)
    if (errMatch) {
      error = errMatch[1].trim()
      body = lines.slice(1).join('\n').trim()
      changed = true
    }
  }
  return { body, error }
}

const sliceUntilNextSection = (content: string) => {
  const nextIdx = content.search(MCP_NEXT_SECTION_RE)
  return (nextIdx >= 0 ? content.slice(0, nextIdx) : content).trim()
}

const extractBracketSection = (body: string, label: '参数' | '结果' | '错误') => {
  const marker = `[${label}]`
  const start = body.indexOf(marker)
  if (start < 0) return ''
  const content = body.slice(start + marker.length).replace(/^\s*\n?/, '')
  return sliceUntilNextSection(content)
}

const extractResultSection = (body: string) => {
  const bracketed = extractBracketSection(body, '结果')
  if (bracketed) return bracketed
  const legacyMarkers = ['结果：', '结果:'] as const
  for (const marker of legacyMarkers) {
    const start = body.indexOf(marker)
    if (start < 0) continue
    const content = body.slice(start + marker.length).replace(/^\s*\n?/, '')
    return sliceUntilNextSection(content)
  }
  return ''
}

const extractErrorSection = (body: string) => {
  const fromBracket = extractBracketSection(body, '错误')
  if (fromBracket) return fromBracket
  const markers = ['错误：', '错误:'] as const
  for (const marker of markers) {
    const start = body.indexOf(marker)
    if (start < 0) continue
    const content = body.slice(start + marker.length).replace(/^\s*\n?/, '')
    return sliceUntilNextSection(content)
  }
  return ''
}

const buildMcpCopyText = (sections: Pick<McpToolBubbleSections, 'params' | 'result' | 'error'>) => {
  const copyParts: string[] = []
  if (sections.params) copyParts.push(`[参数]\n${sections.params}`)
  if (sections.result) copyParts.push(`[结果]\n${sections.result}`)
  if (sections.error) copyParts.push(`[错误]\n${sections.error}`)
  return copyParts.join('\n')
}

export const parseMcpToolBubbleDetails = (raw?: string, fallbackTool = ''): McpToolBubbleSections => {
  const normalized = String(raw || '')
    .replace(/^\[MCP工具\]\s*/i, '')
    .replace(/\n*\[截图\]\s*\n\s*\S+\s*$/s, '')
    .trim()

  const tool = String(normalized.match(/^工具[：:]\s*(.+)$/m)?.[1] || fallbackTool).trim()

  let body = normalized
    .replace(/^工具[：:][^\n]*\n?/m, '')
    .replace(/^状态[：:][^\n]*\n?/m, '')
    .trim()

  let params = extractBracketSection(body, '参数')
  let result = extractResultSection(body)
  let error = extractErrorSection(body)

  if (!params && !result && !error && body) {
    const stripped = stripLeadingMcpMetaLines(body)
    result = stripped.body
    error = stripped.error
  } else if (result) {
    const stripped = stripLeadingMcpMetaLines(result)
    result = stripped.body
    if (!error && stripped.error) error = stripped.error
  }

  const sections = { tool, params, result, error }
  return {
    ...sections,
    copyText: buildMcpCopyText(sections) || body,
  }
}