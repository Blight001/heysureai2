// popup/chat.ts — the chat subsystem. Two backends share this UI:
//   • server mode (useServerChat): a logged-in member runs via the server, with
//     polled live updates, persisted sessions and message delete/recall.
//   • local mode: the background worker drives a user-supplied AI key.
// Rendering helpers (markdown / live frames) live in ./markdown.

import { ChatMessage } from '../lib/types'
import { state } from './state'
import * as dom from './dom'
import { sleep, useServerChat, currentAvatarHtml } from './helpers'
import { refreshChatAvailability } from './ui'
import { doLogout } from './members'
import {
  startChatRun, getChatRun, stopChatRun,
  listChatSessions, createChatSession, deleteChatSession,
  fetchChatHistory, deleteServerChatMessage, recallServerChatMessage,
  isAuthError, ServerChatSession,
} from '../lib/client'
import { setChatHistory, getChatHistory, clearChatHistory } from '../lib/storage'
import { esc, renderChatContent, renderChatFrame, ChatLiveEvent } from './markdown'

function syncChatHistory(): Promise<void> {
  // Local-only history is the fallback for the offline / no-server path.
  if (useServerChat()) return Promise.resolve()
  return setChatHistory(state.chatHistory)
}
function clearChatMessages() {
  dom.chatMsgs.querySelectorAll('.chat-msg').forEach(e => e.remove())
}
function chatContentToText(content: ChatMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}
function makeChatRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
function rowActionsHtml(role: 'user' | 'ai', supportsRecall: boolean): string {
  const isUser = role === 'user'
  const buttons: string[] = [
    '<button class="chat-action-btn" type="button" data-chat-action="copy" title="复制">复制</button>',
  ]
  if (isUser && supportsRecall) {
    buttons.push('<button class="chat-action-btn" type="button" data-chat-action="revoke" title="撤回此消息及之后所有对话">撤回</button>')
  }
  buttons.push('<button class="chat-action-btn danger" type="button" data-chat-action="delete" title="删除此消息">删除</button>')
  return `<div class="chat-msg-actions" aria-label="消息操作">${buttons.join('')}</div>`
}
export function appendChatMsg(role: 'user' | 'ai', content: string, historyIndex?: number): HTMLElement {
  dom.chatNoKey.style.display = 'none'
  const el = document.createElement('div')
  el.className = `chat-msg ${role}`
  if (historyIndex !== undefined) el.dataset.historyIndex = String(historyIndex)
  const supportsRecall = role === 'user'
  const avatar = role === 'ai' ? '✨' : currentAvatarHtml('👤')
  el.innerHTML = `<div class="chat-avatar">${avatar}</div>`
    + `<div class="chat-bubble">${rowActionsHtml(role, supportsRecall)}${renderChatContent(content)}</div>`
  dom.chatMsgs.appendChild(el)
  dom.chatMsgs.scrollTop = dom.chatMsgs.scrollHeight
  return el
}
export function renderChatHistory() {
  clearChatMessages()
  if (!state.chatHistory.length) {
    refreshChatAvailability()
    return
  }
  state.chatHistory.forEach((msg, index) => {
    const role = msg.role === 'assistant' ? 'ai' : 'user'
    const el = appendChatMsg(role, chatContentToText(msg.content), index)
    if (msg.serverId !== undefined) el.dataset.serverId = String(msg.serverId)
  })
  refreshChatAvailability()
}
function showThinking(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'chat-msg ai'
  el.id = 'thinking'
  el.innerHTML = `<div class="chat-avatar">✨</div><div class="chat-bubble"><div class="thinking"><span></span><span></span><span></span></div></div>`
  dom.chatMsgs.appendChild(el)
  dom.chatMsgs.scrollTop = dom.chatMsgs.scrollHeight
  return el
}
export function setBubble(el: HTMLElement, html: string) {
  const bubble = el.querySelector('.chat-bubble')
  if (bubble) bubble.innerHTML = html
  dom.chatMsgs.scrollTop = dom.chatMsgs.scrollHeight
}
export function setChatBusy(busy: boolean) {
  state.chatBusy = busy
  refreshChatAvailability()
}

