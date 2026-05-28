// popup/index.ts — HeySure Agent popup UI entry.
// Two modes (both retained):
//   1. Browser-Agent: socket connection managed by the background worker.
//   2. Software-end client: logged-in account → AI members, chat, task scheduling.
// Chat / markdown rendering helpers live in ./markdown.

import { AgentStatus, AgentSettings, ActivityEntry, ChatMessage, BgMsg, MemoryCard } from '../lib/types'
import { getAuth, saveAuth, clearAuth, getSettings, saveSettings, getCards, setCards, deleteCard, getChatHistory, setChatHistory, clearChatHistory, AuthState } from '../lib/storage'
import { parseImport, mergeCards, exportCard } from '../lib/cards'
import {
  login as apiLogin, getMe, listConfigs,
  startChatRun, getChatRun, stopChatRun,
  triggerTask, listTaskJobs, taskJobAction,
  listChatSessions, createChatSession, deleteChatSession,
  fetchChatHistory, deleteServerChatMessage, recallServerChatMessage,
  MemberConfig, TaskJob, ServerChatSession,
} from '../lib/client'
import {
  esc, renderChatContent, renderChatFrame, ChatLiveEvent,
} from './markdown'

// ── State ──────────────────────────────────────────────────────────────────
let currentTheme: 'dark' | 'light' = 'dark'
type TabName = 'chat' | 'tasks' | 'cards' | 'settings'
let activeTab: TabName = 'chat'
let currentStatus: AgentStatus = 'disconnected'
let chatHistory: ChatMessage[] = []
let chatBusy = false
let hasAiKey = false
let port: chrome.runtime.Port
let activeChatRequestId: string | null = null

let serverUrl = ''
let offlineMode = false
let localModel = ''
let auth: AuthState = { token: '', account: '', userId: null, userName: '', avatar: '' }
let members: MemberConfig[] = []
let selectedMemberId: number | null = null
let activeRunId: string | null = null
let cards: MemoryCard[] = []
let expandedCardId: string | null = null
let runningCardId: string | null = null

// Server-backed chat history. Populated only when useServerChat() is true.
let serverSessions: ServerChatSession[] = []
let currentServerSessionId: string = ''
let lastSyncedMessageId = 0
let chatHistoryLoading = false

// ── Status labels ──────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接', connecting: '连接中...', connected: '已连接',
  registered: '已注册到服务器', error: '连接错误',
}
const ROLE_LABELS: Record<string, string> = {
  assistant_admin: '辅助管理员', manager: '管理者', member: '普通成员',
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!
const statusDot    = $('status-dot')
const statusLabel  = $('status-label')
const statusPill   = $('status-pill')
const themeToggle  = $('theme-toggle')
const userChip     = $('user-chip')
const userAva      = $('user-ava')
const userName     = $('user-name')

const tabs: Record<TabName, HTMLElement> = {
  chat: $('tab-chat'),
  tasks: $('tab-tasks'), cards: $('tab-cards'), settings: $('tab-settings'),
}
const panes: Record<TabName, HTMLElement> = {
  chat: $('chat-pane'),
  tasks: $('task-pane'), cards: $('cards-pane'), settings: $('settings-pane'),
}

const feed         = $('feed')
const feedEmpty    = $('feed-empty')
const chatMsgs     = $('chat-messages')
const chatNoKey    = $('chat-no-key')
const chatInput    = $('chat-input') as HTMLTextAreaElement
const chatSendBtn  = $('chat-send') as HTMLButtonElement
const chatTarget   = $('chat-target')
const chatTargetText = $('chat-target-text')
const chatClearBtn = $('chat-clear-btn') as HTMLButtonElement
const chatSessionSelect = $('chat-session-select') as HTMLSelectElement
const chatSessionDeleteBtn = $('chat-session-delete-btn') as HTMLButtonElement
const connectBtn   = $('connect-btn')
const disconnectBtn = $('disconnect-btn')
const clearBtn     = $('clear-btn')
const testConnBtn  = $('test-conn-btn')
const testResult   = $('test-result')
const saveFeedback = $('save-feedback')
const cfgServer    = $('cfg-server')  as HTMLInputElement
const cfgAgentServer = $('cfg-agent-server') as HTMLInputElement
const cfgAiKey     = $('cfg-ai-key')  as HTMLInputElement
const cfgAiBase    = $('cfg-ai-base') as HTMLInputElement
const cfgAiModel   = $('cfg-ai-model') as HTMLInputElement
const cfgAutoConn  = $('cfg-auto-connect') as HTMLInputElement
const cfgOfflineMode = $('cfg-offline-mode') as HTMLInputElement
const offlineModelConfig = $('offline-model-config')
const cfgAiProvider  = $('cfg-ai-provider') as HTMLSelectElement
const cfgMouseFx     = $('cfg-mouse-fx') as HTMLInputElement

// Members
const loginGate    = $('login-gate')
const loginModal   = $('login-modal')
const loginModalClose = $('login-modal-close')
const membersModal = $('members-modal')
const membersModalClose = $('members-modal-close')
const accountCard  = $('account-card')
const loginAccount = $('login-account') as HTMLInputElement
const loginPassword = $('login-password') as HTMLInputElement
const loginBtn     = $('login-btn') as HTMLButtonElement
const loginFeedback = $('login-feedback')
const membersRefresh = $('members-refresh')
const membersList  = $('members-list')
const membersEmpty = $('members-empty')

// Tasks
const taskTarget   = $('task-target')
const taskForm     = $('task-form')
const taskTitle    = $('task-title') as HTMLInputElement
const taskInstruction = $('task-instruction') as HTMLTextAreaElement
const taskPriority = $('task-priority') as HTMLInputElement
const taskSchedEnabled = $('task-schedule-enabled') as HTMLInputElement
const taskSchedOpts = $('task-schedule-opts')
const taskLoop     = $('task-loop-enabled') as HTMLInputElement
const taskRunNow   = $('task-run-immediately') as HTMLInputElement
const taskDuration = $('task-duration') as HTMLInputElement
const taskAt       = $('task-at') as HTMLInputElement
const taskSubmit   = $('task-submit') as HTMLButtonElement
const taskFeedback = $('task-feedback')
const taskJobsCard = $('task-jobs-card')
const jobsRefresh  = $('jobs-refresh')
const jobsList     = $('jobs-list')
const jobsEmpty    = $('jobs-empty')

// Settings extra
const accountStatusV = $('account-status-v')
const logoutBtn    = $('logout-btn') as HTMLButtonElement
const memberSettingsCard = $('member-settings-card')
const connectionControlCard = $('connection-control-card')
const memberSettingsBody = $('member-settings-body')

// Cards
const cardsImportBtn    = $('cards-import-btn')
const cardsExportAllBtn = $('cards-export-all-btn')
const cardsImportBox    = $('cards-import-box')
const cardsImportText   = $('cards-import-text') as HTMLTextAreaElement
const cardsImportFileBtn = $('cards-import-file-btn')
const cardsImportFile   = $('cards-import-file') as HTMLInputElement
const cardsImportConfirm = $('cards-import-confirm')
const cardsImportFeedback = $('cards-import-feedback')
const cardsRunStatus    = $('cards-run-status')
const cardsList         = $('cards-list')
const cardsEmpty        = $('cards-empty')
const cardModal         = $('card-modal')
const cardModalMsg      = $('card-modal-msg')
const cmMerge           = $('cm-merge')
const cmReplace         = $('cm-replace')
const cmSkip            = $('cm-skip')

// ── Helpers ──────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function fmt(ts: number): string { return new Date(ts).toTimeString().slice(0,8) }
function roleOf(m: MemberConfig): string {
  if (m.ai_role === 'assistant_admin') return 'assistant_admin'
  return m.digital_member_role === 'manager' ? 'manager' : 'member'
}
function memberById(id: number | null): MemberConfig | undefined {
  return members.find(m => m.id === id)
}
function normalizeAvatarUrl(avatar?: string): string {
  const raw = String(avatar || '').trim()
  if (!raw) return ''
  const local = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i)
  if (local) return chrome.runtime.getURL(`avatars/avatars${local[1]}.png`)
  if (/^(https?:|data:|blob:|chrome-extension:)/i.test(raw)) return raw
  if (raw.startsWith('/')) return serverUrl ? `${serverUrl.replace(/\/+$/, '')}${raw}` : raw
  return raw
}
function avatarHtml(src: string, fallback: string): string {
  const safeSrc = normalizeAvatarUrl(src)
  return safeSrc
    ? `<img src="${esc(safeSrc)}" alt="" />`
    : esc(fallback)
}
function toolCount(m: MemberConfig): number {
  try { const a = JSON.parse(m.mcp_tools || '[]'); return Array.isArray(a) ? a.length : 0 } catch { return 0 }
}
function getConnectedAiShortLabel(): string {
  const name = String(memberById(selectedMemberId)?.name || auth.userName || auth.account || 'AI').trim()
  const shortName = Array.from(name).slice(0, 2).join('') || 'AI'
  return `${shortName}...`
}
function hasBrowserMcpPermission(m: MemberConfig): boolean {
  if (m.mcp_enabled === false) return false
  try {
    const parsed = JSON.parse(m.mcp_tools || '[]')
    if (!Array.isArray(parsed)) return false
    return parsed.some(tool => {
      const name = String(tool || '').trim()
      return name.startsWith('browser_') || name.startsWith('card_')
    })
  } catch {
    return false
  }
}

