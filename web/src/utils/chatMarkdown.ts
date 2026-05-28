const normalizeLineBreaks = (raw: string) => String(raw || '').replace(/\r\n?/g, '\n')

const stripMarkdownInline = (raw: string) => {
  let text = normalizeLineBreaks(raw)

  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')
  text = text.replace(/~~([^~]+)~~/g, '$1')

  return text
}

export const stripMarkdownFormatting = (raw: string) => {
  const text = normalizeLineBreaks(raw).trim()
  if (!text) return ''

  const lines = text.split('\n')
  const output: string[] = []
  let inCodeFence = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      output.push('')
      continue
    }

    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence
      continue
    }

    if (inCodeFence) {
      output.push(line)
      continue
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      output.push(stripMarkdownInline(trimmed.replace(/^#{1,6}\s+/, '')))
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      output.push(stripMarkdownInline(trimmed.replace(/^>\s?/, '')))
      continue
    }

    if (/^([-*_])\1{2,}\s*$/.test(trimmed)) {
      continue
    }

    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(cell => stripMarkdownInline(cell.trim()))
        .filter(Boolean)
      if (cells.length > 0) {
        output.push(cells.join(' | '))
      }
      continue
    }

    const listMatch = trimmed.match(/^(?:[-+*]|\d+\.)\s+(.+)$/)
    if (listMatch) {
      output.push(stripMarkdownInline(listMatch[1] || ''))
      continue
    }

    output.push(stripMarkdownInline(line))
  }

  return output.join('\n').replace(/[ \t]+\n/g, '\n').trim()
}
