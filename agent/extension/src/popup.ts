// popup.ts — HeySure Agent popup UI logic

import { AgentStatus, AgentSettings, ActivityEntry, ChatMessage, BgMsg } from './lib/types'

// ── State ──────────────────────────────────────────────────────────────────
let currentTheme: 'dark' | 'light' = 'dark'
let activeTab: 'feed' | 'chat' | 'settings' = 'feed'
let currentStatus: AgentStatus = 'disconnected'
let chatHistory: ChatMessage[] = []
let chatBusy = false
let hasAiKey = false
let port: chrome.runtime.Port

// ── Status labels ──────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接', connecting: '连接中...', connected: '已连接',
  registered: '已注册', error: '连接错误',
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!
const statusDot    = $('status-dot')
const statusLabel  = $('status-label')
const themeToggle  = $('theme-toggle')
const tabFeed      = $('tab-feed')
const tabChat      = $('tab-chat')
const tabSettings  = $('tab-settings')
const feedPane     = $('feed-pane')
const chatPane     = $('chat-pane')
const settingsPane = $('settings-pane')
const feed         = $('feed')
const feedEmpty    = $('feed-empty')
const chatMsgs     = $('chat-messages')
const chatNoKey    = $('chat-no-key')
const chatInput    = $('chat-input') as HTMLTextAreaElement
const chatSendBtn  = $('chat-send') as HTMLButtonElement
const connectBtn   = $('connect-btn')
const disconnectBtn = $('disconnect-btn')
const clearBtn     = $('clear-btn')
const testConnBtn  = $('test-conn-btn')
const testResult   = $('test-result')
const saveFeedback = $('save-feedback')
const cfgServer    = $('cfg-server')  as HTMLInputElement
const cfgToken     = $('cfg-token')   as HTMLInputElement
const cfgName      = $('cfg-name')    as HTMLInputElement
const cfgId        = $('cfg-id')      as HTMLInputElement
const cfgGroup     = $('cfg-group')   as HTMLInputElement
const cfgAiKey     = $('cfg-ai-key')  as HTMLInputElement
const cfgAiBase    = $('cfg-ai-base') as HTMLInputElement
const cfgAiModel   = $('cfg-ai-model') as HTMLInputElement
const cfgAutoConn  = $('cfg-auto-connect') as HTMLInputElement

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab: 'feed' | 'chat' | 'settings') {
  activeTab = tab
  ;[feedPane, chatPane, settingsPane].forEach(p => p.classList.add('hidden'))
  ;[tabFeed, tabChat, tabSettings].forEach(b => b.classList.remove('active'))
  if (tab === 'feed') { feedPane.classList.remove('hidden'); tabFeed.classList.add('active') }
  if (tab === 'chat') { chatPane.classList.remove('hidden'); tabChat.classList.add('active'); chatMsgs.scrollTop = chatMsgs.scrollHeight }
  if (tab === 'settings') { settingsPane.classList.remove('hidden'); tabSettings.classList.add('active') }
}

tabFeed.addEventListener('click', () => switchTab('feed'))
tabChat.addEventListener('click', () => switchTab('chat'))
tabSettings.addEventListener('click', () => switchTab('settings'))

// ── Status display ─────────────────────────────────────────────────────────
function setStatus(status: AgentStatus) {
  currentStatus = status
  const label = STATUS_LABELS[status] || status
  statusDot.className    = `status-dot ${status}`
  statusLabel.textContent = label
}

// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme(theme: 'dark' | 'light', persist = true) {
  currentTheme = theme
  document.body.className = theme
  themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙'
  if (persist) port.postMessage({ type: 'settings:save', payload: { theme } })
}

themeToggle.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'))

// ── Activity feed ──────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function fmt(ts: number): string {
  return new Date(ts).toTimeString().slice(0,8)
}

const ICON: Record<string,string> = { success:'✓', error:'✗', running:'▶', warn:'⚠', system:'●', info:'ℹ', human:'?' }
const IC_CLS: Record<string,string> = { success:'success', error:'error', running:'running', warn:'warn', system:'system', info:'info', human:'warn' }