function syncSelectedAiToBackground(force = false) {
  if (!selectedMemberId) return
  if (!auth.token && !force) return
  if (!memberById(selectedMemberId)) return
  port.postMessage({ type: 'agent:selected-ai', aiConfigId: selectedMemberId })
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab: TabName) {
  activeTab = tab
  ;(Object.keys(panes) as TabName[]).forEach(k => panes[k].classList.add('hidden'))
  ;(Object.keys(tabs) as TabName[]).forEach(k => tabs[k].classList.remove('active'))
  panes[tab].classList.remove('hidden')
  tabs[tab].classList.add('active')
  if (tab === 'chat') {
    chatMsgs.scrollTop = chatMsgs.scrollHeight
    if (useServerChat()) void refreshServerSessionsAndHistory()
  }
  if (tab === 'settings' && auth.token && members.length === 0) void loadMembers()
  if (tab === 'tasks' && selectedMemberId && auth.token) void loadJobs()
  if (tab === 'cards') void renderCards()
} 
;(Object.keys(tabs) as TabName[]).forEach(k => tabs[k].addEventListener('click', () => switchTab(k)))

function openLoginModal() {
  loginModal.classList.remove('hidden')
  updateUserChip()
  setTimeout(() => {
    if (!auth.token) loginAccount.focus()
  }, 0)
}

function closeLoginModal() {
  loginModal.classList.add('hidden')
}

function openMembersModal() {
  membersModal.classList.remove('hidden')
  if (auth.token && members.length === 0) void loadMembers()
  else renderMembers()
}

function closeMembersModal() {
  membersModal.classList.add('hidden')
}

// ── Status display ─────────────────────────────────────────────────────────
function renderStatus() {
  if (offlineMode) {
    statusDot.className = 'status-dot offline'
    statusLabel.textContent = '离线模式'
    return
  }
  statusDot.className = `status-dot ${currentStatus}`
  statusLabel.textContent = currentStatus === 'registered'
    ? getConnectedAiShortLabel()
    : (STATUS_LABELS[currentStatus] || currentStatus)
}

