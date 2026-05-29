// popup/ui.ts — shared presentation layer: theme, connection status, activity
// feed, tab switching, modals, target banners, chat availability and the
// read-only member settings view. Feature modules call into these renderers.

import { AgentStatus, ActivityEntry } from '../lib/types'
import { state, TabName, STATUS_LABELS, ROLE_LABELS } from './state'
import * as dom from './dom'
import { fmt, roleOf, memberById, avatarHtml, getConnectedAiShortLabel, useServerChat } from './helpers'
import { esc } from './markdown'
import { loadMembers, renderMembers } from './members'
import { loadJobs } from './tasks'
import { renderCards } from './cards'
import { refreshServerSessionsAndHistory, updateChatSessionControls } from './chat'

// ── Status display ─────────────────────────────────────────────────────────
export function renderStatus() {
  if (state.offlineMode) {
    dom.statusDot.className = 'status-dot offline'
    dom.statusLabel.textContent = '离线模式'
    return
  }
  dom.statusDot.className = `status-dot ${state.currentStatus}`
  dom.statusLabel.textContent = state.currentStatus === 'registered'
    ? getConnectedAiShortLabel()
    : (STATUS_LABELS[state.currentStatus] || state.currentStatus)
}

export function setStatus(status: AgentStatus) {
  state.currentStatus = status
  renderStatus()
}

// ── Theme ──────────────────────────────────────────────────────────────────
export function applyTheme(theme: 'dark' | 'light', persist = true) {
  state.currentTheme = theme
  document.body.className = theme
  dom.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙'
  if (persist) state.port.postMessage({ type: 'settings:save', payload: { theme } })
}

// ── Activity feed ──────────────────────────────────────────────────────────
const ICON: Record<string, string> = { success:'✓', error:'✗', running:'▶', warn:'⚠', system:'●', info:'ℹ', human:'?' }
const IC_CLS: Record<string, string> = { success:'success', error:'error', running:'running', warn:'warn', system:'system', info:'info', human:'warn' }

export function addEntry(e: ActivityEntry) {
  dom.feedEmpty.style.display = 'none'
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
  dom.feed.appendChild(el)
  dom.feed.scrollTop = dom.feed.scrollHeight
}

// ── Tab switching ──────────────────────────────────────────────────────────
export function switchTab(tab: TabName) {
  state.activeTab = tab
  ;(Object.keys(dom.panes) as TabName[]).forEach(k => dom.panes[k].classList.add('hidden'))
  ;(Object.keys(dom.tabs) as TabName[]).forEach(k => dom.tabs[k].classList.remove('active'))
  dom.panes[tab].classList.remove('hidden')
  dom.tabs[tab].classList.add('active')
  if (tab === 'chat') {
    dom.chatMsgs.scrollTop = dom.chatMsgs.scrollHeight
    if (useServerChat()) void refreshServerSessionsAndHistory()
  }
  if (tab === 'settings' && state.auth.token && state.members.length === 0) void loadMembers()
  if (tab === 'tasks' && state.selectedMemberId && state.auth.token) void loadJobs()
  if (tab === 'cards') void renderCards()
}

// ── Modals ───────────────────────────────────────────────────────────────
export function openLoginModal() {
  dom.loginModal.classList.remove('hidden')
  updateUserChip()
  setTimeout(() => {
    if (!state.auth.token) dom.loginAccount.focus()
  }, 0)
}
export function closeLoginModal() {
  dom.loginModal.classList.add('hidden')
}
export function openMembersModal() {
  dom.membersModal.classList.remove('hidden')
  if (state.auth.token && state.members.length === 0) void loadMembers()
  else renderMembers()
}
export function closeMembersModal() {
  dom.membersModal.classList.add('hidden')
}

// ── Auth chip ──────────────────────────────────────────────────────────────
export function updateUserChip() {
  const auth = state.auth
  if (auth.token) {
    dom.userChip.classList.remove('guest')
    dom.userAva.innerHTML = avatarHtml(auth.avatar, (auth.userName || auth.account || '?').slice(0, 1).toUpperCase())
    dom.userName.textContent = auth.userName || auth.account || '已登录'
  } else {
    dom.userChip.classList.add('guest')
    dom.userAva.textContent = '·'
    dom.userName.textContent = '未登录'
  }
  // Auth-gated settings blocks
  dom.connectionControlCard.classList.toggle('hidden', !auth.token)
  dom.memberSettingsCard.classList.toggle('hidden', !auth.token)
  dom.accountCard.classList.toggle('hidden', !auth.token)
  dom.loginGate.classList.toggle('hidden', !!auth.token)
  dom.accountStatusV.textContent = auth.token ? `已登录：${auth.userName || auth.account}` : '未登录'
  dom.logoutBtn.style.display = auth.token ? 'block' : 'none'
}