function addEntry(e: ActivityEntry) {
  feedEmpty.style.display = 'none'
  const ic  = IC_CLS[e.status] || IC_CLS[e.type] || 'info'
  const hasData = e.data !== undefined && e.data !== null
  let datHtml = ''
  if (hasData) {
    const ds = typeof e.data === 'string' ? e.data : (() => { try { return JSON.stringify(e.data, null, 2) } catch { return String(e.data) } })()
    datHtml = `<button class="toggle-btn" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('show')"><span>▶</span> 详情</button><div class="data-block"><pre>${esc(ds.slice(0,2000))}</pre></div>`
  }
  const el = document.createElement('div')
  el.className = 'entry'
  el.innerHTML = `
    <div class="entry-icon ${ic}">${ICON[e.status] || ICON[e.type] || 'ℹ'}</div>
    <div class="entry-body">
      <div class="entry-top"><span class="entry-badge ${e.type}">${e.type}</span><span class="entry-time">${fmt(e.timestamp)}</span></div>
      <div class="entry-msg">${esc(e.message)}</div>${datHtml}
    </div>`
  feed.appendChild(el)
  feed.scrollTop = feed.scrollHeight
}

clearBtn.addEventListener('click', () => {
  feed.querySelectorAll('.entry').forEach(e => e.remove())
  feedEmpty.style.display = 'flex'
})

// ── Chat ───────────────────────────────────────────────────────────────────
function mdToHtml(text: string): string {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

function appendChatMsg(role: 'user'|'ai', content: string): void {
  chatNoKey.style.display = 'none'
  const el = document.createElement('div')
  el.className = `chat-msg ${role}`
  el.innerHTML = `<div class="chat-avatar">${role==='ai'?'✨':'👤'}</div><div class="chat-bubble">${mdToHtml(content)}</div>`
  chatMsgs.appendChild(el)
  chatMsgs.scrollTop = chatMsgs.scrollHeight
}

function showThinking(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'chat-msg ai'
  el.id = 'thinking'
  el.innerHTML = `<div class="chat-avatar">✨</div><div class="chat-bubble"><div class="thinking"><span></span><span></span><span></span></div></div>`
  chatMsgs.appendChild(el)
  chatMsgs.scrollTop = chatMsgs.scrollHeight
  return el
}

function setChatBusy(busy: boolean) {
  chatBusy = busy
  chatSendBtn.disabled = busy || !hasAiKey
  chatInput.disabled   = busy
}

async function sendChat() {
  if (chatBusy || !hasAiKey) return
  const text = chatInput.value.trim()
  if (!text) return
  chatInput.value = ''
  chatInput.style.height = 'auto'

  chatHistory.push({ role: 'user', content: text })
  appendChatMsg('user', text)
  const thinking = showThinking()
  setChatBusy(true)

  port.postMessage({ type: 'chat:send', messages: chatHistory })
  // Response comes via port.onMessage → handled in port listener below
  ;(window as any)._chatThinking = thinking
}

chatSendBtn.addEventListener('click', sendChat)
chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() }
})
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px'
})

// ── Settings ───────────────────────────────────────────────────────────────
function loadSettings(s: AgentSettings) {
  cfgServer.value   = s.serverUrl   || ''
  cfgToken.value    = s.agentToken  || ''
  cfgName.value     = s.agentName   || ''
  cfgId.value       = s.agentId     || ''
  cfgGroup.value    = s.agentGroup  || ''
  cfgAiKey.value    = s.aiKey       || ''
  cfgAiBase.value   = s.aiBaseUrl   || ''
  cfgAiModel.value  = s.aiModel     || ''
  cfgAutoConn.checked = !!s.autoConnect
  hasAiKey = !!(s.aiKey?.trim())
  if (!hasAiKey) { chatNoKey.style.display = 'flex'; chatInput.disabled = true; chatSendBtn.disabled = true }
  else           { chatNoKey.style.display = 'none'; chatInput.disabled = false; chatSendBtn.disabled = false }
  applyTheme(s.theme || 'dark', false)
}