function setStatus(status: AgentStatus) {
  currentStatus = status
  renderStatus()
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

// ── Auth / login ─────────────────────────────────────────────────────────────
function updateUserChip() {
  if (auth.token) {
    userChip.classList.remove('guest')
    userAva.innerHTML = avatarHtml(auth.avatar, (auth.userName || auth.account || '?').slice(0, 1).toUpperCase())
    userName.textContent = auth.userName || auth.account || '已登录'
  } else {
    userChip.classList.add('guest')
    userAva.textContent = '·'
    userName.textContent = '未登录'
  }
  // Auth-gated settings blocks
  connectionControlCard.classList.toggle('hidden', !auth.token)
  memberSettingsCard.classList.toggle('hidden', !auth.token)
  accountCard.classList.toggle('hidden', !auth.token)
  loginGate.classList.toggle('hidden', !!auth.token)
  accountStatusV.textContent = auth.token ? `已登录：${auth.userName || auth.account}` : '未登录'
  logoutBtn.style.display = auth.token ? 'block' : 'none'
}

async function doLogin() {
  const configuredServerUrl = cfgServer.value.trim()
  if (configuredServerUrl && configuredServerUrl !== serverUrl) {
    serverUrl = configuredServerUrl
    await saveSettings({ serverUrl })
    port.postMessage({ type: 'settings:save', payload: { serverUrl } })
  }
  const account = loginAccount.value.trim()
  const password = loginPassword.value
  if (!account || !password) { loginFeedback.textContent = '请输入账号和密码'; loginFeedback.style.color = 'var(--error)'; return }
  if (!serverUrl) { loginFeedback.textContent = '请先在设置中配置服务器 URL'; loginFeedback.style.color = 'var(--error)'; return }
  loginBtn.disabled = true
  loginFeedback.textContent = '登录中…'
  loginFeedback.style.color = 'var(--muted)'
  try {
    const { token, user } = await apiLogin(serverUrl, account, password)
    auth = { token, account, userId: user?.id ?? null, userName: user?.name || account, avatar: user?.avatar || '' }
    await saveAuth(auth)
    loginPassword.value = ''
    loginFeedback.textContent = '登录成功 ✓'
    loginFeedback.style.color = 'var(--success)'
    updateUserChip()
    await loadMembers()
    syncSelectedAiToBackground(true)
    renderSettingsViews()
    if (useServerChat()) await refreshServerSessionsAndHistory()
    closeLoginModal()
    openMembersModal()
  } catch (err: any) {
    loginFeedback.textContent = `登录失败：${err?.message || err}`
    loginFeedback.style.color = 'var(--error)'
  } finally {
    loginBtn.disabled = false
  }
}
loginBtn.addEventListener('click', () => void doLogin())
loginPassword.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') void doLogin() })
userChip.addEventListener('click', () => openLoginModal())
userChip.addEventListener('keydown', (e) => {
  const key = (e as KeyboardEvent).key
  if (key === 'Enter' || key === ' ') {
    e.preventDefault()
    openLoginModal()
  }
})
loginModal.addEventListener('click', (e) => {
  if (e.target === loginModal) closeLoginModal()
})
loginModalClose.addEventListener('click', () => closeLoginModal())
statusPill.addEventListener('click', () => openMembersModal())
statusPill.addEventListener('keydown', (e) => {
  const key = (e as KeyboardEvent).key
  if (key === 'Enter' || key === ' ') {
    e.preventDefault()
    openMembersModal()
  }
})
membersModal.addEventListener('click', (e) => {
  if (e.target === membersModal) closeMembersModal()
})
membersModalClose.addEventListener('click', () => closeMembersModal())

async function doLogout() {
  await clearAuth()
  // Tell the background to drop its socket so the server sees us leaving.
  // Without this the socket stays open and the agent keeps trying to
  // re-register with an empty token (the server now rejects this, but the
  // socket-level connection would still show "已连接" in the popup).
  port.postMessage({ type: 'auth:logout' })
  port.postMessage({ type: 'agent:selected-ai', aiConfigId: null })
  auth = await getAuth()
  closeMembersModal()
  members = []
  selectedMemberId = null
  serverSessions = []
  currentServerSessionId = ''
  lastSyncedMessageId = 0
  chatHistory = []
  renderChatHistory()
  updateChatSessionControls()
  updateUserChip()
  renderMembers()
  updateTargetBanners()
  renderSettingsViews()
  switchTab('settings')
}
logoutBtn.addEventListener('click', () => void doLogout())

// ── Members ────────────────────────────────────────────────────────────────
async function loadMembers() {
  if (!auth.token) return
  membersEmpty.textContent = '加载中…'
  membersEmpty.style.display = 'block'
  try {
    const rows = await listConfigs(serverUrl, auth.token)
    members = rows.filter(hasBrowserMcpPermission)
    if (selectedMemberId && !memberById(selectedMemberId)) {
      selectedMemberId = null
      port.postMessage({ type: 'agent:selected-ai', aiConfigId: null })
      serverSessions = []
      currentServerSessionId = ''
      lastSyncedMessageId = 0
      chatHistory = []
      renderChatHistory()
      updateChatSessionControls()
    } else if (selectedMemberId && memberById(selectedMemberId)) {
      port.postMessage({ type: 'agent:selected-ai', aiConfigId: selectedMemberId })
    }
    renderMembers()
    updateTargetBanners()
    renderSettingsViews()
    renderStatus()
  } catch (err: any) {
    if (/401|令牌|凭证|credential/i.test(String(err?.message))) {
      // token expired
      await doLogout()
      loginFeedback.textContent = '登录已过期，请重新登录'
      loginFeedback.style.color = 'var(--warn)'
      return
    }
    membersEmpty.textContent = `加载失败：${err?.message || err}`
  }
}
function renderMembers() {
  membersList.querySelectorAll('.member-card').forEach(e => e.remove())
  if (!members.length) {
    membersEmpty.style.display = 'block'
    membersEmpty.textContent = auth.token ? '暂无可显示的 AI 成员' : '请先登录'
    return
  }
  membersEmpty.style.display = 'none'
  for (const m of members) {
    const role = roleOf(m)
    const el = document.createElement('div')
    el.className = `member-card${m.id === selectedMemberId ? ' selected' : ''}`
    el.innerHTML = `
      <div class="${m.enabled === false ? 'dot-off' : 'dot-on'}"></div>
      <div class="member-ava">${esc((m.name || '?').slice(0,1))}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.name || '未命名')}</div>
        <div class="member-meta">${esc(m.model || '—')} · MCP ${toolCount(m)} 项</div>
      </div>
      <span class="role-badge ${role}">${ROLE_LABELS[role] || role}</span>`
    el.addEventListener('click', () => selectMember(m.id))
    membersList.appendChild(el)
  }
}
async function selectMember(id: number) {
  if (!auth.token) {
    selectedMemberId = null
    port.postMessage({ type: 'agent:selected-ai', aiConfigId: null })
    loginFeedback.textContent = '请先登录后再选择 AI 成员'
    loginFeedback.style.color = 'var(--warn)'
    switchTab('settings')
    renderMembers()
    updateTargetBanners()
    renderSettingsViews()
    return
  }
  selectedMemberId = id
  // Persist directly to storage first. Without this the background's
  // register() can read a stale settings snapshot during a fast
  // login -> select-AI -> connect sequence and emit aiConfigId: null,
  // leaving the server-side agent record without an AI assignment.
  await saveSettings({ selectedAiConfigId: id })
  port.postMessage({ type: 'agent:selected-ai', aiConfigId: id })
  renderMembers()
  updateTargetBanners()
  renderSettingsViews()
  renderStatus()
  chatHistory = []
  serverSessions = []
  currentServerSessionId = ''
  lastSyncedMessageId = 0
  chatMsgs.querySelectorAll('.chat-msg').forEach(e => e.remove())
  updateChatSessionControls()
  if (useServerChat()) void refreshServerSessionsAndHistory()
}
membersRefresh.addEventListener('click', () => void loadMembers())

// ── Target banners + chat availability ───────────────────────────────────────
function useServerChat(): boolean {
  return !!(!offlineMode && auth.token && selectedMemberId)
}
function updateOfflineUi() {
  offlineModelConfig.classList.toggle('hidden', !offlineMode)
  renderStatus()
  updateTargetBanners()
}
function updateTargetBanners() {
  const m = memberById(selectedMemberId)
  if (offlineMode) {
    chatTarget.classList.remove('empty')
    chatTargetText.innerHTML = `🛜 离线模式 · 模型 <span class="tb-name">${esc(localModel || '未配置')}</span>`
  } else if (m) {
    chatTarget.classList.remove('empty')
    chatTargetText.innerHTML = `对话目标：<span class="tb-name">${esc(m.name)}</span>（${ROLE_LABELS[roleOf(m)] || ''}）`
  } else {
    chatTarget.classList.add('empty')
    chatTargetText.textContent = '未选择 AI 成员（将使用本地 AI Key 直连）'
  }
  // Task scheduling always needs the server (login + selected member).
  if (m && !offlineMode) {
    taskTarget.classList.remove('empty')
    taskTarget.innerHTML = `任务目标：<span class="tb-name">${esc(m.name)}</span>`
    taskForm.style.display = 'block'
    taskJobsCard.style.display = 'block'
  } else {
    taskTarget.classList.add('empty')
    taskTarget.textContent = offlineMode
      ? '离线模式下不可安排任务（任务需登录服务器）'
      : (auth.token ? '请先在“成员”中选择一个 AI 成员' : '请先登录并选择 AI 成员')
    taskForm.style.display = 'none'
    taskJobsCard.style.display = 'none'
  }
  refreshChatAvailability()
}
function refreshChatAvailability() {
  const enabled = useServerChat() || hasAiKey
  const hasMessages = chatMsgs.querySelectorAll('.chat-msg').length > 0
  chatNoKey.style.display = (enabled || hasMessages) ? 'none' : 'flex'
  chatInput.disabled = !enabled || chatBusy
  chatSendBtn.disabled = !enabled || chatBusy
  // In server mode the clear button is "新建对话" — always available so users
  // can start a fresh session even when the current view is empty.
  if (useServerChat()) {
    chatClearBtn.disabled = chatBusy
  } else {
    chatClearBtn.disabled = !hasMessages && !chatHistory.length && !chatBusy
  }
  updateChatSessionControls()
}

// ── Chat (rendering helpers in ./markdown.ts) ─────────────────────────────
function syncChatHistory(): Promise<void> {
  // Local-only history is the fallback for the offline / no-server path.
  if (useServerChat()) return Promise.resolve()
  return setChatHistory(chatHistory)
}
function clearChatMessages() {
  chatMsgs.querySelectorAll('.chat-msg').forEach(e => e.remove())
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
function appendChatMsg(role: 'user' | 'ai', content: string, historyIndex?: number): HTMLElement {
  chatNoKey.style.display = 'none'
  const el = document.createElement('div')
  el.className = `chat-msg ${role}`
  if (historyIndex !== undefined) el.dataset.historyIndex = String(historyIndex)
  const supportsRecall = role === 'user'
  const avatar = role === 'ai' ? '✨' : avatarHtml(auth.avatar, '👤')
  el.innerHTML = `<div class="chat-avatar">${avatar}</div>`
    + `<div class="chat-bubble">${rowActionsHtml(role, supportsRecall)}${renderChatContent(content)}</div>`
  chatMsgs.appendChild(el)
  chatMsgs.scrollTop = chatMsgs.scrollHeight
  return el
}
function renderChatHistory() {
  clearChatMessages()
  if (!chatHistory.length) {
    refreshChatAvailability()
    return
  }
  chatHistory.forEach((msg, index) => {
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
  chatMsgs.appendChild(el)
  chatMsgs.scrollTop = chatMsgs.scrollHeight
  return el
}
function setBubble(el: HTMLElement, html: string) {
  const bubble = el.querySelector('.chat-bubble')
  if (bubble) bubble.innerHTML = html
  chatMsgs.scrollTop = chatMsgs.scrollHeight
}
function setChatBusy(busy: boolean) {
  chatBusy = busy
  refreshChatAvailability()
}

async function recordChatMessage(role: 'user' | 'assistant', content: string) {
  chatHistory.push({ role, content })
  await syncChatHistory()
}

async function restoreChatHistory() {
  // Only restore local history when no server backing is active. The server
  // history fetch path will replace it once the user logs in + selects a member.
  if (useServerChat()) return
  chatHistory = await getChatHistory()
  renderChatHistory()
}

function defaultSessionIdForMember(): string {
  return `ext-${selectedMemberId}`
}

function isExtensionSession(name: string): boolean {
  return /^浏览器插件(?:会话| 对话)/.test(String(name || '').trim())
}

function pickPreferredSessionId(items: ServerChatSession[]): string {
  if (!items.length) return ''
  const ext = items.find(item => isExtensionSession(item.name))
  return (ext || items[0]).id
}

function updateChatSessionControls() {
  if (!useServerChat()) {
    chatSessionSelect.classList.add('hidden')
    chatSessionDeleteBtn.style.display = 'none'
    chatClearBtn.textContent = '清空'
    chatClearBtn.title = '清空本地对话记录'
    return
  }
  chatClearBtn.textContent = '新建对话'
  chatClearBtn.title = '在服务器上新建一段对话（保留当前历史）'
  if (serverSessions.length === 0) {
    chatSessionSelect.classList.add('hidden')
    chatSessionDeleteBtn.style.display = 'none'
    return
  }
  // Re-render the select options.
  chatSessionSelect.innerHTML = serverSessions
    .map(s => `<option value="${esc(s.id)}"${s.id === currentServerSessionId ? ' selected' : ''}>${esc(s.name)}</option>`)
    .join('')
  chatSessionSelect.classList.remove('hidden')
  chatSessionDeleteBtn.style.display = serverSessions.length > 1 ? 'block' : 'none'
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
  if (chatHistoryLoading) return false
  chatHistoryLoading = true
  try {
    const rows = await fetchChatHistory(serverUrl, auth.token, sessionId, selectedMemberId)
    chatHistory = rows.map(chatMessageFromServer).filter((m): m is ChatMessage => m !== null)
    lastSyncedMessageId = chatHistory.reduce(
      (max, m) => (m.serverId && m.serverId > max ? m.serverId : max),
      0,
    )
    renderChatHistory()
    return true
  } catch (err: any) {
    if (/401|令牌|凭证|credential/i.test(String(err?.message))) {
      await doLogout()
      return false
    }
    console.warn('loadServerChatHistory failed', err)
    return false
  } finally {
    chatHistoryLoading = false
  }
}

async function refreshServerSessionsAndHistory(targetSessionId?: string): Promise<void> {
  if (!useServerChat()) return
  try {
    serverSessions = await listChatSessions(serverUrl, auth.token, selectedMemberId)
  } catch (err: any) {
    if (/401|令牌|凭证|credential/i.test(String(err?.message))) {
      await doLogout()
      return
    }
    console.warn('listChatSessions failed', err)
    serverSessions = []
  }
  // If no session yet for this member, create a default one so users always
  // land on a real server session that will persist.
  if (!serverSessions.length) {
    try {
      const created = await createChatSession(serverUrl, auth.token, '浏览器插件会话', selectedMemberId)
      serverSessions = [created]
    } catch (err) {
      console.warn('createChatSession failed', err)
    }
  }
  const preferred = targetSessionId && serverSessions.some(s => s.id === targetSessionId)
    ? targetSessionId
    : (currentServerSessionId && serverSessions.some(s => s.id === currentServerSessionId)
        ? currentServerSessionId
        : pickPreferredSessionId(serverSessions))
  currentServerSessionId = preferred
  updateChatSessionControls()
  if (preferred) await loadServerChatHistory(preferred)
  else { chatHistory = []; renderChatHistory() }
}

async function syncIncrementalServerHistory(): Promise<void> {
  if (!useServerChat() || !currentServerSessionId) return
  try {
    const rows = await fetchChatHistory(serverUrl, auth.token, currentServerSessionId, selectedMemberId)
    const incoming: ChatMessage[] = []
    let maxId = lastSyncedMessageId
    for (const row of rows) {
      const msg = chatMessageFromServer(row)
      if (!msg) continue
      if (msg.serverId !== undefined && msg.serverId <= lastSyncedMessageId) continue
      incoming.push(msg)
      if (msg.serverId !== undefined && msg.serverId > maxId) maxId = msg.serverId
    }
    if (!incoming.length) return
    // Drop any local-only assistant placeholder with matching content; replace
    // with the server-backed message so the action buttons have a real id.
    for (const msg of incoming) {
      if (msg.role !== 'assistant') continue
      const idx = chatHistory.findIndex(item =>
        item.serverId === undefined
        && item.role === 'assistant'
        && chatContentToText(item.content).trim() === chatContentToText(msg.content).trim())
      if (idx >= 0) chatHistory.splice(idx, 1)
    }
    chatHistory.push(...incoming)
    lastSyncedMessageId = maxId
    renderChatHistory()
  } catch (err) {
    console.warn('syncIncrementalServerHistory failed', err)
  }
}

async function clearConversation() {
  if (chatBusy) stopPendingChatUi()
  if (useServerChat()) {
    // Server mode: "新建对话" creates a fresh session, leaving old history intact.
    try {
      const name = `浏览器插件会话 ${new Date().toLocaleString('zh-CN', { hour12: false })}`
      const created = await createChatSession(serverUrl, auth.token, name, selectedMemberId)
      chatHistory = []
      lastSyncedMessageId = 0
      renderChatHistory()
      await refreshServerSessionsAndHistory(created.id)
    } catch (err: any) {
      console.warn('createChatSession failed', err)
      alert(`新建对话失败：${err?.message || err}`)
    }
    return
  }
  chatHistory = []
  await clearChatHistory()
  renderChatHistory()
}

async function deleteCurrentServerSession() {
  if (!useServerChat() || !currentServerSessionId) return
  if (serverSessions.length <= 1) return
  const target = serverSessions.find(s => s.id === currentServerSessionId)
  if (!target) return
  if (!confirm(`确定删除会话「${target.name}」？此操作不可恢复。`)) return
  try {
    await deleteChatSession(serverUrl, auth.token, currentServerSessionId, selectedMemberId)
    currentServerSessionId = ''
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
  activeChatRequestId = null
  const thinking = (window as any)._chatThinking as HTMLElement | undefined
  thinking?.remove()
  ;(window as any)._chatThinking = null
  const liveThinking = document.getElementById('thinking')
  liveThinking?.remove()
  if (activeRunId && auth.token) {
    void stopChatRun(serverUrl, auth.token, activeRunId).catch(() => {})
  }
  activeRunId = null
  setChatBusy(false)
}

async function deleteChatMessage(index: number) {
  const msg = chatHistory[index]
  if (!msg) return
  const lastUserIndex = chatHistory.map(m => m.role).lastIndexOf('user')
  if (chatBusy && index === lastUserIndex) stopPendingChatUi()
  if (useServerChat() && msg.serverId !== undefined) {
    if (!confirm('确定要删除这条消息吗？')) return
    try {
      await deleteServerChatMessage(serverUrl, auth.token, msg.serverId)
    } catch (err: any) {
      alert(`删除失败：${err?.message || err}`)
      return
    }
  }
  chatHistory.splice(index, 1)
  await syncChatHistory()
  renderChatHistory()
}

async function revokeChatMessage(index: number) {
  const msg = chatHistory[index]
  if (!msg || msg.role !== 'user') return
  const text = chatContentToText(msg.content)
  if (chatBusy) stopPendingChatUi()
  if (useServerChat() && msg.serverId !== undefined) {
    if (!confirm('确定撤回此消息？将删除它之后的对话。')) return
    try {
      const result = await recallServerChatMessage(serverUrl, auth.token, msg.serverId)
      chatInput.value = result?.recall_content || text
    } catch (err: any) {
      alert(`撤回失败：${err?.message || err}`)
      return
    }
    chatHistory.splice(index)
    // Re-sync max id so we don't double-add anything.
    lastSyncedMessageId = chatHistory.reduce(
      (max, m) => (m.serverId && m.serverId > max ? m.serverId : max),
      0,
    )
  } else {
    chatHistory.splice(index)
    chatInput.value = text
  }
  await syncChatHistory()
  renderChatHistory()
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px'
  refreshChatAvailability()
  chatInput.focus()
}

chatMsgs.addEventListener('click', (e: MouseEvent) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chat-action-btn')
  if (!btn) return
  e.preventDefault()
  e.stopPropagation()
  const msgEl = btn.closest<HTMLElement>('.chat-msg')
  const index = Number(msgEl?.dataset.historyIndex)
  if (!Number.isInteger(index) || !chatHistory[index]) return
  const action = btn.dataset.chatAction
  if (action === 'copy') {
    const originalText = btn.textContent
    void writeClipboardText(chatContentToText(chatHistory[index].content)).then(() => {
      btn.textContent = '已复制'
      setTimeout(() => { btn.textContent = originalText || '复制' }, 900)
    })
  } else if (action === 'revoke') {
    void revokeChatMessage(index)
  } else if (action === 'delete') {
    void deleteChatMessage(index)
  }
})

chatClearBtn.addEventListener('click', () => void clearConversation())
chatSessionDeleteBtn.addEventListener('click', () => void deleteCurrentServerSession())
chatSessionSelect.addEventListener('change', () => {
  const next = chatSessionSelect.value
  if (!next || next === currentServerSessionId) return
  currentServerSessionId = next
  lastSyncedMessageId = 0
  void loadServerChatHistory(next)
})

async function runServerChat(text: string, thinking: HTMLElement) {
  if (!currentServerSessionId) {
    await refreshServerSessionsAndHistory()
  }
  const sessionId = currentServerSessionId || defaultSessionIdForMember()
  const sessionName = serverSessions.find(s => s.id === sessionId)?.name || '浏览器插件会话'
  const { run_id } = await startChatRun(serverUrl, auth.token, selectedMemberId!, sessionId, text, sessionName)
  activeRunId = run_id
  let after = 0
  let lastText = ''
  let lastReasoning = ''
  let lastPhaseKey = ''
  const liveEvents: ChatLiveEvent[] = []
  const MAX_POLLS = 600 // ~8 min at 800ms
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(800)
    let st
  try { st = await getChatRun(serverUrl, auth.token, run_id, after) } catch { continue }
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
      activeRunId = null
      if (st.status === 'error') return { text: `⚠ 错误: ${st.error_message || '执行失败'}`, reasoning: lastReasoning, events: liveEvents, ok: false }
      if (st.status === 'stopped') return { text: lastText || '（已停止）', reasoning: lastReasoning, events: liveEvents, ok: true }
      return { text: lastText || '完成', reasoning: lastReasoning, events: liveEvents, ok: true }
    }
  }
  activeRunId = null
  return { text: lastText || '（超时，未收到完整回复）', reasoning: lastReasoning, events: liveEvents, ok: false }
}

async function sendChat() {
  const enabled = useServerChat() || hasAiKey
  if (chatBusy || !enabled) return
  const text = chatInput.value.trim()
  if (!text) return
  chatInput.value = ''
  chatInput.style.height = 'auto'

  // Optimistic local echo for the user's message. In server mode the
  // authoritative copy (with server id) will arrive via the post-run sync.
  chatHistory.push({ role: 'user', content: text })
  appendChatMsg('user', text, chatHistory.length - 1)
  void syncChatHistory()
  const thinking = showThinking()
  const requestId = makeChatRequestId()
  activeChatRequestId = requestId
  setChatBusy(true)

  if (useServerChat()) {
    try {
      const res = await runServerChat(text, thinking)
      if (activeChatRequestId !== requestId) return
      setBubble(thinking, renderChatFrame(res.text, { reasoning: res.reasoning, events: res.events }))
      thinking.removeAttribute('id')
      // Replace the optimistic local pair with the server-backed history.
      // Drop the trailing optimistic user message so the sync logic can
      // overlay the server's persisted copies (with ids for delete/recall).
      const lastIdx = chatHistory.length - 1
      if (lastIdx >= 0 && chatHistory[lastIdx].serverId === undefined && chatHistory[lastIdx].role === 'user') {
        chatHistory.splice(lastIdx, 1)
      }
      await syncIncrementalServerHistory()
    } catch (err: any) {
      if (activeChatRequestId !== requestId) return
      const errorText = `⚠ 错误: ${err?.message || err}`
      setBubble(thinking, renderChatContent(errorText))
      thinking.removeAttribute('id')
      // Best-effort: pull whatever the server persisted (the user message at least).
      await syncIncrementalServerHistory()
    } finally {
      if (activeChatRequestId === requestId) {
        activeChatRequestId = null
        setChatBusy(false)
      }
    }
  } else {
    // Local AI-key chat via background worker
    ;(window as any)._chatThinking = thinking
    port.postMessage({ type: 'chat:send', messages: chatHistory, requestId })
  }
}
chatSendBtn.addEventListener('click', () => void sendChat())
chatInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat() }
})
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto'
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px'
})

