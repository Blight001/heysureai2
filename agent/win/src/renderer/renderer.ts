// renderer.ts — HeySure Agent renderer process

declare const window: Window & {
  heysureAPI: {
    getSettings: () => Promise<any>
    saveSettings: (s: any) => Promise<any>
    connect: () => Promise<void>
    disconnect: () => Promise<void>
    getStatus: () => Promise<string>
    onStatusChange: (cb: (status: string, reason?: string) => void) => void
    onActivityLog: (cb: (entry: any) => void) => void
    onTaskStart: (cb: (data: any) => void) => void
    onTaskResult: (cb: (data: any) => void) => void
    setTheme: (theme: 'dark' | 'light') => Promise<void>
    testConnection: () => Promise<{ success: boolean; status?: number; ms?: number; error?: string }>
    sendChat: (messages: any[]) => Promise<string>
    version: string
  }
}

// ── State ──────────────────────────────────────────────────────────────────
let currentTheme: 'dark' | 'light' = 'dark'
let totalTasks = 0
let successTasks = 0
let failedTasks = 0
let runningTasks = 0
let chatHistory: Array<{ role: string; content: string }> = []
let chatBusy = false
let hasAiKey = false
let activeTab: 'feed' | 'chat' = 'feed'

// ── DOM refs ───────────────────────────────────────────────────────────────
const feed            = document.getElementById('feed')!
const feedEmpty       = document.getElementById('feed-empty')!
const feedPane        = document.getElementById('feed-pane')!
const chatPane        = document.getElementById('chat-pane')!
const chatMessages    = document.getElementById('chat-messages')!
const chatNoKey       = document.getElementById('chat-no-key')!
const chatInput       = document.getElementById('chat-input') as HTMLTextAreaElement
const chatSendBtn     = document.getElementById('chat-send') as HTMLButtonElement
const tabFeed         = document.getElementById('tab-feed')!
const tabChat         = document.getElementById('tab-chat')!
const statusDot       = document.getElementById('status-dot')!
const statusLabel     = document.getElementById('status-label')!
const infoStatus      = document.getElementById('info-status')!
const infoName        = document.getElementById('info-name')!
const infoServer      = document.getElementById('info-server')!
const infoWorkspace   = document.getElementById('info-workspace')!
const statTasks       = document.getElementById('stat-tasks')!
const statSuccess     = document.getElementById('stat-success')!
const statFailed      = document.getElementById('stat-failed')!
const statRunning     = document.getElementById('stat-running')!
const cfgAiKey        = document.getElementById('cfg-ai-key') as HTMLInputElement
const cfgAiBaseUrl    = document.getElementById('cfg-ai-base-url') as HTMLInputElement
const cfgAiModel      = document.getElementById('cfg-ai-model') as HTMLInputElement
const cfgServer       = document.getElementById('cfg-server') as HTMLInputElement
const cfgToken        = document.getElementById('cfg-token') as HTMLInputElement
const cfgName         = document.getElementById('cfg-name') as HTMLInputElement
const cfgId           = document.getElementById('cfg-id') as HTMLInputElement
const cfgGroup        = document.getElementById('cfg-group') as HTMLInputElement
const cfgWorkspace    = document.getElementById('cfg-workspace') as HTMLInputElement
const saveBtn         = document.getElementById('save-btn')!
const saveFeedback    = document.getElementById('save-feedback')!
const connectBtn      = document.getElementById('connect-btn')!
const disconnectBtn   = document.getElementById('disconnect-btn')!
const clearBtn        = document.getElementById('clear-btn')!
const themeToggle     = document.getElementById('theme-toggle')!
const testConnBtn     = document.getElementById('test-conn-btn')!
const testResult      = document.getElementById('test-result')!