export async function restoreChatHistory() {
  // Only restore local history when no server backing is active. The server
  // history fetch path will replace it once the user logs in + selects a member.
  if (useServerChat()) return
  state.chatHistory = await getChatHistory()
  renderChatHistory()
}

function defaultSessionIdForMember(): string {
  return `ext-${state.selectedMemberId}`
}

function isExtensionSession(name: string): boolean {
  return /^浏览器插件(?:会话| 对话)/.test(String(name || '').trim())
}

function pickPreferredSessionId(items: ServerChatSession[]): string {
  if (!items.length) return ''
  const ext = items.find(item => isExtensionSession(item.name))
  return (ext || items[0]).id
}

export function updateChatSessionControls() {
  if (!useServerChat()) {
    dom.chatSessionSelect.classList.add('hidden')
    dom.chatSessionDeleteBtn.style.display = 'none'
    dom.chatClearBtn.textContent = '清空'
    dom.chatClearBtn.title = '清空本地对话记录'
    return
  }
  dom.chatClearBtn.textContent = '新建对话'
  dom.chatClearBtn.title = '在服务器上新建一段对话（保留当前历史）'
  if (state.serverSessions.length === 0) {
    dom.chatSessionSelect.classList.add('hidden')
    dom.chatSessionDeleteBtn.style.display = 'none'
    return
  }
  // Re-render the select options.
  dom.chatSessionSelect.innerHTML = state.serverSessions
    .map(s => `<option value="${esc(s.id)}"${s.id === state.currentServerSessionId ? ' selected' : ''}>${esc(s.name)}</option>`)
    .join('')
  dom.chatSessionSelect.classList.remove('hidden')
  dom.chatSessionDeleteBtn.style.display = state.serverSessions.length > 1 ? 'block' : 'none'
}

function chatMessageFromServer(row: any): ChatMessage | null {
  const role = String(row?.role || '')
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return null
  const content = String(row?.content || '')
  const think = String(row?.think || '')
  const merged = think ? `<think>${think}</think>${content}` : content
  return {
    role: role as ChatMessage['role'],
    content: merged,
    serverId: typeof row?.id === 'number' ? row.id : undefined,
    think: think || undefined,
    createdAt: typeof row?.created_at === 'number' ? row.created_at : undefined,
  }
}

async function loadServerChatHistory(sessionId: string): Promise<boolean> {
  if (!useServerChat() || !sessionId) return false
  if (state.chatHistoryLoading) return false
  state.chatHistoryLoading = true
  try {
    const rows = await fetchChatHistory(state.serverUrl, state.auth.token, sessionId, state.selectedMemberId)
    state.chatHistory = rows.map(chatMessageFromServer).filter((m): m is ChatMessage => m !== null)
    state.lastSyncedMessageId = state.chatHistory.reduce(
      (max, m) => (m.serverId && m.serverId > max ? m.serverId : max),
      0,
    )
    renderChatHistory()
    return true
  } catch (err: any) {
    if (isAuthError(err)) {
      await doLogout()
      return false
    }
    console.warn('loadServerChatHistory failed', err)
    return false
  } finally {
    state.chatHistoryLoading = false
  }
}

export async function refreshServerSessionsAndHistory(targetSessionId?: string): Promise<void> {
  if (!useServerChat()) return
  try {
    state.serverSessions = await listChatSessions(state.serverUrl, state.auth.token, state.selectedMemberId)
  } catch (err: any) {
    if (isAuthError(err)) {
      await doLogout()
      return
    }
    console.warn('listChatSessions failed', err)
    state.serverSessions = []
  }
  // If no session yet for this member, create a default one so users always
  // land on a real server session that will persist.
  if (!state.serverSessions.length) {
    try {
      const created = await createChatSession(state.serverUrl, state.auth.token, '浏览器插件会话', state.selectedMemberId)
      state.serverSessions = [created]
    } catch (err) {
      console.warn('createChatSession failed', err)
    }
  }
  const preferred = targetSessionId && state.serverSessions.some(s => s.id === targetSessionId)
    ? targetSessionId
    : (state.currentServerSessionId && state.serverSessions.some(s => s.id === state.currentServerSessionId)
        ? state.currentServerSessionId
        : pickPreferredSessionId(state.serverSessions))
  state.currentServerSessionId = preferred
  updateChatSessionControls()
  if (preferred) await loadServerChatHistory(preferred)
  else { state.chatHistory = []; renderChatHistory() }
}

