// popup/cards.ts — memory cards (reusable automation workflows): list, run,
// view steps, export, delete and import (with merge/replace/skip on conflict).
// Card execution itself runs in the background worker; here we drive the UI and
// reflect progress reported back over the port.

import { MemoryCard } from '../lib/types'
import { state } from './state'
import * as dom from './dom'
import { getCards, setCards, deleteCard } from '../lib/storage'
import { parseImport, mergeCards, exportCard } from '../lib/cards'
import { esc } from './markdown'

function argSummary(args: any): string {
  try { const s = JSON.stringify(args); return s && s !== '{}' ? s.slice(0, 90) : '' } catch { return '' }
}
function renderSteps(c: MemoryCard): string {
  const rows = c.steps.map((s, i) => `
    <div class="step-row" id="step-${c.id}-${i}">
      <div class="step-idx">${i + 1}</div>
      <div class="step-body">
        <div class="step-note">${esc(s.note)}</div>
        <div class="step-tool">${esc(s.tool)} ${esc(argSummary(s.args))}</div>
      </div>
    </div>`).join('')
  return `<div class="card-steps">${rows}</div>`
}
export async function renderCards() {
  state.cards = await getCards()
  dom.cardsList.querySelectorAll('.card-item').forEach(e => e.remove())
  if (!state.cards.length) { dom.cardsEmpty.style.display = 'block'; return }
  dom.cardsEmpty.style.display = 'none'
  for (const c of state.cards) {
    const expanded = c.id === state.expandedCardId
    const el = document.createElement('div')
    el.className = 'card-item' + (c.id === state.runningCardId ? ' running' : '')
    el.innerHTML = `
      <div class="card-item-top">
        <span class="card-item-name">${esc(c.name)}</span>
        <span class="card-item-meta">${c.steps.length} 步</span>
      </div>
      ${c.description ? `<div class="card-item-desc">${esc(c.description)}</div>` : ''}
      <div class="card-item-actions">
        ${c.id === state.runningCardId
          ? `<button class="mini-btn danger" data-act="stop">停止</button>`
          : `<button class="mini-btn" data-act="run">▶ 执行</button>`}
        <button class="mini-btn" data-act="view">${expanded ? '收起' : '查看'}</button>
        <button class="mini-btn" data-act="export">导出</button>
        <button class="mini-btn danger" data-act="delete">删除</button>
      </div>
      ${expanded ? renderSteps(c) : ''}`
    el.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => void onCardAction(c.id, (btn as HTMLElement).dataset.act!))
    })
    dom.cardsList.appendChild(el)
  }
}
async function onCardAction(id: string, act: string) {
  const card = state.cards.find(c => c.id === id)
  if (!card) return
  switch (act) {
    case 'run':
      if (state.runningCardId) { dom.cardsRunStatus.textContent = '已有卡片在执行，请先停止'; return }
      state.runningCardId = id
      state.expandedCardId = id
      dom.cardsRunStatus.textContent = `开始执行：${card.name}`
      state.port.postMessage({ type: 'card:run', cardId: id })
      await renderCards()
      break
    case 'stop':
      state.port.postMessage({ type: 'card:stop' })
      break
    case 'view':
      state.expandedCardId = state.expandedCardId === id ? null : id
      await renderCards()
      break
    case 'export':
      exportDownload(`${card.name || 'card'}.json`, exportCard(card))
      break
    case 'delete':
      if (confirm(`确定删除卡片「${card.name}」？此操作不可恢复。`)) {
        await deleteCard(id)
        if (state.expandedCardId === id) state.expandedCardId = null
        await renderCards()
      }
      break
  }
}
function exportDownload(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.replace(/[^\w.\-一-龥]+/g, '_')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
// Prompt the user how to handle a same-named card on import.
function askMergeChoice(name: string): Promise<'merge' | 'replace' | 'skip'> {
  return new Promise(resolve => {
    dom.cardModalMsg.textContent = `卡片「${name}」已存在，是否合并步骤？合并会把导入的步骤追加到现有卡片末尾。`
    dom.cardModal.classList.remove('hidden')
    const done = (r: 'merge' | 'replace' | 'skip') => {
      dom.cardModal.classList.add('hidden')
      dom.cmMerge.onclick = dom.cmReplace.onclick = dom.cmSkip.onclick = null
      resolve(r)
    }
    dom.cmMerge.onclick = () => done('merge')
    dom.cmReplace.onclick = () => done('replace')
    dom.cmSkip.onclick = () => done('skip')
  })
}
async function doImportText(text: string) {
  if (!text) { dom.cardsImportFeedback.textContent = '请粘贴卡片 JSON 或选择文件'; dom.cardsImportFeedback.style.color = 'var(--error)'; return }
  let incoming: MemoryCard[]
  try { incoming = parseImport(text) } catch (e: any) {
    dom.cardsImportFeedback.textContent = `导入失败：${e?.message || e}`
    dom.cardsImportFeedback.style.color = 'var(--error)'
    return
  }
  state.cards = await getCards()
  let added = 0, merged = 0, replaced = 0, skipped = 0
  for (const inc of incoming) {
    const existing = state.cards.find(c => c.name === inc.name)
    if (existing) {
      const choice = await askMergeChoice(inc.name)
      if (choice === 'skip') { skipped++; continue }
      const idx = state.cards.findIndex(c => c.id === existing.id)
      if (choice === 'merge') { state.cards[idx] = mergeCards(existing, inc); merged++ }
      else { state.cards[idx] = { ...inc, id: existing.id, createdAt: existing.createdAt }; replaced++ }
    } else {
      state.cards.push(inc); added++
    }
  }
  await setCards(state.cards)
  dom.cardsImportText.value = ''
  dom.cardsImportFeedback.textContent = `完成：新增 ${added}，合并 ${merged}，替换 ${replaced}，跳过 ${skipped}`
  dom.cardsImportFeedback.style.color = 'var(--success)'
  await renderCards()
}

export function wireCards() {
  dom.cardsImportBtn.addEventListener('click', () => dom.cardsImportBox.classList.toggle('hidden'))
  dom.cardsImportConfirm.addEventListener('click', () => void doImportText(dom.cardsImportText.value.trim()))
  dom.cardsImportFileBtn.addEventListener('click', () => dom.cardsImportFile.click())
  dom.cardsImportFile.addEventListener('change', async () => {
    const f = dom.cardsImportFile.files?.[0]
    if (!f) return
    const text = await f.text()
    dom.cardsImportFile.value = ''
    dom.cardsImportBox.classList.remove('hidden')
    await doImportText(text)
  })
  dom.cardsExportAllBtn.addEventListener('click', async () => {
    state.cards = await getCards()
    if (!state.cards.length) { dom.cardsRunStatus.textContent = '没有可导出的卡片'; return }
    exportDownload('heysure-cards.json', { cards: state.cards.map(exportCard) })
  })
}