// ── Status labels ──────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接',
  connecting:   '连接中...',
  connected:    '已连接',
  registered:   '已注册',
  error:        '连接错误',
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab: 'feed' | 'chat') {
  activeTab = tab
  if (tab === 'feed') {
    tabFeed.classList.add('active')
    tabChat.classList.remove('active')
    feedPane.classList.remove('hidden')
    chatPane.classList.remove('active')
  } else {
    tabChat.classList.add('active')
    tabFeed.classList.remove('active')
    feedPane.classList.add('hidden')
    chatPane.classList.add('active')
    chatMessages.scrollTop = chatMessages.scrollHeight
  }
}

tabFeed.addEventListener('click', () => switchTab('feed'))
tabChat.addEventListener('click', () => switchTab('chat'))

// ── Status display ─────────────────────────────────────────────────────────
function setStatus(status: string, _reason?: string) {
  const label = STATUS_LABELS[status] || status
  statusDot.className = status
  statusLabel.textContent = label
  infoStatus.textContent = label
  infoStatus.className = `info-value ${status}`
}

// ── Stats ──────────────────────────────────────────────────────────────────
function updateStats() {
  statTasks.textContent   = String(totalTasks)
  statSuccess.textContent = String(successTasks)
  statFailed.textContent  = String(failedTasks)
  statRunning.textContent = String(runningTasks)
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatTime(ts: number): string {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    success: '✓', error: '✗', running: '▶', warn: '⚠', system: '●',
  }
  return icons[status] || 'ℹ'
}

function iconClass(status: string, type: string): string {
  if (status === 'success') return 'success'
  if (status === 'error')   return 'error'
  if (status === 'running') return 'running'
  if (status === 'warn')    return 'warn'
  if (type === 'system')    return 'system'
  return 'info'
}

function badgeClass(type: string): string {
  const map: Record<string, string> = { task: 'task', system: 'system', error: 'error', warn: 'warn' }
  return map[type] || 'info'
}

// ── Activity feed ──────────────────────────────────────────────────────────
function addEntry(entry: {
  id?: string; type: string; status: string; message: string; data?: any; timestamp: number
}) {
  feedEmpty.style.display = 'none'
  const el = document.createElement('div')
  el.className = 'entry'
  el.dataset.id = entry.id || ''

  const ic = iconClass(entry.status, entry.type)
  const bc = badgeClass(entry.type)
  const hasData = entry.data !== undefined && entry.data !== null

  let dataHtml = ''
  if (hasData) {
    const dataStr = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)
    dataHtml = `
      <button class="entry-data-toggle" onclick="toggleData(this)">
        <span class="arrow">&#x25B6;</span> 详情
      </button>
      <div class="entry-data"><pre>${escapeHtml(dataStr)}</pre></div>`
  }

  let badgeHtml = ''
  if (entry.status === 'success' || entry.status === 'error' || entry.status === 'running') {
    const bLabel = entry.status === 'success' ? '成功' : entry.status === 'error' ? '失败' : '进行中'
    badgeHtml = `<span class="entry-status-badge ${entry.status}">${bLabel}</span>`
  }

  el.innerHTML = `
    <div class="entry-icon ${ic}">${statusIcon(entry.status)}</div>
    <div class="entry-body">
      <div class="entry-top">
        <span class="entry-type ${bc}">${entry.type}</span>
        <span class="entry-time">${formatTime(entry.timestamp)}</span>
      </div>
      <div class="entry-message">${escapeHtml(entry.message)}</div>
      ${badgeHtml}${dataHtml}
    </div>`

  feed.appendChild(el)
  feed.scrollTop = feed.scrollHeight
}

;(window as any).toggleData = function(btn: HTMLButtonElement) {
  btn.classList.toggle('open')
  const dataEl = btn.nextElementSibling as HTMLElement
  if (dataEl) dataEl.classList.toggle('visible')
}

