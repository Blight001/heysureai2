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
  skipped?: boolean
}

// Background registers this so card_run progress shows in the activity feed/UI,
// for both popup-triggered and AI-triggered runs.
type CardProgressFn = (cardId: string, index: number, total: number, note: string, tool: string, status: string, error?: string) => void
let cardProgress: CardProgressFn | null = null
export function setCardProgress(fn: CardProgressFn) { cardProgress = fn }

function getPath(obj: any, path: string): any {
  return String(path).split('.').reduce((cur, part) => cur == null ? undefined : cur[part], obj)
}

function applyVars(value: any, vars: Record<string, any>): any {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
      const v = getPath(vars, key)
      return v === undefined || v === null ? '' : String(v)
    })
  }
  if (Array.isArray(value)) return value.map(v => applyVars(v, vars))
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = applyVars(v, vars)
    return out
  }
  return value
}

function shouldRunStep(step: AutomationStep, vars: Record<string, any>): boolean {
  const cond = (step as any).if ?? (step.args as any)?.if
  if (cond === undefined || cond === null || cond === '') return true
  if (typeof cond === 'boolean') return cond
  if (typeof cond === 'string') return !!getPath(vars, cond)
  if (typeof cond === 'object') {
    const actual = getPath(vars, String(cond.var || cond.path || ''))
    if ('exists' in cond) return cond.exists ? actual !== undefined : actual === undefined
    if ('equals' in cond) return actual === cond.equals
    if ('not_equals' in cond) return actual !== cond.not_equals
    if ('contains' in cond) return String(actual || '').includes(String(cond.contains))
  }
  return true
}