// ── Tasks ────────────────────────────────────────────────────────────────────
taskSchedEnabled.addEventListener('change', () => {
  taskSchedOpts.style.display = taskSchedEnabled.checked ? 'block' : 'none'
})
async function submitTask() {
  if (!auth.token || !selectedMemberId) return
  const title = taskTitle.value.trim()
  const instruction = taskInstruction.value.trim()
  if (!title) { taskFeedback.textContent = '请输入任务标题'; taskFeedback.style.color = 'var(--error)'; return }
  taskSubmit.disabled = true
  taskFeedback.textContent = '提交中…'
  taskFeedback.style.color = 'var(--muted)'
  const schedEnabled = taskSchedEnabled.checked
  let scheduleAt: number | string | null = null
  if (schedEnabled && taskAt.value) {
    const t = new Date(taskAt.value).getTime()
    if (!Number.isNaN(t)) scheduleAt = Math.floor(t / 1000)
  }
  try {
    const res = await triggerTask(serverUrl, auth.token, selectedMemberId, {
      title,
      instruction,
      priority: Math.max(1, Math.min(10, Number(taskPriority.value) || 5)),
      schedule_enabled: schedEnabled,
      schedule_loop_enabled: schedEnabled && taskLoop.checked,
      schedule_run_immediately: schedEnabled && taskLoop.checked && taskRunNow.checked,
      schedule_duration_minutes: Math.max(1, Number(taskDuration.value) || 30),
      schedule_at: scheduleAt,
      override_mcp_tools_enabled: false,
      mcp_tools_override: [],
    })
    taskFeedback.textContent = `已安排：${res?.title || title} ✓`
    taskFeedback.style.color = 'var(--success)'
    taskTitle.value = ''
    taskInstruction.value = ''
    await loadJobs()
    setTimeout(() => { taskFeedback.textContent = '' }, 2500)
  } catch (err: any) {
    taskFeedback.textContent = `失败：${err?.message || err}`
    taskFeedback.style.color = 'var(--error)'
  } finally {
    taskSubmit.disabled = false
  }
}
taskSubmit.addEventListener('click', () => void submitTask())

