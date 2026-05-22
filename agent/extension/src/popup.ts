// popup.ts — HeySure Agent popup UI logic
// Two modes (both retained):
//   1. Browser-Agent: socket connection managed by the background worker.
//   2. Software-end client: logged-in account → AI members, chat, task scheduling.

import { AgentStatus, AgentSettings, ActivityEntry, ChatMessage, BgMsg, MemoryCard } from './lib/types'
import { getAuth, saveAuth, clearAuth, getSettings, getCards, setCards, deleteCard, AuthState } from './lib/storage'
import { parseImport, mergeCards, exportCard } from './lib/cards'
import {
  login as apiLogin, getMe, listConfigs, getMcpTools,
  startChatRun, getChatRun, stopChatRun,
  triggerTask, listTaskJobs, taskJobAction,
  MemberConfig, McpRolePermissions, TaskJob,
} from './lib/client'

// ── State ──────────────────────────────────────────────────────────────────
let currentTheme: 'dark' | 'light' = 'dark'
type TabName = 'feed' | 'chat' | 'tasks' | 'cards' | 'settings'
let activeTab: TabName = 'feed'
let currentStatus: AgentStatus = 'disconnected'
let chatHistory: ChatMessage[] = []
let chatBusy = false
let hasAiKey = false
let port: chrome.runtime.Port

let serverUrl = ''
let offlineMode = false
let localModel = ''
let auth: AuthState = { token: '', account: '', userId: null, userName: '' }
let members: MemberConfig[] = []
let selectedMemberId: number | null = null
let mcpRolePerms: McpRolePermissions | null = null
let activeRunId: string | null = null
let cards: MemoryCard[] = []
let expandedCardId: string | null = null
let runningCardId: string | null = null

// ── Status labels ──────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接', connecting: '连接中...', connected: '已连接',
  registered: '已注册', error: '连接错误',
}
const ROLE_LABELS: Record<string, string> = {
  assistant_admin: '辅助管理员', manager: '管理者', member: '普通成员',
}

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!
const statusDot    = $('status-dot')
const statusLabel  = $('status-label')
const themeToggle  = $('theme-toggle')
const userChip     = $('user-chip')
const userAva      = $('user-ava')
const userName     = $('user-name')

const tabs: Record<TabName, HTMLElement> = {
  feed: $('tab-feed'), chat: $('tab-chat'),
  tasks: $('tab-tasks'), cards: $('tab-cards'), settings: $('tab-settings'),
}
const panes: Record<TabName, HTMLElement> = {
  feed: $('feed-pane'), chat: $('chat-pane'),
  tasks: $('task-pane'), cards: $('cards-pane'), settings: $('settings-pane'),
}

