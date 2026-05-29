// popup/members.ts — software-end account: login / logout and the AI member
// list (load, render, select). Selecting a member is what targets chat/tasks
// at a server-side AI config.

import { state, ROLE_LABELS } from './state'
import * as dom from './dom'
import { roleOf, toolCount, hasBrowserMcpPermission, syncSelectedAiToBackground, useServerChat } from './helpers'
import { esc } from './markdown'
import {
  login as apiLogin, listConfigs, isAuthError, MemberConfig,
} from '../lib/client'
import { saveAuth, clearAuth, getAuth, saveSettings } from '../lib/storage'
import {
  updateUserChip, renderStatus, renderSettingsViews, updateTargetBanners,
  switchTab, openLoginModal, closeLoginModal, openMembersModal, closeMembersModal,
} from './ui'
import { renderChatHistory, updateChatSessionControls, refreshServerSessionsAndHistory } from './chat'

export async function doLogin() {
  const configuredServerUrl = dom.cfgServer.value.trim()
  if (configuredServerUrl && configuredServerUrl !== state.serverUrl) {
    state.serverUrl = configuredServerUrl
    await saveSettings({ serverUrl: state.serverUrl })
    state.port.postMessage({ type: 'settings:save', payload: { serverUrl: state.serverUrl } })
  }
  const account = dom.loginAccount.value.trim()
  const password = dom.loginPassword.value
  if (!account || !password) { dom.loginFeedback.textContent = '请输入账号和密码'; dom.loginFeedback.style.color = 'var(--error)'; return }
  if (!state.serverUrl) { dom.loginFeedback.textContent = '请先在设置中配置服务器 URL'; dom.loginFeedback.style.color = 'var(--error)'; return }
  dom.loginBtn.disabled = true
  dom.loginFeedback.textContent = '登录中…'
  dom.loginFeedback.style.color = 'var(--muted)'
  try {
    const { token, user } = await apiLogin(state.serverUrl, account, password)
    state.auth = { token, account, userId: user?.id ?? null, userName: user?.name || account, avatar: user?.avatar || '' }
    await saveAuth(state.auth)
    dom.loginPassword.value = ''
    dom.loginFeedback.textContent = '登录成功 ✓'
    dom.loginFeedback.style.color = 'var(--success)'
    updateUserChip()
    await loadMembers()
    syncSelectedAiToBackground(true)
    renderSettingsViews()
    if (useServerChat()) await refreshServerSessionsAndHistory()
    closeLoginModal()
    openMembersModal()
  } catch (err: any) {
    dom.loginFeedback.textContent = `登录失败：${err?.message || err}`
    dom.loginFeedback.style.color = 'var(--error)'
  } finally {
    dom.loginBtn.disabled = false
  }
}

export async function doLogout() {
  await clearAuth()
  // Tell the background to drop its socket so the server sees us leaving.
  // Without this the socket stays open and the agent keeps trying to
  // re-register with an empty token (the server now rejects this, but the
  // socket-level connection would still show "已连接" in the popup).
  state.port.postMessage({ type: 'auth:logout' })
  state.port.postMessage({ type: 'agent:selected-ai', aiConfigId: null })
  state.auth = await getAuth()
  closeMembersModal()
  state.members = []
  state.selectedMemberId = null
  state.serverSessions = []
  state.currentServerSessionId = ''
  state.lastSyncedMessageId = 0
  state.chatHistory = []
  renderChatHistory()
  updateChatSessionControls()
  updateUserChip()
  renderMembers()
  updateTargetBanners()
  renderSettingsViews()
  switchTab('settings')
}