// ── Target banners + chat availability ───────────────────────────────────────
export function updateOfflineUi() {
  dom.offlineModelConfig.classList.toggle('hidden', !state.offlineMode)
  renderStatus()
  updateTargetBanners()
}
export function updateTargetBanners() {
  const m = memberById(state.selectedMemberId)
  if (state.offlineMode) {
    dom.chatTarget.classList.remove('empty')
    dom.chatTargetText.innerHTML = `🛜 离线模式 · 模型 <span class="tb-name">${esc(state.localModel || '未配置')}</span>`
  } else if (m) {
    dom.chatTarget.classList.remove('empty')
    dom.chatTargetText.innerHTML = `对话目标：<span class="tb-name">${esc(m.name)}</span>（${ROLE_LABELS[roleOf(m)] || ''}）`
  } else {
    dom.chatTarget.classList.add('empty')
    dom.chatTargetText.textContent = '未选择 AI 成员（将使用本地 AI Key 直连）'
  }
  // Task scheduling always needs the server (login + selected member).
  if (m && !state.offlineMode) {
    dom.taskTarget.classList.remove('empty')
    dom.taskTarget.innerHTML = `任务目标：<span class="tb-name">${esc(m.name)}</span>`
    dom.taskForm.style.display = 'block'
    dom.taskJobsCard.style.display = 'block'
  } else {
    dom.taskTarget.classList.add('empty')
    dom.taskTarget.textContent = state.offlineMode
      ? '离线模式下不可安排任务（任务需登录服务器）'
      : (state.auth.token ? '请先在“成员”中选择一个 AI 成员' : '请先登录并选择 AI 成员')
    dom.taskForm.style.display = 'none'
    dom.taskJobsCard.style.display = 'none'
  }
  refreshChatAvailability()
}
export function refreshChatAvailability() {
  const enabled = useServerChat() || state.hasAiKey
  const hasMessages = dom.chatMsgs.querySelectorAll('.chat-msg').length > 0
  dom.chatNoKey.style.display = (enabled || hasMessages) ? 'none' : 'flex'
  dom.chatInput.disabled = !enabled || state.chatBusy
  dom.chatSendBtn.disabled = !enabled || state.chatBusy
  // In server mode the clear button is "新建对话" — always available so users
  // can start a fresh session even when the current view is empty.
  if (useServerChat()) {
    dom.chatClearBtn.disabled = state.chatBusy
  } else {
    dom.chatClearBtn.disabled = !hasMessages && !state.chatHistory.length && !state.chatBusy
  }
  updateChatSessionControls()
}

// ── Settings (read-only views) ────────────────────────────────────────────────
export function renderSettingsViews() {
  // Member config card
  const m = memberById(state.selectedMemberId)
  if (m) {
    dom.memberSettingsCard.style.display = 'block'
    let tools: string[] = []
    try { const a = JSON.parse(m.mcp_tools || '[]'); if (Array.isArray(a)) tools = a } catch { /* ignore */ }
    const chips = tools.length
      ? `<div class="tool-chips">${tools.map(t => `<span class="tool-chip">${esc(t)}</span>`).join('')}</div>`
      : `<div class="empty-note">未分配 MCP 工具</div>`
    dom.memberSettingsBody.innerHTML = `
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
    dom.memberSettingsCard.style.display = 'none'
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────
export function wireUi() {
  ;(Object.keys(dom.tabs) as TabName[]).forEach(k => dom.tabs[k].addEventListener('click', () => switchTab(k)))
  dom.themeToggle.addEventListener('click', () => applyTheme(state.currentTheme === 'dark' ? 'light' : 'dark'))
  dom.clearBtn.addEventListener('click', () => {
    dom.feed.querySelectorAll('.entry').forEach(e => e.remove())
    dom.feedEmpty.style.display = 'flex'
  })
}
