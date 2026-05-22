// cards.ts — memory-card parsing, validation and merge helpers.
// A card is a named automation workflow: an ordered list of steps, each a
// browser_* MCP tool call plus a human-readable note (备注).

import { MemoryCard, AutomationStep } from './types'

export const newId = () => 'card_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

// Short fallback note derived from the tool + its most meaningful argument, so
// every step always has a 备注 even when the imported data omits one.
export function deriveNote(tool: string, args: Record<string, any>): string {
  const labels: Record<string, string> = {
    browser_navigate: '跳转页面', browser_wait: '等待', browser_click: '点击',
    browser_double_click: '双击', browser_right_click: '右键', browser_type: '输入内容',
    browser_scroll: '滚动', browser_select: '选择', browser_press_key: '按键',
    browser_drag: '拖拽', browser_hover: '悬停', browser_fill_form: '填写表单',
    browser_search: '搜索', browser_screenshot: '截图', browser_extract: '提取数据',
    browser_get_content: '读取内容', browser_page_info: '查看页面位置',
  }
  const base = labels[tool] || tool.replace(/^browser_/, '')
  const hint = args?.url || args?.text || args?.selector || args?.query
    || (args?.direction ? `${args.direction}${args?.amount ? ' ' + args.amount : ''}` : '')
    || (args?.key ? `按键 ${args.key}` : '')
    || (args?.ms ? `${args.ms}ms` : '')
  return hint ? `${base}：${String(hint).slice(0, 60)}` : base
}

function normalizeStep(raw: any): AutomationStep | null {
  if (!raw || typeof raw !== 'object') return null
  const tool = String(raw.tool || raw.name || '').trim()
  if (!tool) return null
  let args = raw.args ?? raw.arguments ?? raw.input ?? {}
  if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = {} } }
  if (!args || typeof args !== 'object') args = {}
  const note = String(raw.note ?? raw.remark ?? raw.comment ?? raw.备注 ?? '').trim() || deriveNote(tool, args)
  return { tool, args, note }
}

// Accepts a single card object, an array of cards, or a {cards:[...]} wrapper.
// Returns normalized cards with fresh ids and guaranteed per-step notes.
export function parseImport(text: string): MemoryCard[] {
  let data: any
  try { data = JSON.parse(text) } catch { throw new Error('不是有效的 JSON') }

  let rawCards: any[]
  if (Array.isArray(data)) rawCards = data
  else if (data && Array.isArray(data.cards)) rawCards = data.cards
  else if (data && (data.steps || data.name)) rawCards = [data]
  else throw new Error('未找到卡片数据')

  const now = Date.now()
  const out: MemoryCard[] = []
  for (const rc of rawCards) {
    if (!rc || typeof rc !== 'object') continue
    const rawSteps = Array.isArray(rc.steps) ? rc.steps : []
    const steps = rawSteps.map(normalizeStep).filter((s): s is AutomationStep => !!s)
    if (steps.length === 0) continue
    out.push({
      id: newId(),
      name: String(rc.name || '未命名卡片').trim().slice(0, 80),
      description: String(rc.description || '').trim().slice(0, 300),
      steps,
      createdAt: now,
      updatedAt: now,
    })
  }
  if (out.length === 0) throw new Error('卡片中没有可用的步骤')
  return out
}

// Append imported steps onto an existing card (used for the "合并" choice).
export function mergeCards(existing: MemoryCard, incoming: MemoryCard): MemoryCard {
  return {
    ...existing,
    description: existing.description || incoming.description,
    steps: [...existing.steps, ...incoming.steps],
    updatedAt: Date.now(),
  }
}

// Serialize a card for export (drops volatile ids/timestamps for portability).
export function exportCard(card: MemoryCard) {
  return {
    name: card.name,
    description: card.description,
    steps: card.steps.map(s => ({ tool: s.tool, args: s.args, note: s.note })),
  }
}