const feed         = $('feed')
const feedEmpty    = $('feed-empty')
const chatMsgs     = $('chat-messages')
const chatNoKey    = $('chat-no-key')
const chatInput    = $('chat-input') as HTMLTextAreaElement
const chatSendBtn  = $('chat-send') as HTMLButtonElement
const chatTarget   = $('chat-target')
const connectBtn   = $('connect-btn')
const disconnectBtn = $('disconnect-btn')
const clearBtn     = $('clear-btn')
const testConnBtn  = $('test-conn-btn')
const testResult   = $('test-result')
const saveFeedback = $('save-feedback')
const cfgServer    = $('cfg-server')  as HTMLInputElement
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
const membersView  = $('members-view')
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
const memberSettingsBody = $('member-settings-body')
const rolePermsCard = $('role-perms-card')
const rolePermsBody = $('role-perms-body')

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
function esc(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function fmt(ts: number): string { return new Date(ts).toTimeString().slice(0,8) }
function roleOf(m: MemberConfig): string {
  if (m.ai_role === 'assistant_admin') return 'assistant_admin'
  return m.digital_member_role === 'manager' ? 'manager' : 'member'
}
function memberById(id: number | null): MemberConfig | undefined {
  return members.find(m => m.id === id)
}
function toolCount(m: MemberConfig): number {
  try { const a = JSON.parse(m.mcp_tools || '[]'); return Array.isArray(a) ? a.length : 0 } catch { return 0 }
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab: TabName) {
  activeTab = tab
  ;(Object.keys(panes) as TabName[]).forEach(k => panes[k].classList.add('hidden'))
  ;(Object.keys(tabs) as TabName[]).forEach(k => tabs[k].classList.remove('active'))
  panes[tab].classList.remove('hidden')
  tabs[tab].classList.add('active')
  if (tab === 'chat') chatMsgs.scrollTop = chatMsgs.scrollHeight
  if (tab === 'settings' && auth.token && members.length === 0) void loadMembers()
  if (tab === 'tasks' && selectedMemberId && auth.token) void loadJobs()
  if (tab === 'cards') void renderCards()
}
;(Object.keys(tabs) as TabName[]).forEach(k => tabs[k].addEventListener('click', () => switchTab(k)))

// ── Status display ─────────────────────────────────────────────────────────
function renderStatus() {
  if (offlineMode) {
    statusDot.className = 'status-dot offline'
    statusLabel.textContent = '离线模式'
    return
  }
  statusDot.className = `status-dot ${currentStatus}`
  statusLabel.textContent = STATUS_LABELS[currentStatus] || currentStatus
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
    userAva.textContent = (auth.userName || auth.account || '?').slice(0, 1).toUpperCase()
    userName.textContent = auth.userName || auth.account || '已登录'
  } else {
    userChip.classList.add('guest')
    userAva.textContent = '·'
    userName.textContent = '未登录'
  }
  // Members pane gate
  loginGate.classList.toggle('hidden', !!auth.token)
  membersView.classList.toggle('hidden', !auth.token)
  // Settings account card
  accountStatusV.textContent = auth.token ? `已登录：${auth.userName || auth.account}` : '未登录'
  logoutBtn.style.display = auth.token ? 'block' : 'none'
}

async function doLogin() {
  const account = loginAccount.value.trim()
  const password = loginPassword.value
  if (!account || !password) { loginFeedback.textContent = '请输入账号和密码'; loginFeedback.style.color = 'var(--error)'; return }
  if (!serverUrl) { loginFeedback.textContent = '请先在设置中配置服务器 URL'; loginFeedback.style.color = 'var(--error)'; return }
  loginBtn.disabled = true
  loginFeedback.textContent = '登录中…'
  loginFeedback.style.color = 'var(--muted)'
  try {
    const { token, user } = await apiLogin(serverUrl, account, password)
    auth = { token, account, userId: user?.id ?? null, userName: user?.name || account }
    await saveAuth(auth)
    loginPassword.value = ''
    loginFeedback.textContent = '登录成功 ✓'
    loginFeedback.style.color = 'var(--success)'
    updateUserChip()
    await Promise.all([loadMembers(), loadMcpTools()])
    renderSettingsViews()
  } catch (err: any) {
    loginFeedback.textContent = `登录失败：${err?.message || err}`
    loginFeedback.style.color = 'var(--error)'
  } finally {
    loginBtn.disabled = false
  }
}
loginBtn.addEventListener('click', () => void doLogin())
loginPassword.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') void doLogin() })

async function doLogout() {
  await clearAuth()
  port.postMessage({ type: 'agent:selected-ai', aiConfigId: null })
  auth = await getAuth()
  members = []
  selectedMemberId = null
  mcpRolePerms = null
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
    members = await listConfigs(serverUrl, auth.token)
    if (selectedMemberId && !memberById(selectedMemberId)) {
      selectedMemberId = null
      port.postMessage({ type: 'agent:selected-ai', aiConfigId: null })
    }
    renderMembers()
    updateTargetBanners()
    renderSettingsViews()
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
    membersEmpty.textContent = auth.token ? '暂无 AI 成员' : '请先登录'
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
function selectMember(id: number) {
  selectedMemberId = id
  port.postMessage({ type: 'agent:selected-ai', aiConfigId: id })
  renderMembers()
  updateTargetBanners()
  renderSettingsViews()
  chatHistory = []
  chatMsgs.querySelectorAll('.chat-msg').forEach(e => e.remove())
}
membersRefresh.addEventListener('click', () => void loadMembers())

async function loadMcpTools() {
  if (!auth.token) return
  try { mcpRolePerms = await getMcpTools(serverUrl, auth.token); renderSettingsViews() } catch { /* ignore */ }
}

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
    chatTarget.innerHTML = `🛜 离线模式 · 模型 <span class="tb-name">${esc(localModel || '未配置')}</span>`
  } else if (m) {
    chatTarget.classList.remove('empty')
    chatTarget.innerHTML = `对话目标：<span class="tb-name">${esc(m.name)}</span>（${ROLE_LABELS[roleOf(m)] || ''}）`
  } else {
    chatTarget.classList.add('empty')
    chatTarget.textContent = '未选择 AI 成员（将使用本地 AI Key 直连）'
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
  chatNoKey.style.display = enabled ? 'none' : 'flex'
  chatInput.disabled = !enabled || chatBusy
  chatSendBtn.disabled = !enabled || chatBusy
}