async function loadJobs() {
  if (!auth.token || !selectedMemberId) return
  jobsEmpty.textContent = '加载中…'
  jobsEmpty.style.display = 'block'
  try {
    const jobs = await listTaskJobs(serverUrl, auth.token, selectedMemberId)
    renderJobs(jobs)
  } catch (err: any) {
    jobsEmpty.textContent = `加载失败：${err?.message || err}`
  }
}
function renderJobs(jobs: TaskJob[]) {
  jobsList.querySelectorAll('.job-card').forEach(e => e.remove())
  if (!jobs.length) { jobsEmpty.style.display = 'block'; jobsEmpty.textContent = '暂无任务'; return }
  jobsEmpty.style.display = 'none'
  for (const j of jobs) {
    const st = String(j.effective_status || j.status || 'queued')
    const el = document.createElement('div')
    el.className = 'job-card'
    const canPause = st === 'queued' || st === 'running'
    const canResume = st === 'paused'
    el.innerHTML = `
      <div class="job-top">
        <span class="job-title">${esc(j.title || '未命名任务')}</span>
        <span class="job-status ${st}">${esc(st)}</span>
      </div>
      <div style="font-size:10px;color:var(--muted)">优先级 ${j.priority ?? 5} · ${esc(j.trigger_type || 'manual')}</div>
      <div class="job-actions">
        ${canPause ? `<button class="mini-btn" data-act="pause">暂停</button>` : ''}
        ${canResume ? `<button class="mini-btn" data-act="resume">继续</button>` : ''}
        <button class="mini-btn" data-act="stop">停止</button>
        <button class="mini-btn danger" data-act="delete">删除</button>
      </div>`
    el.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => void doJobAction(j.job_id, (btn as HTMLElement).dataset.act as any))
    })
    jobsList.appendChild(el)
  }
}
async function doJobAction(jobId: string, action: 'pause' | 'resume' | 'stop' | 'delete') {
  if (!auth.token || !selectedMemberId) return
  try {
    await taskJobAction(serverUrl, auth.token, selectedMemberId, jobId, action)
    await loadJobs()
  } catch (err: any) {
    taskFeedback.textContent = `操作失败：${err?.message || err}`
    taskFeedback.style.color = 'var(--error)'
  }
}
jobsRefresh.addEventListener('click', () => void loadJobs())

