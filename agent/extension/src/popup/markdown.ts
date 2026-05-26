// popup/markdown.ts — pure rendering helpers for the chat pane.
// No DOM access, no shared state — every function takes its inputs and returns
// HTML strings. Mirrors the web dashboard's chat rendering so MCP calls,
// reasoning blocks and live phase indicators show up the same way here.

export function esc(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Inline markdown (code spans, links, bold/italic/strike) ──────────────────
export function inlineMd(text: string): string {
  const placeholders: string[] = []
  const stash = (html: string) => {
    const key = `@@HTML_${placeholders.length}@@`
    placeholders.push(html)
    return key
  }
  let out = esc(text)
  out = out.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${esc(code)}</code>`))
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) =>
    stash(`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(label)}</a>`),
  )
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, prefix, url) =>
    `${prefix}${stash(`<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(url)}</a>`)}`,
  )
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
  placeholders.forEach((html, idx) => {
    out = out.replaceAll(`@@HTML_${idx}@@`, html)
  })
  return out
}

// ── Tables (GitHub-flavored | header | --- | body |) ────────────────────────
function isMarkdownTableStart(lines: string[], index: number): boolean {
  const head = lines[index]?.trim() || ''
  const sep = lines[index + 1]?.trim() || ''
  return /^\|.+\|$/.test(head) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(sep)
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function renderMarkdownTable(lines: string[], start: number): { html: string; next: number } {
  const headers = parseTableRow(lines[start])
  let idx = start + 2
  const rows: string[][] = []
  while (idx < lines.length && /^\|.+\|$/.test(lines[idx].trim())) {
    rows.push(parseTableRow(lines[idx]))
    idx++
  }
  const head = headers.map(cell => `<th>${inlineMd(cell)}</th>`).join('')
  const body = rows.map(row => (
    `<tr>${headers.map((_, i) => `<td>${inlineMd(row[i] || '')}</td>`).join('')}</tr>`
  )).join('')
  return {
    html: `<div class="chat-table-wrap"><table class="chat-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: idx,
  }
}