// ── Chat ───────────────────────────────────────────────────────────────────
function inlineMd(text: string): string {
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

function renderMarkdown(text: string): string {
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

const MCP_CALL_BLOCK_RE = /<mcp[-_]call>\s*([\s\S]*?)\s*<\/\s*(?:mcp[-_]call|[｜|]*\s*DSML\s*[｜|]*\s*invoke)\s*>/gi

function extractSpecialBlocks(text: string): { body: string; reasoning: string[]; mcpCalls: string[] } {
  let body = String(text || '')
  const reasoning: string[] = []
  const mcpCalls: string[] = []
  body = body.replace(/<think>\s*([\s\S]*?)\s*<\/think>/gi, (_, inner) => {
    reasoning.push(String(inner || '').trim())
    return '\n'
  })
  body = body.replace(MCP_CALL_BLOCK_RE, (_, inner) => {
    mcpCalls.push(normalizeJsonText(String(inner || '').trim()))
    return '\n'
  })
  return { body: body.trim(), reasoning, mcpCalls }
}

type ChatLiveEvent = { key: string; label: string; detail?: string }

function renderChatEvent(event: ChatLiveEvent): string {
  return (
    `<div class="chat-mcp-card">` +
    `<div class="chat-mcp-title">${esc(event.label)}</div>` +
    (event.detail ? `<pre class="chat-mcp-pre">${esc(event.detail)}</pre>` : '') +
    `</div>`
  )
}

function renderChatContent(text: string, opts: { reasoning?: string; currentTool?: string; loading?: boolean; toolsUsed?: string[] } = {}): string {
  const extracted = extractSpecialBlocks(text)
  const reasoningParts = [opts.reasoning, ...extracted.reasoning].map(v => String(v || '').trim()).filter(Boolean)
  const chunks: string[] = []
  if (opts.currentTool) {
    chunks.push(`<div class="chat-tool-phase">⚙ ${esc(opts.currentTool)}</div>`)
  }
  if (opts.toolsUsed?.length) {
    chunks.push(
      `<div class="chat-mcp-card">` +
      `<div class="chat-mcp-title">MCP 调用</div>` +
      `<div class="tool-chips">${opts.toolsUsed.map(tool => `<span class="tool-chip">${esc(tool)}</span>`).join('')}</div>` +
      `</div>`,
    )
  }
  if (reasoningParts.length) {
    chunks.push(
      `<details class="chat-reasoning" ${opts.loading ? 'open' : ''}>` +
      `<summary>深度思考</summary>` +
      `<div class="chat-reasoning-body">${esc(reasoningParts.join('\n\n'))}</div>` +
      `</details>`,
    )
  }
  if (extracted.body) chunks.push(renderMarkdown(extracted.body))
  for (const call of extracted.mcpCalls) {
    chunks.push(
      `<div class="chat-mcp-card">` +
      `<div class="chat-mcp-title">MCP 调用</div>` +
      `<pre class="chat-mcp-pre">${esc(call)}</pre>` +
      `</div>`,
    )
  }
  if (!chunks.length && opts.loading) {
    chunks.push('<div class="chat-empty-live">思考中...</div><div class="thinking"><span></span><span></span><span></span></div>')
  }
  return chunks.join('')
}

function renderChatFrame(
  text: string,
  opts: { reasoning?: string; currentTool?: string; loading?: boolean; toolsUsed?: string[]; events?: ChatLiveEvent[] } = {},
): string {
  return [
    ...(opts.events || []).map(renderChatEvent),
    renderChatContent(text, opts),
  ].filter(Boolean).join('')
}
function appendChatMsg(role: 'user'|'ai', content: string): HTMLElement {
  chatNoKey.style.display = 'none'
  const el = document.createElement('div')
  el.className = `chat-msg ${role}`
  el.innerHTML = `<div class="chat-avatar">${role==='ai'?'✨':'👤'}</div><div class="chat-bubble">${renderChatContent(content)}</div>`
  chatMsgs.appendChild(el)
  chatMsgs.scrollTop = chatMsgs.scrollHeight
  return el
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

async function runServerChat(text: string, thinking: HTMLElement) {
  const sessionId = `ext-${selectedMemberId}`
  const { run_id } = await startChatRun(serverUrl, auth.token, selectedMemberId!, sessionId, text)
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

  appendChatMsg('user', text)
  const thinking = showThinking()
  setChatBusy(true)

  if (useServerChat()) {
    try {
      const res = await runServerChat(text, thinking)
      setBubble(thinking, renderChatFrame(res.text, { reasoning: res.reasoning, events: res.events }))
      thinking.removeAttribute('id')
    } catch (err: any) {
      setBubble(thinking, renderChatContent(`⚠ 错误: ${err?.message || err}`))
      thinking.removeAttribute('id')
    } finally {
      setChatBusy(false)
    }
  } else {
    // Local AI-key chat via background worker
    chatHistory.push({ role: 'user', content: text })
    ;(window as any)._chatThinking = thinking
    port.postMessage({ type: 'chat:send', messages: chatHistory })
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
  // Role permissions card
  if (mcpRolePerms && mcpRolePerms.roleOrder.length) {
    rolePermsCard.style.display = 'block'
    const rows = mcpRolePerms.roleOrder.map(role => {
      const label = mcpRolePerms!.roleLabels[role] || role
      const allowed = (mcpRolePerms!.rolePermissions[role] && mcpRolePerms!.rolePermissions[role].length)
        ? mcpRolePerms!.rolePermissions[role]
        : (mcpRolePerms!.roleDefaults[role] || [])
      const ceiling = (mcpRolePerms!.roleDefaults[role] || []).length
      return `<div class="kv"><span class="k">${esc(label)}</span><span class="v">${allowed.length} / ${ceiling} 项</span></div>`
    }).join('')
    rolePermsBody.innerHTML = rows + `<div class="login-hint" style="margin-top:6px;text-align:left;">在软件端“系统设置 → MCP 角色权限”中调整范围。</div>`
  } else {
    rolePermsCard.style.display = 'none'
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
    serverUrl:   cfgServer.value.trim(),
    aiKey:       cfgAiKey.value.trim(),
    aiBaseUrl:   cfgAiBase.value.trim() || 'https://api.anthropic.com',
    aiModel:     cfgAiModel.value.trim() || 'claude-sonnet-4-5',
    autoConnect: cfgAutoConn.checked,
    offlineMode: cfgOfflineMode.checked,
    mouseFx:     cfgMouseFx.checked,
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
        const thinking = (window as any)._chatThinking as HTMLElement | undefined
        thinking?.remove()
        setChatBusy(false)
        const reply = msg.text || '完成'
        chatHistory.push({ role: 'assistant', content: reply })
        const el = appendChatMsg('ai', '')
        setBubble(el, renderChatContent(reply, { toolsUsed: msg.toolsUsed || [] }))
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
  if (auth.token) {
    // Validate token in the background; refresh members + role info.
    void (async () => {
      try {
        const me = await getMe(serverUrl, auth.token)
        if (me?.name) { auth.userName = me.name; await saveAuth({ userName: me.name }); updateUserChip() }
        await Promise.all([loadMembers(), loadMcpTools()])
      } catch {
        await doLogout()
      }
    })()
  }
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