// ── Settings (read-only views) ────────────────────────────────────────────────
function renderSettingsViews() {
  // Member config card
  const m = memberById(selectedMemberId)
  if (m) {
    memberSettingsCard.style.display = 'block'
    let tools: string[] = []
    try { const a = JSON.parse(m.mcp_tools || '[]'); if (Array.isArray(a)) tools = a } catch { /* ignore */ }
    const chips = tools.length
      ? `<div class="tool-chips">${tools.map(t => `<span class="tool-chip">${esc(t)}</span>`).join('')}</div>`
      : `<div class="empty-note">未分配 MCP 工具</div>`
    memberSettingsBody.innerHTML = `
      <div class="kv"><span class="k">名称</span><span class="v">${esc(m.name || '')}</span></div>
      <div class="kv"><span class="k">角色</span><span class="v">${ROLE_LABELS[roleOf(m)] || roleOf(m)}</span></div>
      <div class="kv"><span class="k">模型</span><span class="v">${esc(m.model || '—')}</span></div>
      <div class="kv"><span class="k">平台</span><span class="v">${esc(m.platform || '—')}</span></div>
      <div class="kv"><span class="k">工作目录</span><span class="v">${esc(m.workspace_root || '（仅对话）')}</span></div>
      <div class="kv"><span class="k">MCP 开关</span><span class="v">${m.mcp_enabled === false ? '关闭' : '开启'}</span></div>
      <div class="divider"></div>
      <div class="kv"><span class="k">MCP 工具（${tools.length}）</span><span class="v"></span></div>
      ${chips}`
  } else {
    memberSettingsCard.style.display = 'none'
  }
}

