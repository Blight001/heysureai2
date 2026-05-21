<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  text: string
}>()

const escapeHtml = (raw: string) => String(raw || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const renderInline = (raw: string) => {
  let text = escapeHtml(raw)
  text = text.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return text
}

const isTableSeparator = (line: string) => {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

const splitTableRow = (line: string) => {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())
}

const renderTable = (lines: string[], start: number) => {
  const header = splitTableRow(lines[start])
  const rows: string[][] = []
  let idx = start + 2
  while (idx < lines.length && /^\s*\|/.test(lines[idx] || '')) {
    rows.push(splitTableRow(lines[idx]))
    idx += 1
  }

  const headHtml = header.map(cell => `<th>${renderInline(cell)}</th>`).join('')
  const bodyHtml = rows
    .map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
    .join('')
  return {
    html: `<div class="md-table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
    next: idx,
  }
}

const renderList = (lines: string[], start: number) => {
  const ordered = /^\s*\d+\.\s+/.test(lines[start])
  const tag = ordered ? 'ol' : 'ul'
  const rows: string[] = []
  let idx = start
  const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/
  while (idx < lines.length) {
    const match = lines[idx].match(pattern)
    if (!match) break
    rows.push(`<li>${renderInline(match[1] || '')}</li>`)
    idx += 1
  }
  return { html: `<${tag} class="md-list">${rows.join('')}</${tag}>`, next: idx }
}

const renderBlocks = (raw: string) => {
  const text = String(raw || '').replace(/\r\n?/g, '\n').trim()
  if (!text) return ''

  const lines = text.split('\n')
  const html: string[] = []
  let idx = 0

  while (idx < lines.length) {
    const line = lines[idx]
    const trimmed = line.trim()

    if (!trimmed) {
      idx += 1
      continue
    }

    const fence = trimmed.match(/^```(\w+)?\s*$/)
    if (fence) {
      const codeLines: string[] = []
      idx += 1
      while (idx < lines.length && !/^```\s*$/.test(lines[idx].trim())) {
        codeLines.push(lines[idx])
        idx += 1
      }
      if (idx < lines.length) idx += 1
      html.push(`<pre class="md-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    if (/^---+\s*$/.test(trimmed)) {
      html.push('<hr class="md-hr">')
      idx += 1
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = Math.min(3, heading[1].length)
      html.push(`<div class="md-heading md-heading-${level}">${renderInline(heading[2])}</div>`)
      idx += 1
      continue
    }

    if (
      idx + 1 < lines.length
      && /^\s*\|/.test(line)
      && isTableSeparator(lines[idx + 1])
    ) {
      const table = renderTable(lines, idx)
      html.push(table.html)
      idx = table.next
      continue
    }

    if (/^\s*(?:[-+*]|\d+\.)\s+/.test(line)) {
      const list = renderList(lines, idx)
      html.push(list.html)
      idx = list.next
      continue
    }

    const paragraph: string[] = [line]
    idx += 1
    while (idx < lines.length) {
      const next = lines[idx]
      const nextTrimmed = next.trim()
      if (
        !nextTrimmed
        || /^```/.test(nextTrimmed)
        || /^#{1,6}\s+/.test(nextTrimmed)
        || /^---+\s*$/.test(nextTrimmed)
        || /^\s*(?:[-+*]|\d+\.)\s+/.test(next)
        || (idx + 1 < lines.length && /^\s*\|/.test(next) && isTableSeparator(lines[idx + 1]))
      ) {
        break
      }
      paragraph.push(next)
      idx += 1
    }
    html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`)
  }

  return html.join('')
}

const renderedHtml = computed(() => renderBlocks(props.text))
</script>

<template>
  <div class="markdown-text" v-html="renderedHtml"></div>
</template>

<style scoped>
.markdown-text {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.markdown-text :deep(p) {
  margin: 0;
}

.markdown-text :deep(strong) {
  font-weight: 700;
}

.markdown-text :deep(em) {
  font-style: italic;
}

.markdown-text :deep(.md-heading) {
  margin: 0;
  font-weight: 700;
  line-height: 1.35;
}

.markdown-text :deep(.md-heading-1) {
  font-size: 1rem;
}

.markdown-text :deep(.md-heading-2),
.markdown-text :deep(.md-heading-3) {
  font-size: 0.92rem;
}

.markdown-text :deep(.md-hr) {
  margin: 0;
  border: 0;
  border-top: 1px solid rgba(148, 163, 184, 0.35);
}

.markdown-text :deep(.md-table-wrap) {
  max-width: 100%;
  overflow-x: auto;
  margin: 0;
}

.markdown-text :deep(table) {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.markdown-text :deep(th),
.markdown-text :deep(td) {
  padding: 0.35rem 0.5rem;
  border: 1px solid rgba(148, 163, 184, 0.35);
  text-align: left;
  vertical-align: top;
}

.markdown-text :deep(th) {
  background: rgba(148, 163, 184, 0.16);
  font-weight: 700;
}

.markdown-text :deep(.md-code) {
  max-width: 100%;
  overflow-x: auto;
  margin: 0;
  padding: 0.6rem;
  border-radius: 0.5rem;
  background: rgba(24, 24, 27, 0.08);
  white-space: pre;
  font-size: 0.72rem;
  line-height: 1.45;
}

.dark .markdown-text :deep(.md-code) {
  background: rgba(255, 255, 255, 0.08);
}

.markdown-text :deep(.md-inline-code) {
  padding: 0.05rem 0.25rem;
  border-radius: 0.25rem;
  background: rgba(148, 163, 184, 0.22);
  font-size: 0.86em;
}

.markdown-text :deep(.md-list) {
  margin: 0;
  padding-left: 1.2rem;
}

.markdown-text :deep(li) {
  margin: 0.15rem 0;
}
</style>