export async function loadMembers() {
  if (!state.auth.token) return
  dom.membersEmpty.textContent = '加载中…'
  dom.membersEmpty.style.display = 'block'
  try {
    const rows = await listConfigs(state.serverUrl, state.auth.token)
    state.members = rows.filter(hasBrowserMcpPermission)
    if (state.selectedMemberId) {
      const stillExists = rows.some(m => m.id === state.selectedMemberId)
      if (!stillExists) {
        // Truly gone (deleted) — drop the selection and reset the chat.
        state.selectedMemberId = null
        state.port.postMessage({ type: 'agent:selected-ai', aiConfigId: null })
        state.serverSessions = []
        state.currentServerSessionId = ''
        state.lastSyncedMessageId = 0
        state.chatHistory = []
        renderChatHistory()
        updateChatSessionControls()
      } else {
        // The member still exists but may have been filtered out of the
        // browser-capable list (e.g. an admin toggled its MCP tools). Keep
        // it selected/visible so an unrelated config edit doesn't silently
        // reset the user's choice and model target.
        if (!state.members.some(m => m.id === state.selectedMemberId)) {
          const sel = rows.find(m => m.id === state.selectedMemberId)
          if (sel) state.members = [...state.members, sel]
        }
        state.port.postMessage({ type: 'agent:selected-ai', aiConfigId: state.selectedMemberId })
      }
    }
    renderMembers()
    updateTargetBanners()
    renderSettingsViews()
    renderStatus()
  } catch (err: any) {
    if (isAuthError(err)) {
      // token expired / invalid
      await doLogout()
      dom.loginFeedback.textContent = '登录已过期，请重新登录'
      dom.loginFeedback.style.color = 'var(--warn)'
      return
    }
    dom.membersEmpty.textContent = `加载失败：${err?.message || err}`
  }
}

export function renderMembers() {
  dom.membersList.querySelectorAll('.member-card').forEach(e => e.remove())
  if (!state.members.length) {
    dom.membersEmpty.style.display = 'block'
    dom.membersEmpty.textContent = state.auth.token ? '暂无可显示的 AI 成员' : '请先登录'
    return
  }
  dom.membersEmpty.style.display = 'none'
  for (const m of state.members) {
    const role = roleOf(m)
    const el = document.createElement('div')
    el.className = `member-card${m.id === state.selectedMemberId ? ' selected' : ''}`
    el.innerHTML = `
      <div class="${m.enabled === false ? 'dot-off' : 'dot-on'}"></div>
      <div class="member-ava">${esc((m.name || '?').slice(0,1))}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.name || '未命名')}</div>
        <div class="member-meta">${esc(m.model || '—')} · MCP ${toolCount(m)} 项</div>
      </div>
      <span class="role-badge ${role}">${ROLE_LABELS[role] || role}</span>`
    el.addEventListener('click', () => selectMember(m.id))
    dom.membersList.appendChild(el)
  }
}

export async function selectMember(id: number) {
  if (!state.auth.token) {
    state.selectedMemberId = null
    state.port.postMessage({ type: 'agent:selected-ai', aiConfigId: null })
    dom.loginFeedback.textContent = '请先登录后再选择 AI 成员'
    dom.loginFeedback.style.color = 'var(--warn)'
    switchTab('settings')
    renderMembers()
    updateTargetBanners()
    renderSettingsViews()
    return
  }
  state.selectedMemberId = id
  // Persist directly to storage first. Without this the background's
  // register() can read a stale settings snapshot during a fast
  // login -> select-AI -> connect sequence and emit aiConfigId: null,
  // leaving the server-side agent record without an AI assignment.
  await saveSettings({ selectedAiConfigId: id })
  state.port.postMessage({ type: 'agent:selected-ai', aiConfigId: id })
  renderMembers()
  updateTargetBanners()
  renderSettingsViews()
  renderStatus()
  state.chatHistory = []
  state.serverSessions = []
  state.currentServerSessionId = ''
  state.lastSyncedMessageId = 0
  dom.chatMsgs.querySelectorAll('.chat-msg').forEach(e => e.remove())
  updateChatSessionControls()
  if (useServerChat()) void refreshServerSessionsAndHistory()
}

export function wireMembers() {
  dom.loginBtn.addEventListener('click', () => void doLogin())
  dom.loginPassword.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') void doLogin() })
  dom.userChip.addEventListener('click', () => openLoginModal())
  dom.userChip.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key
    if (key === 'Enter' || key === ' ') {
      e.preventDefault()
      openLoginModal()
    }
  })
  dom.loginModal.addEventListener('click', (e) => {
    if (e.target === dom.loginModal) closeLoginModal()
  })
  dom.loginModalClose.addEventListener('click', () => closeLoginModal())
  dom.statusPill.addEventListener('click', () => openMembersModal())
  dom.statusPill.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key
    if (key === 'Enter' || key === ' ') {
      e.preventDefault()
      openMembersModal()
    }
  })
  dom.membersModal.addEventListener('click', (e) => {
    if (e.target === dom.membersModal) closeMembersModal()
  })
  dom.membersModalClose.addEventListener('click', () => closeMembersModal())
  dom.membersRefresh.addEventListener('click', () => void loadMembers())
  dom.logoutBtn.addEventListener('click', () => void doLogout())
}