// ── Chat UI ────────────────────────────────────────────────────────────────
function renderMd(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

function appendChatMsg(role: 'user' | 'ai', content: string): HTMLElement {
  chatNoKey.style.display = 'none'
  const el = document.createElement('div')
  el.className = `chat-msg ${role}`
  const avatar = role === 'ai' ? '&#x2728;' : '&#x1F464;'
  el.innerHTML = `
    <div class="chat-avatar">${avatar}</div>
    <div class="chat-bubble">${renderMd(content)}</div>`
  chatMessages.appendChild(el)
  chatMessages.scrollTop = chatMessages.scrollHeight
  return el
}

function appendThinking(): HTMLElement {
  chatNoKey.style.display = 'none'
  const el = document.createElement('div')
  el.className = 'chat-msg ai'
  el.id = 'chat-thinking'
  el.innerHTML = `
    <div class="chat-avatar">&#x2728;</div>
    <div class="chat-bubble">
      <div class="chat-thinking">
        <div class="chat-thinking-dot"></div>
        <div class="chat-thinking-dot"></div>
        <div class="chat-thinking-dot"></div>
      </div>
    </div>`
  chatMessages.appendChild(el)
  chatMessages.scrollTop = chatMessages.scrollHeight
  return el
}

function updateChatKeyVisibility() {
  if (hasAiKey) {
    chatNoKey.style.display = 'none'
    chatInput.disabled = false
    chatSendBtn.disabled = false
  } else if (chatHistory.length === 0) {
    chatNoKey.style.display = 'flex'
    chatInput.disabled = true
    chatSendBtn.disabled = true
  }
}

async function sendChat() {
  if (chatBusy || !hasAiKey) return
  const text = chatInput.value.trim()
  if (!text) return

  chatInput.value = ''
  chatInput.style.height = 'auto'
  chatBusy = true
  chatSendBtn.disabled = true

  chatHistory.push({ role: 'user', content: text })
  appendChatMsg('user', text)
  const thinkEl = appendThinking()

  try {
    const reply = await window.heysureAPI.sendChat(chatHistory)
    thinkEl.remove()
    chatHistory.push({ role: 'assistant', content: reply })
    appendChatMsg('ai', reply)
  } catch (err: any) {
    thinkEl.remove()
    appendChatMsg('ai', `⚠ 错误: ${err.message || String(err)}`)
  } finally {
    chatBusy = false
    chatSendBtn.disabled = false
    chatInput.focus()
  }
}

chatSendBtn.addEventListener('click', sendChat)

chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChat()
  }
})

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 110) + 'px'
})

// ── Test connection ────────────────────────────────────────────────────────
testConnBtn.addEventListener('click', async () => {
  testResult.textContent = '测试中...'
  testResult.className = 'test-result'
  testConnBtn.setAttribute('disabled', 'true')
  try {
    const r = await window.heysureAPI.testConnection()
    if (r.success) {
      testResult.textContent = `✓ 连接成功 (${r.status}) · ${r.ms}ms`
      testResult.className = 'test-result success'
    } else {
      testResult.textContent = `✗ ${r.error}`
      testResult.className = 'test-result error'
    }
  } catch (err: any) {
    testResult.textContent = `✗ ${err.message}`
    testResult.className = 'test-result error'
  } finally {
    testConnBtn.removeAttribute('disabled')
  }
})

// ── Settings ───────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await window.heysureAPI.getSettings()
    cfgServer.value    = s.serverUrl    || ''
    cfgToken.value     = s.agentToken   || ''
    cfgName.value      = s.agentName    || ''
    cfgId.value        = s.agentId      || ''
    cfgGroup.value     = s.agentGroup   || ''
    cfgWorkspace.value = s.workspaceRoot || ''
    cfgAiKey.value     = s.aiKey        || ''
    cfgAiBaseUrl.value = s.aiBaseUrl    || ''
    cfgAiModel.value   = s.aiModel      || ''

    infoName.textContent   = s.agentName    || '—'
    infoServer.textContent = s.serverUrl    || '—'
    infoWorkspace.textContent = s.workspaceRoot
      ? (s.workspaceRoot.split(/[/\\]/).pop() || s.workspaceRoot)
      : '—'

    hasAiKey = !!(s.aiKey && s.aiKey.trim())
    updateChatKeyVisibility()

    if (s.theme) {
      currentTheme = s.theme
      applyTheme(currentTheme, false)
    }
  } catch (err) {
    console.error('Failed to load settings', err)
  }
}