// ── Memory cards (automation workflows) ──────────────────────────────────────
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
async function renderCards() {
  cards = await getCards()
  cardsList.querySelectorAll('.card-item').forEach(e => e.remove())
  if (!cards.length) { cardsEmpty.style.display = 'block'; return }
  cardsEmpty.style.display = 'none'
  for (const c of cards) {
    const expanded = c.id === expandedCardId
    const el = document.createElement('div')
    el.className = 'card-item' + (c.id === runningCardId ? ' running' : '')
    el.innerHTML = `
      <div class="card-item-top">
        <span class="card-item-name">${esc(c.name)}</span>
        <span class="card-item-meta">${c.steps.length} 步</span>
      </div>
      ${c.description ? `<div class="card-item-desc">${esc(c.description)}</div>` : ''}
      <div class="card-item-actions">
        ${c.id === runningCardId
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
    cardsList.appendChild(el)
  }
}
async function onCardAction(id: string, act: string) {
  const card = cards.find(c => c.id === id)
  if (!card) return
  switch (act) {
    case 'run':
      if (runningCardId) { cardsRunStatus.textContent = '已有卡片在执行，请先停止'; return }
      runningCardId = id
      expandedCardId = id
      cardsRunStatus.textContent = `开始执行：${card.name}`
      port.postMessage({ type: 'card:run', cardId: id })
      await renderCards()
      break
    case 'stop':
      port.postMessage({ type: 'card:stop' })
      break
    case 'view':
      expandedCardId = expandedCardId === id ? null : id
      await renderCards()
      break
    case 'export':
      exportDownload(`${card.name || 'card'}.json`, exportCard(card))
      break
    case 'delete':
      if (confirm(`确定删除卡片「${card.name}」？此操作不可恢复。`)) {
        await deleteCard(id)
        if (expandedCardId === id) expandedCardId = null
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
    cardModalMsg.textContent = `卡片「${name}」已存在，是否合并步骤？合并会把导入的步骤追加到现有卡片末尾。`
    cardModal.classList.remove('hidden')
    const done = (r: 'merge' | 'replace' | 'skip') => {
      cardModal.classList.add('hidden')
      cmMerge.onclick = cmReplace.onclick = cmSkip.onclick = null
      resolve(r)
    }
    cmMerge.onclick = () => done('merge')
    cmReplace.onclick = () => done('replace')
    cmSkip.onclick = () => done('skip')
  })
}
async function doImportText(text: string) {
  if (!text) { cardsImportFeedback.textContent = '请粘贴卡片 JSON 或选择文件'; cardsImportFeedback.style.color = 'var(--error)'; return }
  let incoming: MemoryCard[]
  try { incoming = parseImport(text) } catch (e: any) {
    cardsImportFeedback.textContent = `导入失败：${e?.message || e}`
    cardsImportFeedback.style.color = 'var(--error)'
    return
  }
  cards = await getCards()
  let added = 0, merged = 0, replaced = 0, skipped = 0
  for (const inc of incoming) {
    const existing = cards.find(c => c.name === inc.name)
    if (existing) {
      const choice = await askMergeChoice(inc.name)
      if (choice === 'skip') { skipped++; continue }
      const idx = cards.findIndex(c => c.id === existing.id)
      if (choice === 'merge') { cards[idx] = mergeCards(existing, inc); merged++ }
      else { cards[idx] = { ...inc, id: existing.id, createdAt: existing.createdAt }; replaced++ }
    } else {
      cards.push(inc); added++
    }
  }
  await setCards(cards)
  cardsImportText.value = ''
  cardsImportFeedback.textContent = `完成：新增 ${added}，合并 ${merged}，替换 ${replaced}，跳过 ${skipped}`
  cardsImportFeedback.style.color = 'var(--success)'
  await renderCards()
}

cardsImportBtn.addEventListener('click', () => cardsImportBox.classList.toggle('hidden'))
cardsImportConfirm.addEventListener('click', () => void doImportText(cardsImportText.value.trim()))
cardsImportFileBtn.addEventListener('click', () => cardsImportFile.click())
cardsImportFile.addEventListener('change', async () => {
  const f = cardsImportFile.files?.[0]
  if (!f) return
  const text = await f.text()
  cardsImportFile.value = ''
  cardsImportBox.classList.remove('hidden')
  await doImportText(text)
})
cardsExportAllBtn.addEventListener('click', async () => {
  cards = await getCards()
  if (!cards.length) { cardsRunStatus.textContent = '没有可导出的卡片'; return }
  exportDownload('heysure-cards.json', { cards: cards.map(exportCard) })
})

// ── Settings (load + save) ─────────────────────────────────────────────────
function loadSettings(s: AgentSettings) {
  serverUrl = s.serverUrl || ''
  selectedMemberId = s.selectedAiConfigId || null
  cfgServer.value   = s.serverUrl   || ''
  cfgAgentServer.value = s.agentServerUrl || ''
  cfgAiKey.value    = s.aiKey       || ''
  cfgAiBase.value   = s.aiBaseUrl   || ''
  cfgAiModel.value  = s.aiModel     || ''
  cfgAutoConn.checked = !!s.autoConnect
  offlineMode = !!s.offlineMode
  cfgOfflineMode.checked = offlineMode
  cfgMouseFx.checked = s.mouseFx !== false
  localModel = s.aiModel || ''
  hasAiKey = !!(s.aiKey?.trim())
  updateOfflineUi()
  renderMembers()
  syncSelectedAiToBackground()
  applyTheme(s.theme || 'dark', false)
}

// Provider quick-presets fill Base URL + a sensible default model.
const PROVIDER_PRESETS: Record<string, { base: string; model: string }> = {
  anthropic:  { base: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  openai:     { base: 'https://api.openai.com',    model: 'gpt-4o' },
  deepseek:   { base: 'https://api.deepseek.com',  model: 'deepseek-chat' },
  openrouter: { base: 'https://openrouter.ai/api', model: 'anthropic/claude-3.5-sonnet' },
  ollama:     { base: 'http://localhost:11434',    model: 'llama3.1' },
}
cfgAiProvider.addEventListener('change', () => {
  const p = PROVIDER_PRESETS[cfgAiProvider.value]
  if (p) { cfgAiBase.value = p.base; cfgAiModel.value = p.model }
  cfgAiProvider.value = ''
})

// Offline toggle persists immediately and updates the UI without a full save.
cfgOfflineMode.addEventListener('change', () => {
  offlineMode = cfgOfflineMode.checked
  updateOfflineUi()
  port.postMessage({ type: 'settings:save', payload: { offlineMode } })
})

// Mouse-effect toggle persists immediately; content scripts react via storage.
cfgMouseFx.addEventListener('change', () => {
  port.postMessage({ type: 'settings:save', payload: { mouseFx: cfgMouseFx.checked } })
})

$('save-btn')!.addEventListener('click', () => {
  const payload: Partial<AgentSettings> = {
    serverUrl:      cfgServer.value.trim(),
    agentServerUrl: cfgAgentServer.value.trim(),
    aiKey:          cfgAiKey.value.trim(),
    aiBaseUrl:      cfgAiBase.value.trim() || 'https://api.anthropic.com',
    aiModel:        cfgAiModel.value.trim() || 'claude-sonnet-4-5',
    autoConnect:    cfgAutoConn.checked,
    offlineMode:    cfgOfflineMode.checked,
    mouseFx:        cfgMouseFx.checked,
  }
  serverUrl = payload.serverUrl || ''
  offlineMode = !!payload.offlineMode
  localModel = payload.aiModel || ''
  port.postMessage({ type: 'settings:save', payload })
  hasAiKey = !!(payload.aiKey)
  updateOfflineUi()
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

// ── Connect / Disconnect (browser-agent socket) ──────────────────────────────
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
        if (msg.requestId !== activeChatRequestId) break
        const thinking = (window as any)._chatThinking as HTMLElement | undefined
        if (!thinking) { activeChatRequestId = null; setChatBusy(false); break }
        thinking?.remove()
        ;(window as any)._chatThinking = null
        activeChatRequestId = null
        setChatBusy(false)
        const reply = msg.text || '完成'
        chatHistory.push({ role: 'assistant', content: reply })
        const el = appendChatMsg('ai', '', chatHistory.length - 1)
        setBubble(el, renderChatFrame(reply, { toolsUsed: msg.toolsUsed || [], events: msg.toolEvents || [] }))
        void syncChatHistory()
        if (msg.toolsUsed?.length) {
          addEntry({ id: Date.now().toString(), type: 'task', status: 'success', message: `AI 使用工具: ${msg.toolsUsed.join(', ')}`, timestamp: Date.now() })
        }
        break
      }
      case 'chat:error': {
        if (msg.requestId !== activeChatRequestId) break
        const thinking = (window as any)._chatThinking as HTMLElement | undefined
        if (!thinking) { activeChatRequestId = null; setChatBusy(false); break }
        thinking?.remove()
        ;(window as any)._chatThinking = null
        activeChatRequestId = null
        setChatBusy(false)
        const errorText = `⚠ 错误: ${msg.error}`
        chatHistory.push({ role: 'assistant', content: errorText })
        appendChatMsg('ai', errorText, chatHistory.length - 1)
        void syncChatHistory()
        break
      }
      case 'connection:result': {
        const r = msg.result || {}
        const http = r.http || (typeof r.status !== 'undefined' ? r : null)
        const lines: string[] = []
        if (http) {
          lines.push(http.success
            ? `HTTP ✓ ${http.status} · ${http.ms}ms`
            : `HTTP ✗ ${http.error}`)
        }
        if (Array.isArray(r.agentProbes) && r.agentProbes.length) {
          for (const p of r.agentProbes) {
            lines.push(p.ok ? `Agent ✓ ${p.url}` : `Agent ✗ ${p.url} — ${p.reason || ''}`)
          }
          if (r.agentOkUrl) lines.push(`将连接到：${r.agentOkUrl}`)
        } else if (r.needsLogin) {
          lines.push('Agent: 未登录，跳过探测')
        }
        const ok = !!(http?.success && (!r.agentProbes?.length || r.agentOkUrl))
        testResult.textContent = lines.join('\n') || (ok ? '✓ 已连接' : '✗ 未连接')
        testResult.className = `test-result ${ok ? 'ok' : 'fail'}`
        ;(testResult as HTMLElement).style.whiteSpace = 'pre-line'
        break
      }
      case 'card:progress': {
        cardsRunStatus.textContent = `执行中 [${msg.index + 1}/${msg.total}] ${msg.note}`
          + (msg.status === 'error' ? ` ✗ ${msg.error || ''}` : msg.status === 'success' ? ' ✓' : '')
        const row = document.getElementById(`step-${msg.cardId}-${msg.index}`)
        if (row) {
          row.classList.remove('cur', 'ok', 'err')
          row.classList.add(msg.status === 'success' ? 'ok' : msg.status === 'error' ? 'err' : 'cur')
        }
        break
      }
      case 'card:done': {
        runningCardId = null
        cardsRunStatus.textContent = msg.success
          ? '✓ 卡片执行完成'
          : (msg.reason === 'stopped' ? '已停止' : `✗ 执行失败：${msg.reason || ''}`)
        void renderCards()
        break
      }
    }
  })

  port.onDisconnect.addListener(() => { setTimeout(initPort, 1000) })
  port.postMessage({ type: 'settings:get' })
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  initPort()
  switchTab('chat')
  // Load server URL up front so auth-dependent calls have a base before the
  // port's settings:data round-trip arrives.
  const s = await getSettings()
  serverUrl = s.serverUrl || ''
  offlineMode = !!s.offlineMode
  localModel = s.aiModel || ''
  selectedMemberId = s.selectedAiConfigId || null
  auth = await getAuth()
  loginAccount.value = auth.account || ''
  updateUserChip()
  updateOfflineUi()
  void restoreChatHistory()
  if (auth.token) {
    // Validate token in the background and refresh members.
    void (async () => {
      try {
        const me = await getMe(serverUrl, auth.token)
        auth.userName = me?.name || auth.userName
        auth.avatar = me?.avatar || ''
        await saveAuth({ userName: auth.userName, avatar: auth.avatar })
        updateUserChip()
        renderChatHistory()
        await loadMembers()
        syncSelectedAiToBackground(true)
        if (useServerChat()) await refreshServerSessionsAndHistory()
      } catch {
        await doLogout()
      }
    })()
  }
  updateChatSessionControls()
}

// Pending chat text from context menu
chrome.storage.session.get('_pendingChat').then(r => {
  if (r._pendingChat) {
    chrome.storage.session.remove('_pendingChat')
    switchTab('chat')
    chatInput.value = String(r._pendingChat)
  }
}).catch(() => {})

void init()