async function syncIncrementalServerHistory(): Promise<void> {
  if (!useServerChat() || !state.currentServerSessionId) return
  try {
    const rows = await fetchChatHistory(state.serverUrl, state.auth.token, state.currentServerSessionId, state.selectedMemberId)
    const incoming: ChatMessage[] = []
    let maxId = state.lastSyncedMessageId
    for (const row of rows) {
      const msg = chatMessageFromServer(row)
      if (!msg) continue
      if (msg.serverId !== undefined && msg.serverId <= state.lastSyncedMessageId) continue
      incoming.push(msg)
      if (msg.serverId !== undefined && msg.serverId > maxId) maxId = msg.serverId
    }
    if (!incoming.length) return
    // Drop any local-only assistant placeholder with matching content; replace
    // with the server-backed message so the action buttons have a real id.
    for (const msg of incoming) {
      if (msg.role !== 'assistant') continue
      const idx = state.chatHistory.findIndex(item =>
        item.serverId === undefined
        && item.role === 'assistant'
        && chatContentToText(item.content).trim() === chatContentToText(msg.content).trim())
      if (idx >= 0) state.chatHistory.splice(idx, 1)
    }
    state.chatHistory.push(...incoming)
    state.lastSyncedMessageId = maxId
    renderChatHistory()
  } catch (err) {
    console.warn('syncIncrementalServerHistory failed', err)
  }
}