async function saveSettings() {
  const settings = {
    serverUrl:     cfgServer.value.trim(),
    agentToken:    cfgToken.value,
    agentName:     cfgName.value.trim(),
    agentId:       cfgId.value.trim(),
    agentGroup:    cfgGroup.value.trim(),
    workspaceRoot: cfgWorkspace.value.trim(),
    aiKey:         cfgAiKey.value.trim(),
    aiBaseUrl:     cfgAiBaseUrl.value.trim() || 'https://api.anthropic.com',
    aiModel:       cfgAiModel.value.trim()   || 'claude-sonnet-4-5',
  }
  try {
    await window.heysureAPI.saveSettings(settings)
    infoName.textContent   = settings.agentName || '—'
    infoServer.textContent = settings.serverUrl || '—'
    infoWorkspace.textContent = settings.workspaceRoot
      ? (settings.workspaceRoot.split(/[/\\]/).pop() || settings.workspaceRoot)
      : '—'

    hasAiKey = !!(settings.aiKey)
    updateChatKeyVisibility()

    saveFeedback.style.color = ''
    saveFeedback.textContent = '已保存 ✓'
    setTimeout(() => { saveFeedback.textContent = '' }, 2000)
  } catch (err) {
    saveFeedback.textContent = '保存失败'
    saveFeedback.style.color = 'var(--error)'
    setTimeout(() => { saveFeedback.textContent = ''; saveFeedback.style.color = '' }, 3000)
  }
}

saveBtn.addEventListener('click', saveSettings)

// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme(theme: 'dark' | 'light', persist = true) {
  document.body.className = theme
  themeToggle.innerHTML = theme === 'dark' ? '&#x2600;&#xFE0F;' : '&#x1F319;'
  if (persist) window.heysureAPI.setTheme(theme)
}

themeToggle.addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
  applyTheme(currentTheme)
})

// ── Connect / Disconnect ───────────────────────────────────────────────────
connectBtn.addEventListener('click', () => window.heysureAPI.connect())
disconnectBtn.addEventListener('click', () => window.heysureAPI.disconnect())

clearBtn.addEventListener('click', () => {
  feed.querySelectorAll('.entry').forEach(e => e.remove())
  feedEmpty.style.display = 'flex'
  totalTasks = 0; successTasks = 0; failedTasks = 0; runningTasks = 0
  updateStats()
})

// ── IPC listeners ──────────────────────────────────────────────────────────
window.heysureAPI.onStatusChange((status, reason) => setStatus(status, reason))

window.heysureAPI.onActivityLog((entry) => addEntry(entry))

window.heysureAPI.onTaskStart((data) => {
  totalTasks++; runningTasks++; updateStats()
  addEntry({
    id: data.taskId, type: 'task', status: 'running',
    message: `执行工具: ${data.tool}`,
    data: data.args && Object.keys(data.args).length > 0 ? data.args : undefined,
    timestamp: data.timestamp || Date.now(),
  })
})

window.heysureAPI.onTaskResult((data) => {
  runningTasks = Math.max(0, runningTasks - 1)
  if (data.success) { successTasks++ } else { failedTasks++ }
  updateStats()
  addEntry({
    id: data.taskId + '_result', type: 'task',
    status: data.success ? 'success' : 'error',
    message: `${data.success ? '完成' : '失败'}: ${data.tool}`,
    data: data.result ?? undefined,
    timestamp: data.timestamp || Date.now(),
  })
})

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings()
  const status = await window.heysureAPI.getStatus()
  setStatus(status)
  updateStats()
}

init().catch(console.error)
