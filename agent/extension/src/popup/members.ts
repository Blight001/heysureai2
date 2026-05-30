// popup/members.ts — software-end account: login / logout and a read-only AI
// member list (shown in the members modal). The device no longer picks its own
// AI; an operator assigns one from the web "作坊" (Workshop) panel. This list is
// purely informational.

import { state, ROLE_LABELS } from './state'
import * as dom from './dom'
import { roleOf, toolCount, hasBrowserMcpPermission, refreshAvatarCache } from './helpers'
import { esc } from './markdown'
import { login as apiLogin, listConfigs, isAuthError } from '../lib/client'
import { saveAuth, clearAuth, getAuth, saveSettings, clearAvatarCache } from '../lib/storage'
import {
  updateUserChip, renderStatus, openLoginModal,
  closeLoginModal, openMembersModal, closeMembersModal,
} from './ui'

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
    await refreshAvatarCache()
    updateUserChip()
    await loadMembers()
    // Logged in → link to the server. The device then shows up in the web
    // Workshop panel where an operator assigns it an AI.
    state.port.postMessage({ type: 'agent:connect' })
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
  state.port.postMessage({ type: 'auth:logout' })
  state.auth = await getAuth()
  state.avatarDataUrl = ''
  await clearAvatarCache()
  closeMembersModal()
  state.members = []
  updateUserChip()
  renderMembers()
}

export async function loadMembers() {
  if (!state.auth.token) return
  dom.membersEmpty.textContent = '加载中…'
  dom.membersEmpty.style.display = 'block'
  try {
    const rows = await listConfigs(state.serverUrl, state.auth.token)
    state.members = rows.filter(hasBrowserMcpPermission)
    renderMembers()
    renderStatus()
  } catch (err: any) {
    if (isAuthError(err)) {
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
    el.className = 'member-card'
    el.innerHTML = `
      <div class="${m.enabled === false ? 'dot-off' : 'dot-on'}"></div>
      <div class="member-ava">${esc((m.name || '?').slice(0,1))}</div>
      <div class="member-info">
        <div class="member-name">${esc(m.name || '未命名')}</div>
        <div class="member-meta">${esc(m.model || '—')} · MCP ${toolCount(m)} 项</div>
      </div>
      <span class="role-badge ${role}">${ROLE_LABELS[role] || role}</span>`
    dom.membersList.appendChild(el)
  }
}

export function wireMembers() {
  dom.loginBtn.addEventListener('click', () => void doLogin())
  dom.loginPassword.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') void doLogin() })
  dom.userChip.addEventListener('click', () => openLoginModal())
  dom.userChip.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key
    if (key === 'Enter' || key === ' ') { e.preventDefault(); openLoginModal() }
  })
  dom.loginModal.addEventListener('click', (e) => { if (e.target === dom.loginModal) closeLoginModal() })
  dom.loginModalClose.addEventListener('click', () => closeLoginModal())
  dom.membersModal.addEventListener('click', (e) => { if (e.target === dom.membersModal) closeMembersModal() })
  dom.membersModalClose.addEventListener('click', () => closeMembersModal())
  dom.membersRefresh.addEventListener('click', () => void loadMembers())
  dom.logoutBtn.addEventListener('click', () => void doLogout())
  dom.connectBtn.addEventListener('click', () => state.port.postMessage({ type: 'agent:connect' }))
  dom.disconnectBtn.addEventListener('click', () => state.port.postMessage({ type: 'agent:disconnect' }))
}