// ── Block-level markdown (headings, lists, fences, quotes, hr, tasks) ───────
export function renderMarkdown(text: string): string {
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!src) return ''
  const blocks: string[] = []
  const parts = src.split(/(```[\s\S]*?```)/g)
  for (const part of parts) {
    if (!part) continue
    const fence = part.match(/^```([\w-]*)\n?([\s\S]*?)```$/)
    if (fence) {
      const lang = fence[1] ? `<div class="chat-mcp-title">${esc(fence[1])}</div>` : ''
      blocks.push(`${lang}<pre>${esc(fence[2].trim())}</pre>`)
      continue
    }

    const lines = part.split('\n')
    let para: string[] = []
    let list: string[] = []
    let ordered = false
    const flushPara = () => {
      if (para.length) {
        blocks.push(`<p>${inlineMd(para.join('\n')).replace(/\n/g, '<br>')}</p>`)
        para = []
      }
    }
    const flushList = () => {
      if (list.length) {
        blocks.push(`<${ordered ? 'ol' : 'ul'}>${list.join('')}</${ordered ? 'ol' : 'ul'}>`)
        list = []
      }
    }
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]
      const trimmed = line.trim()
      if (!trimmed) {
        flushPara()
        flushList()
        continue
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushPara()
        flushList()
        blocks.push('<hr>')
        continue
      }
      if (isMarkdownTableStart(lines, lineIndex)) {
        flushPara()
        flushList()
        const table = renderMarkdownTable(lines, lineIndex)
        blocks.push(table.html)
        lineIndex = table.next - 1
        continue
      }
      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
      if (heading) {
        flushPara()
        flushList()
        const level = Math.min(3, heading[1].length)
        blocks.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`)
        continue
      }
      const quote = trimmed.match(/^>\s+(.+)$/)
      if (quote) {
        flushPara()
        flushList()
        blocks.push(`<blockquote>${inlineMd(quote[1])}</blockquote>`)
        continue
      }
      const task = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/)
      const unordered = trimmed.match(/^[-*]\s+(.+)$/)
      const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/)
      if (task || unordered || orderedMatch) {
        flushPara()
        const nextOrdered = !!orderedMatch
        if (list.length && ordered !== nextOrdered) flushList()
        ordered = nextOrdered
        if (task) {
          const checked = task[1].trim().toLowerCase() === 'x'
          list.push(`<li class="chat-task"><span class="chat-check">${checked ? '✓' : ''}</span>${inlineMd(task[2])}</li>`)
        } else {
          list.push(`<li>${inlineMd((unordered || orderedMatch)![1])}</li>`)
        }
        continue
      }
      flushList()
      para.push(line)
    }
    flushPara()
    flushList()
  }
  return `<div class="chat-md">${blocks.join('')}</div>`
}

function normalizeJsonText(raw: string): string {
  const text = String(raw || '').trim()
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

// ── MCP-call inline detection ───────────────────────────────────────────────
const MCP_CALL_BLOCK_RE = /<mcp[-_]call>\s*([\s\S]*?)\s*<\/\s*(?:mcp[-_]call|[｜|]*\s*DSML\s*[｜|]*\s*(?:invoke|tool[-_]?calls?))\s*>/gi
const MCP_HEADER_LINE_RE = /^(?:#{1,6}\s*)?(\[MCP执行[^\]]*\]|\[工具参数\]|\[工具执行结果\]|系统已执行工具[：:].*|工具(?:名称)?[：:].*|执行状态[：:].*|状态[：:].*|可用工具[：:].*)$/i

interface InlinePart {
  kind: 'text' | 'mcp-block' | 'mcp-snippet'
  content: string
}

// Web-style inline parser: keeps MCP blocks in their natural position within
// the assistant message body, and additionally splits free-text MCP header
// chunks into highlighted bubbles (matching the web's "MCP 操作" treatment).
function splitInlineContent(text: string): { reasoning: string[]; parts: InlinePart[] } {
  let body = String(text || '')
  const reasoning: string[] = []
  body = body.replace(/<think>\s*([\s\S]*?)\s*<\/think>/gi, (_, inner) => {
    reasoning.push(String(inner || '').trim())
    return ''
  })

  const parts: InlinePart[] = []
  const matches: { index: number; length: number; payload: string }[] = []
  for (const m of body.matchAll(MCP_CALL_BLOCK_RE)) {
    matches.push({
      index: m.index ?? 0,
      length: m[0].length,
      payload: normalizeJsonText(String(m[1] || '').trim()),
    })
  }

  matches.sort((a, b) => a.index - b.index)
  let cursor = 0
  for (const m of matches) {
    if (m.index > cursor) {
      const slice = body.slice(cursor, m.index)
      if (slice.trim()) parts.push({ kind: 'text', content: slice })
    }
    parts.push({ kind: 'mcp-block', content: m.payload })
    cursor = m.index + m.length
  }
  if (cursor < body.length) {
    const tail = body.slice(cursor)
    if (tail.trim()) parts.push({ kind: 'text', content: tail })
  }
  if (!parts.length && body.trim()) parts.push({ kind: 'text', content: body })

  // Within text segments, split off free-text MCP header chunks (no proper
  // <mcp-call> wrapper but matching MCP_HEADER_LINE_RE) into their own bubble.
  const refined: InlinePart[] = []
  for (const part of parts) {
    if (part.kind !== 'text') { refined.push(part); continue }
    const lines = part.content.split('\n')
    const headerIdx = lines.findIndex(line => MCP_HEADER_LINE_RE.test(line.trim()))
    if (headerIdx < 0) { refined.push(part); continue }
    const plain = lines.slice(0, headerIdx).join('\n').trimEnd()
    const mcpText = lines.slice(headerIdx).join('\n').trim()
    if (plain) refined.push({ kind: 'text', content: plain })
    if (mcpText) refined.push({ kind: 'mcp-snippet', content: mcpText })
  }
  return { reasoning, parts: refined }
}

// ── Chat content rendering ───────────────────────────────────────────────────
export type ChatLiveEvent = { key: string; label: string; detail?: string }

function renderChatEvent(event: ChatLiveEvent): string {
  return (
    `<div class="chat-mcp-card">` +
    `<div class="chat-mcp-title">${esc(event.label)}</div>` +
    (event.detail ? `<pre class="chat-mcp-pre">${esc(event.detail)}</pre>` : '') +
    `</div>`
  )
}

function renderMcpBlockHtml(payload: string): string {
  return (
    `<div class="chat-mcp-card">` +
    `<div class="chat-mcp-title">🧰 MCP 调用</div>` +
    `<pre class="chat-mcp-pre">${esc(payload)}</pre>` +
    `</div>`
  )
}

function renderMcpSnippetHtml(text: string): string {
  return (
    `<div class="chat-mcp-card">` +
    `<div class="chat-mcp-title">MCP 操作</div>` +
    `<pre class="chat-mcp-pre">${esc(text)}</pre>` +
    `</div>`
  )
}

export function renderChatContent(
  text: string,
  opts: { reasoning?: string; currentTool?: string; loading?: boolean; toolsUsed?: string[] } = {},
): string {
  const { reasoning: inlineReasoning, parts } = splitInlineContent(text)
  const reasoningParts = [opts.reasoning, ...inlineReasoning].map(v => String(v || '').trim()).filter(Boolean)
  const chunks: string[] = []

  // Deep-thinking block sits at the top (matches the web's <details> placement).
  if (reasoningParts.length) {
    chunks.push(
      `<details class="chat-reasoning" ${opts.loading ? 'open' : ''}>` +
      `<summary>深度思考</summary>` +
      `<div class="chat-reasoning-body">${esc(reasoningParts.join('\n\n'))}</div>` +
      `</details>`,
    )
  }

  // Live phase indicator: which MCP tool is being called right now.
  if (opts.currentTool) {
    chunks.push(`<div class="chat-tool-phase">⚙ 等待 MCP: ${esc(opts.currentTool)}</div>`)
  }

  for (const part of parts) {
    if (part.kind === 'text') chunks.push(renderMarkdown(part.content))
    else if (part.kind === 'mcp-block') chunks.push(renderMcpBlockHtml(part.content))
    else chunks.push(renderMcpSnippetHtml(part.content))
  }

  // Compact summary of tools that ran in the local AI-key chat path.
  if (opts.toolsUsed?.length) {
    chunks.push(
      `<div class="chat-mcp-card">` +
      `<div class="chat-mcp-title">🧰 MCP 调用</div>` +
      `<div class="tool-chips">${opts.toolsUsed.map(tool => `<span class="tool-chip">${esc(tool)}</span>`).join('')}</div>` +
      `</div>`,
    )
  }

  if (!chunks.length && opts.loading) {
    chunks.push('<div class="chat-empty-live">思考中...</div><div class="thinking"><span></span><span></span><span></span></div>')
  }
  return chunks.join('')
}

export function renderChatFrame(
  text: string,
  opts: { reasoning?: string; currentTool?: string; loading?: boolean; toolsUsed?: string[]; events?: ChatLiveEvent[] } = {},
): string {
  return [
    ...(opts.events || []).map(renderChatEvent),
    renderChatContent(text, opts),
  ].filter(Boolean).join('')
}