$('save-btn')!.addEventListener('click', () => {
  const payload: Partial<AgentSettings> = {
    serverUrl:   cfgServer.value.trim(),
    agentToken:  cfgToken.value,
    agentName:   cfgName.value.trim(),
    agentId:     cfgId.value.trim(),
    agentGroup:  cfgGroup.value.trim(),
    aiKey:       cfgAiKey.value.trim(),
    aiBaseUrl:   cfgAiBase.value.trim() || 'https://api.anthropic.com',
    aiModel:     cfgAiModel.value.trim() || 'claude-sonnet-4-5',
    autoConnect: cfgAutoConn.checked,
  }
  port.postMessage({ type: 'settings:save', payload })
  hasAiKey = !!(payload.aiKey)
  saveFeedback.textContent = '已保存 ✓'
  saveFeedback.style.color = 'var(--success)'
  setTimeout(() => { saveFeedback.textContent = '' }, 2000)
})

// ── Test connection ────────────────────────────────────────────────────────
testConnBtn.addEventListener('click', () => {
  testResult.textContent = '测试中...'
  testResult.className = 'test-result'
  port.postMessage({ type: 'connection:test' })
})

// ── Connect / Disconnect ───────────────────────────────────────────────────
connectBtn.addEventListener('click', () => port.postMessage({ type: 'agent:connect' }))
disconnectBtn.addEventListener('click', () => port.postMessage({ type: 'agent:disconnect' }))

// ── Port & background messages ────────────────────────────────────────────
function initPort() {
  port = chrome.runtime.connect({ name: 'popup' })

  port.onMessage.addListener((msg: BgMsg) => {
    switch (msg.type) {
      case 'agent:status':
        setStatus(msg.status)
        break
      case 'activity:log':
        addEntry(msg.entry)
        break
      case 'task:start':
        addEntry({ id: msg.data.taskId, type: 'task', status: 'running', message: `执行: ${msg.data.tool}`, data: msg.data.args, timestamp: msg.data.timestamp })
        break
      case 'task:result':
        addEntry({ id: msg.data.taskId + '_r', type: 'task', status: msg.data.success ? 'success' : 'error', message: `${msg.data.success?'完成':'失败'}: ${msg.data.tool}`, data: msg.data.result, timestamp: msg.data.timestamp })
        break
      case 'settings:data':
        loadSettings(msg.settings)
        break
      case 'chat:response': {
        const thinking = (window as any)._chatThinking as HTMLElement | undefined
        thinking?.remove()
        setChatBusy(false)
        const reply = msg.text || '完成'
        chatHistory.push({ role: 'assistant', content: reply })
        appendChatMsg('ai', reply)
        if (msg.toolsUsed?.length) {
          addEntry({ id: Date.now().toString(), type: 'task', status: 'success', message: `AI 使用工具: ${msg.toolsUsed.join(', ')}`, timestamp: Date.now() })
        }
        break
      }
      case 'chat:error': {
        const thinking = (window as any)._chatThinking as HTMLElement | undefined
        thinking?.remove()
        setChatBusy(false)
        appendChatMsg('ai', `⚠ 错误: ${msg.error}`)
        break
      }
      case 'connection:result': {
        const r = msg.result
        testResult.textContent = r.success ? `✓ ${r.status} · ${r.ms}ms` : `✗ ${r.error}`
        testResult.className   = `test-result ${r.success ? 'ok' : 'fail'}`
        break
      }
    }
  })

  port.onDisconnect.addListener(() => {
    // Service worker was stopped — re-connect port after short delay
    setTimeout(initPort, 1000)
  })

  // Request initial settings
  port.postMessage({ type: 'settings:get' })
}

// ── Check for pending chat text (from context menu) ───────────────────────
chrome.storage.session.get('_pendingChat').then(r => {
  if (r._pendingChat) {
    chrome.storage.session.remove('_pendingChat')
    switchTab('chat')
    chatInput.value = String(r._pendingChat)
  }
}).catch(() => {})

// ── Init ───────────────────────────────────────────────────────────────────
initPort()