async function clearConversation() {
  if (state.chatBusy) stopPendingChatUi()
  if (useServerChat()) {
    // Server mode: "新建对话" creates a fresh session, leaving old history intact.
    try {
      const name = `浏览器插件会话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
      const created = await createChatSession(state.serverUrl, state.auth.token, name, state.selectedMemberId)
      state.chatHistory = []
      state.lastSyncedMessageId = 0
      renderChatHistory()
      await refreshServerSessionsAndHistory(created.id)
    } catch (err: any) {
      console.warn('createChatSession failed', err)
      alert(`新建对话失败：${err?.message || err}`)
    }
    return
  }
  state.chatHistory = []
  await clearChatHistory()
  renderChatHistory()
}

async function deleteCurrentServerSession() {
  if (!useServerChat() || !state.currentServerSessionId) return
  if (state.serverSessions.length <= 1) return
  const target = state.serverSessions.find(s => s.id === state.currentServerSessionId)
  if (!target) return
  if (!confirm(`确定删除会话「${target.name}」？此操作不可恢复。`)) return
  try {
    await deleteChatSession(state.serverUrl, state.auth.token, state.currentServerSessionId, state.selectedMemberId)
    state.currentServerSessionId = ''
    await refreshServerSessionsAndHistory()
  } catch (err: any) {
    alert(`删除会话失败：${err?.message || err}`)
  }
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

function stopPendingChatUi() {
  state.activeChatRequestId = null
  const thinking = (window as any)._chatThinking as HTMLElement | undefined
  thinking?.remove()
  ;(window as any)._chatThinking = null
  const liveThinking = document.getElementById('thinking')
  liveThinking?.remove()
  if (state.activeRunId && state.auth.token) {
    void stopChatRun(state.serverUrl, state.auth.token, state.activeRunId).catch(() => {})
  }
  state.activeRunId = null
  setChatBusy(false)
}

async function deleteChatMessage(index: number) {
  const msg = state.chatHistory[index]
  if (!msg) return
  const lastUserIndex = state.chatHistory.map(m => m.role).lastIndexOf('user')
  if (state.chatBusy && index === lastUserIndex) stopPendingChatUi()
  if (useServerChat() && msg.serverId !== undefined) {
    if (!confirm('确定要删除这条消息吗？')) return
    try {
      await deleteServerChatMessage(state.serverUrl, state.auth.token, msg.serverId)
    } catch (err: any) {
      alert(`删除失败：${err?.message || err}`)
      return
    }
  }
  state.chatHistory.splice(index, 1)
  await syncChatHistory()
  renderChatHistory()
}

async function revokeChatMessage(index: number) {
  const msg = state.chatHistory[index]
  if (!msg || msg.role !== 'user') return
  const text = chatContentToText(msg.content)
  if (state.chatBusy) stopPendingChatUi()
  if (useServerChat() && msg.serverId !== undefined) {
    if (!confirm('确定撤回此消息？将删除它之后的对话。')) return
    try {
      const result = await recallServerChatMessage(state.serverUrl, state.auth.token, msg.serverId)
      dom.chatInput.value = result?.recall_content || text
    } catch (err: any) {
      alert(`撤回失败：${err?.message || err}`)
      return
    }
    state.chatHistory.splice(index)
    // Re-sync max id so we don't double-add anything.
    state.lastSyncedMessageId = state.chatHistory.reduce(
      (max, m) => (m.serverId && m.serverId > max ? m.serverId : max),
      0,
    )
  } else {
    state.chatHistory.splice(index)
    dom.chatInput.value = text
  }
  await syncChatHistory()
  renderChatHistory()
  dom.chatInput.style.height = 'auto'
  dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 120) + 'px'
  refreshChatAvailability()
  dom.chatInput.focus()
}

async function runServerChat(text: string, thinking: HTMLElement) {
  if (!state.currentServerSessionId) {
    await refreshServerSessionsAndHistory()
  }
  const sessionId = state.currentServerSessionId || defaultSessionIdForMember()
  const sessionName = state.serverSessions.find(s => s.id === sessionId)?.name || '浏览器插件会话'
  const { run_id } = await startChatRun(state.serverUrl, state.auth.token, state.selectedMemberId!, sessionId, text, sessionName)
  state.activeRunId = run_id
  let after = 0
  let lastText = ''
  let lastReasoning = ''
  let lastPhaseKey = ''
  const liveEvents: ChatLiveEvent[] = []
  const MAX_POLLS = 600 // ~8 min at 800ms
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(800)
    let st
  try { st = await getChatRun(state.serverUrl, state.auth.token, run_id, after) } catch { continue }
    lastReasoning = String(st.live_reasoning || lastReasoning || '')
    const phase = String(st.live_phase || '')
    const currentTool = String(st.current_tool || '')
    if (currentTool && phase === 'waiting_mcp') {
      const key = `${phase}:${currentTool}:${liveEvents.length}`
      if (lastPhaseKey !== `${phase}:${currentTool}`) {
        liveEvents.push({
          key,
          label: 'MCP 调用中',
          detail: currentTool,
        })
        lastPhaseKey = `${phase}:${currentTool}`
      }
    } else if (phase && phase !== 'waiting_mcp') {
      lastPhaseKey = `${phase}:${currentTool}`
    }
    if (st.live_text && st.live_text !== lastText) {
      lastText = st.live_text
      after = st.live_len
      setBubble(thinking, renderChatFrame(lastText, {
        reasoning: lastReasoning,
        currentTool,
        loading: true,
        events: liveEvents,
      }))
    } else if (lastReasoning || currentTool || liveEvents.length) {
      setBubble(thinking, renderChatFrame(lastText, {
        reasoning: lastReasoning,
        currentTool,
        loading: true,
        events: liveEvents,
      }))
    }
    if (['completed', 'error', 'stopped'].includes(st.status)) {
      state.activeRunId = null
      if (st.status === 'error') return { text: `⚠ 错误: ${st.error_message || '执行失败'}`, reasoning: lastReasoning, events: liveEvents, ok: false }
      if (st.status === 'stopped') return { text: lastText || '（已停止）', reasoning: lastReasoning, events: liveEvents, ok: true }
      return { text: lastText || '完成', reasoning: lastReasoning, events: liveEvents, ok: true }
    }
  }
  state.activeRunId = null
  return { text: lastText || '（超时，未收到完整回复）', reasoning: lastReasoning, events: liveEvents, ok: false }
}

async function sendChat() {
  const enabled = useServerChat() || state.hasAiKey
  if (state.chatBusy || !enabled) return
  const text = dom.chatInput.value.trim()
  if (!text) return
  dom.chatInput.value = ''
  dom.chatInput.style.height = 'auto'

  // Optimistic local echo for the user's message. In server mode the
  // authoritative copy (with server id) will arrive via the post-run sync.
  state.chatHistory.push({ role: 'user', content: text })
  appendChatMsg('user', text, state.chatHistory.length - 1)
  void syncChatHistory()
  const thinking = showThinking()
  const requestId = makeChatRequestId()
  state.activeChatRequestId = requestId
  setChatBusy(true)

  if (useServerChat()) {
    try {
      const res = await runServerChat(text, thinking)
      if (state.activeChatRequestId !== requestId) return
      setBubble(thinking, renderChatFrame(res.text, { reasoning: res.reasoning, events: res.events }))
      thinking.removeAttribute('id')
      // Replace the optimistic local pair with the server-backed history.
      // Drop the trailing optimistic user message so the sync logic can
      // overlay the server's persisted copies (with ids for delete/recall).
      const lastIdx = state.chatHistory.length - 1
      if (lastIdx >= 0 && state.chatHistory[lastIdx].serverId === undefined && state.chatHistory[lastIdx].role === 'user') {
        state.chatHistory.splice(lastIdx, 1)
      }
      await syncIncrementalServerHistory()
    } catch (err: any) {
      if (state.activeChatRequestId !== requestId) return
      const errorText = `⚠ 错误: ${err?.message || err}`
      setBubble(thinking, renderChatContent(errorText))
      thinking.removeAttribute('id')
      // Best-effort: pull whatever the server persisted (the user message at least).
      await syncIncrementalServerHistory()
    } finally {
      if (state.activeChatRequestId === requestId) {
        state.activeChatRequestId = null
        setChatBusy(false)
      }
    }
  } else {
    // Local AI-key chat via background worker
    ;(window as any)._chatThinking = thinking
    state.port.postMessage({ type: 'chat:send', messages: state.chatHistory, requestId })
  }
}

// Exposed so the background port handler can append assistant replies.
export { syncChatHistory }

export function wireChat() {
  dom.chatMsgs.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chat-action-btn')
    if (!btn) return
    e.preventDefault()
    e.stopPropagation()
    const msgEl = btn.closest<HTMLElement>('.chat-msg')
    const index = Number(msgEl?.dataset.historyIndex)
    if (!Number.isInteger(index) || !state.chatHistory[index]) return
    const action = btn.dataset.chatAction
    if (action === 'copy') {
      const originalText = btn.textContent
      void writeClipboardText(chatContentToText(state.chatHistory[index].content)).then(() => {
        btn.textContent = '已复制'
        setTimeout(() => { btn.textContent = originalText || '复制' }, 900)
      })
    } else if (action === 'revoke') {
      void revokeChatMessage(index)
    } else if (action === 'delete') {
      void deleteChatMessage(index)
    }
  })

  dom.chatClearBtn.addEventListener('click', () => void clearConversation())
  dom.chatSessionDeleteBtn.addEventListener('click', () => void deleteCurrentServerSession())
  dom.chatSessionSelect.addEventListener('change', () => {
    const next = dom.chatSessionSelect.value
    if (!next || next === state.currentServerSessionId) return
    state.currentServerSessionId = next
    state.lastSyncedMessageId = 0
    void loadServerChatHistory(next)
  })
  dom.chatSendBtn.addEventListener('click', () => void sendChat())
  dom.chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat() }
  })
  dom.chatInput.addEventListener('input', () => {
    dom.chatInput.style.height = 'auto'
    dom.chatInput.style.height = Math.min(dom.chatInput.scrollHeight, 120) + 'px'
  })
}
