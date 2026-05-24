// tools/cards.ts — memory-card tools (card_*) + the shared runCardSteps engine.
// Cards are reusable automation workflows: an ordered list of browser_* steps
// with 备注 per step. Card tools intentionally cannot call other card tools
// (avoids recursion); runCardSteps only dispatches via executeBrowserOnly.

import { MemoryCard, AutomationStep } from '../types'
import { getCards, setCards } from '../storage'
import { newId, deriveNote } from '../cards'
import { executeBrowserOnly } from './browser'

// ── Card execution + progress reporting ──────────────────────────────────
export interface CardStepResult {
  index:   number
  note:    string
  tool:    string
  status:  'success' | 'error'
  preview?: string
  error?:   string
}

// Background registers this so card_run progress shows in the activity feed/UI,
// for both popup-triggered and AI-triggered runs.
type CardProgressFn = (cardId: string, index: number, total: number, note: string, tool: string, status: string, error?: string) => void
let cardProgress: CardProgressFn | null = null
export function setCardProgress(fn: CardProgressFn) { cardProgress = fn }

export async function runCardSteps(
  card: MemoryCard,
  opts: { shouldStop?: () => boolean } = {},
): Promise<{ success: boolean; stopped?: boolean; results: CardStepResult[]; failedStep?: CardStepResult }> {
  const total = card.steps.length
  const results: CardStepResult[] = []
  for (let i = 0; i < total; i++) {
    if (opts.shouldStop?.()) return { success: false, stopped: true, results }
    const step = card.steps[i]
    if (/^card[_.]/i.test(step.tool)) {
      const r: CardStepResult = { index: i, note: step.note, tool: step.tool, status: 'error', error: '卡片步骤不允许调用卡片工具（避免递归）' }
      results.push(r)
      cardProgress?.(card.id, i, total, step.note, step.tool, 'error', r.error)
      return { success: false, results, failedStep: r }
    }
    cardProgress?.(card.id, i, total, step.note, step.tool, 'running')
    try {
      const result = await executeBrowserOnly(step.tool, step.args || {})
      let preview = ''
      try { preview = (typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 180) } catch { /* ignore */ }
      results.push({ index: i, note: step.note, tool: step.tool, status: 'success', preview })
      cardProgress?.(card.id, i, total, step.note, step.tool, 'success')
    } catch (err: any) {
      const msg = err?.message || String(err)
      const r: CardStepResult = { index: i, note: step.note, tool: step.tool, status: 'error', error: msg }
      results.push(r)
      cardProgress?.(card.id, i, total, step.note, step.tool, 'error', msg)
      return { success: false, results, failedStep: r }
    }
  }
  return { success: true, results }
}

// ── card_* tool implementations ──────────────────────────────────────────
function byIdOrName(cards: MemoryCard[], args: any): MemoryCard | undefined {
  if (args?.id) return cards.find(c => c.id === String(args.id))
  if (args?.name) return cards.find(c => c.name === String(args.name))
  return undefined
}

function normalizeSteps(rawSteps: any): AutomationStep[] {
  const out: AutomationStep[] = []
  for (const rs of (Array.isArray(rawSteps) ? rawSteps : [])) {
    if (!rs || typeof rs !== 'object') continue
    const tool = String(rs.tool || rs.name || '').trim()
    if (!tool) continue
    let a = rs.args ?? rs.arguments ?? rs.input ?? {}
    if (typeof a === 'string') { try { a = JSON.parse(a) } catch { a = {} } }
    if (!a || typeof a !== 'object') a = {}
    const note = String(rs.note ?? rs.remark ?? '').trim() || deriveNote(tool, a)
    out.push({ tool, args: a, note })
  }
  return out
}

async function toolCardList(): Promise<any> {
  const cards = await getCards()
  return { success: true, count: cards.length, cards: cards.map(c => ({ id: c.id, name: c.name, description: c.description, steps: c.steps.length })) }
}

async function toolCardGet(args: any): Promise<any> {
  const card = byIdOrName(await getCards(), args)
  if (!card) throw new Error('卡片不存在')
  return { success: true, card: { id: card.id, name: card.name, description: card.description, steps: card.steps } }
}

async function toolCardSave(args: any): Promise<any> {
  const name = String(args.name || '').trim()
  if (!name) throw new Error('name 必填')
  const steps = normalizeSteps(args.steps)
  if (!steps.length) throw new Error('steps 不能为空')
  const mode = ['replace', 'merge', 'new'].includes(args.mode) ? args.mode : 'replace'
  const cards = await getCards()
  const now = Date.now()
  const existing = cards.find(c => c.name === name)
  if (existing && mode !== 'new') {
    existing.steps = mode === 'merge' ? [...existing.steps, ...steps] : steps
    if (args.description !== undefined) existing.description = String(args.description || '')
    existing.updatedAt = now
    await setCards(cards)
    return { success: true, action: mode, id: existing.id, name, steps: existing.steps.length }
  }
  const card: MemoryCard = { id: newId(), name, description: String(args.description || ''), steps, createdAt: now, updatedAt: now }
  cards.push(card)
  await setCards(cards)
  return { success: true, action: 'created', id: card.id, name, steps: steps.length }
}

async function toolCardUpdateStep(args: any): Promise<any> {
  const cards = await getCards()
  const card = byIdOrName(cards, args)
  if (!card) throw new Error('卡片不存在')
  const idx = Number(args.index)
  if (!(idx >= 0 && idx < card.steps.length)) throw new Error(`index 越界（卡片有 ${card.steps.length} 步）`)
  const step = card.steps[idx]
  if (args.tool !== undefined) step.tool = String(args.tool)
  if (args.note !== undefined) step.note = String(args.note)
  if (args.args !== undefined) {
    let a = args.args
    if (typeof a === 'string') { try { a = JSON.parse(a) } catch { /* keep */ } }
    if (a && typeof a === 'object') step.args = a
  }
  card.updatedAt = Date.now()
  await setCards(cards)
  return { success: true, id: card.id, index: idx, step }
}

async function toolCardDelete(args: any): Promise<any> {
  const cards = await getCards()
  const card = byIdOrName(cards, args)
  if (!card) throw new Error('卡片不存在')
  await setCards(cards.filter(c => c.id !== card.id))
  return { success: true, id: card.id, name: card.name }
}

async function toolCardRun(args: any): Promise<any> {
  const card = byIdOrName(await getCards(), args)
  if (!card) throw new Error('卡片不存在')
  const res = await runCardSteps(card)
  return {
    success: res.success,
    cardId: card.id,
    name: card.name,
    total: card.steps.length,
    completed: res.results.filter(r => r.status === 'success').length,
    failedStep: res.failedStep,
    results: res.results,
  }
}

// ── card_* router ────────────────────────────────────────────────────────
export async function executeCardTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'card_list':         return toolCardList()
    case 'card_get':          return toolCardGet(args)
    case 'card_save':         return toolCardSave(args)
    case 'card_update_step':  return toolCardUpdateStep(args)
    case 'card_run':          return toolCardRun(args)
    case 'card_delete':       return toolCardDelete(args)
    default:
      throw new Error(`Unknown card tool: ${name}`)
  }
}