export async function runCardSteps(
  card: MemoryCard,
  opts: { shouldStop?: () => boolean; variables?: Record<string, any> } = {},
): Promise<{ success: boolean; stopped?: boolean; results: CardStepResult[]; failedStep?: CardStepResult }> {
  const total = card.steps.length
  const results: CardStepResult[] = []
  const vars: Record<string, any> = { ...(opts.variables || {}) }
  for (let i = 0; i < total; i++) {
    if (opts.shouldStop?.()) return { success: false, stopped: true, results }
    const step = card.steps[i]
    if (!shouldRunStep(step, vars)) {
      const skipped: CardStepResult = { index: i, note: step.note, tool: step.tool, status: 'success', skipped: true, preview: 'skipped by condition' }
      results.push(skipped)
      cardProgress?.(card.id, i, total, step.note, step.tool, 'success')
      continue
    }
    if (/^card[_.]/i.test(step.tool)) {
      const r: CardStepResult = { index: i, note: step.note, tool: step.tool, status: 'error', error: '卡片步骤不允许调用卡片工具（避免递归）' }
      results.push(r)
      cardProgress?.(card.id, i, total, step.note, step.tool, 'error', r.error)
      return { success: false, results, failedStep: r }
    }
    cardProgress?.(card.id, i, total, step.note, step.tool, 'running')
    try {
      const args = applyVars(step.args || {}, vars)
      if (step.tool === 'var_set') {
        vars[String(args.name)] = args.value
        results.push({ index: i, note: step.note, tool: step.tool, status: 'success', preview: `${args.name}=${JSON.stringify(args.value)}` })
        cardProgress?.(card.id, i, total, step.note, step.tool, 'success')
        continue
      }
      const result = await executeBrowserOnly(step.tool, args)
      if ((step as any).save_as || args.save_as_var) vars[String((step as any).save_as || args.save_as_var)] = result
      vars.last = result
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
  const res = await runCardSteps(card, { variables: args.variables || args.vars || {} })
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

async function toolCardRunBatch(args: any): Promise<any> {
  const card = byIdOrName(await getCards(), args)
  if (!card) throw new Error('卡片不存在')
  const rows = Array.isArray(args.items) ? args.items : []
  if (!rows.length) throw new Error('items 不能为空')
  const results = []
  for (let i = 0; i < rows.length; i++) {
    const variables = { ...(args.variables || {}), item: rows[i], index: i }
    const res = await runCardSteps(card, { variables })
    results.push({ index: i, success: res.success, completed: res.results.filter(r => r.status === 'success' && !r.skipped).length, failedStep: res.failedStep, results: res.results })
    if (!res.success && args.stop_on_error !== false) break
  }
  return { success: results.every(r => r.success), cardId: card.id, name: card.name, total: rows.length, results }
}

const SCHEDULE_KEY = '_card_schedules'

async function getSchedules(): Promise<any[]> {
  const r = await chrome.storage.local.get(SCHEDULE_KEY)
  return Array.isArray(r[SCHEDULE_KEY]) ? r[SCHEDULE_KEY] : []
}

async function setSchedules(schedules: any[]): Promise<void> {
  await chrome.storage.local.set({ [SCHEDULE_KEY]: schedules })
}

function cronEveryMinutes(cron: string): number | null {
  const m = String(cron || '').trim().match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 ? n : null
}

async function toolCardSchedule(args: any): Promise<any> {
  const card = byIdOrName(await getCards(), args)
  if (!card) throw new Error('卡片不存在')
  const id = String(args.schedule_id || `schedule_${Date.now()}`)
  const interval = args.interval_minutes ? Number(args.interval_minutes) : (args.cron ? cronEveryMinutes(String(args.cron)) : null)
  const runAt = args.run_at ? Date.parse(String(args.run_at)) : 0
  const schedule = {
    id,
    cardId: card.id,
    name: args.name || `${card.name} schedule`,
    cron: args.cron || '',
    intervalMinutes: interval,
    runAt: Number.isFinite(runAt) ? runAt : 0,
    variables: args.variables || {},
    enabled: true,
    createdAt: Date.now(),
    lastRunAt: 0,
  }
  if (!interval && !schedule.runAt) {
    return { success: false, error: { code: 'UNSUPPORTED_CRON', message: 'Only interval_minutes, run_at, or simple cron like "*/15 * * * *" is supported.', suggestion: 'Use interval_minutes for recurring schedules.' } }
  }
  const schedules = (await getSchedules()).filter(s => s.id !== id)
  schedules.push(schedule)
  await setSchedules(schedules)
  const alarmInfo: chrome.alarms.AlarmCreateInfo = interval
    ? { periodInMinutes: interval, delayInMinutes: Math.max(0.1, interval) }
    : { when: schedule.runAt }
  chrome.alarms.create(`card_schedule:${id}`, alarmInfo)
  return { success: true, schedule }
}

async function toolCardScheduleList(): Promise<any> {
  const schedules = await getSchedules()
  return { success: true, count: schedules.length, schedules }
}

async function toolCardScheduleDelete(args: any): Promise<any> {
  const schedules = await getSchedules()
  const kept = schedules.filter(s => s.id !== args.schedule_id && s.id !== args.id)
  const deleted = schedules.length - kept.length
  await setSchedules(kept)
  await chrome.alarms.clear(`card_schedule:${args.schedule_id || args.id}`)
  return { success: true, deleted }
}

export async function runScheduledCard(scheduleId: string): Promise<any> {
  const schedules = await getSchedules()
  const schedule = schedules.find(s => s.id === scheduleId)
  if (!schedule || schedule.enabled === false) return { success: false, reason: 'schedule not found or disabled' }
  const card = (await getCards()).find(c => c.id === schedule.cardId)
  if (!card) return { success: false, reason: 'card not found' }
  const res = await runCardSteps(card, { variables: schedule.variables || {} })
  schedule.lastRunAt = Date.now()
  await setSchedules(schedules)
  return { success: res.success, scheduleId, cardId: card.id, results: res.results, failedStep: res.failedStep }
}

// ── card_* router ────────────────────────────────────────────────────────
export async function executeCardTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'card_list':         return toolCardList()
    case 'card_get':          return toolCardGet(args)
    case 'card_save':         return toolCardSave(args)
    case 'card_update_step':  return toolCardUpdateStep(args)
    case 'card_run':          return toolCardRun(args)
    case 'card_run_batch':    return toolCardRunBatch(args)
    case 'card_schedule':     return toolCardSchedule(args)
    case 'card_schedule_list': return toolCardScheduleList()
    case 'card_schedule_delete': return toolCardScheduleDelete(args)
    case 'card_delete':       return toolCardDelete(args)
    default:
      throw new Error(`Unknown card tool: ${name}`)
  }
}
