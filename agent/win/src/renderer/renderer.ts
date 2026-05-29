// renderer.ts — HeySure Agent renderer process
//
// The desktop app is now a thin tool-calling endpoint: it logs in, selects an
// AI member, registers with the server and then executes whatever tool calls
// the server dispatches over the socket. Task management and AI chat now live
// entirely on the web console, so this renderer only owns login / AI selection,
// connection control and a live feed of the tool calls the agent performs.

interface Window {
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
    onAuthExpired: (cb: (reason: string) => void) => void
    setTheme: (theme: 'dark' | 'light') => Promise<void>
    testConnection: () => Promise<{ success: boolean; status?: number; ms?: number; error?: string }>
    login: (params: { serverUrl: string; account: string; password: string }) => Promise<{ success: boolean; user: any }>
    logout: () => Promise<{ success: boolean }>
    listAiConfigs: () => Promise<any[]>
    getAiRuntimeStatus: () => Promise<any[]>
    selectAiConfig: (cfg: any) => Promise<{ success: boolean }>
    cloneAiConfig: (configId: number) => Promise<any>
    version: string
  }
}

// ── State ──────────────────────────────────────────────────────────────────
type AppScreen = 'login' | 'ai-select' | 'main'
let currentTheme: 'dark' | 'light' = 'dark'
let totalCalls = 0, successCalls = 0, failedCalls = 0, runningCalls = 0
let sidebarOpen = false
let currentConnectionStatus = 'disconnected'
let currentAiDisplayName = ''
let selectedAiConfigId: number | null = null

// ── Screen navigation ──────────────────────────────────────────────────────
function showScreen(screen: AppScreen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(`screen-${screen}`)?.classList.add('active')
}

// ── DOM refs (main screen) ─────────────────────────────────────────────────
const feed            = document.getElementById('feed')!
const feedEmpty       = document.getElementById('feed-empty')!
const bodyEl          = document.getElementById('body')!
const statusDot       = document.getElementById('status-dot')!
const statusLabel     = document.getElementById('status-label')!
const statusPill      = document.getElementById('status-pill')!
const infoStatus      = document.getElementById('info-status')!
const infoServer      = document.getElementById('info-server')!
const infoWorkspace   = document.getElementById('info-workspace')!
const statTotal       = document.getElementById('stat-total')!
const statSuccess     = document.getElementById('stat-success')!
const statFailed      = document.getElementById('stat-failed')!
const statRunning     = document.getElementById('stat-running')!
const cfgServer       = document.getElementById('cfg-server') as HTMLInputElement
const cfgWorkspace    = document.getElementById('cfg-workspace') as HTMLInputElement
const saveBtn         = document.getElementById('save-btn')!
const saveFeedback    = document.getElementById('save-feedback')!
const connectBtn      = document.getElementById('connect-btn')!
const disconnectBtn   = document.getElementById('disconnect-btn')!
const clearBtn        = document.getElementById('clear-btn')!
const settingsToggle  = document.getElementById('settings-toggle')!
const testConnBtn     = document.getElementById('test-conn-btn')!
const testResult      = document.getElementById('test-result')!
const aiInfoName      = document.getElementById('ai-info-name')!
const aiInfoRole      = document.getElementById('ai-info-role')!
const aiInfoLifecycle = document.getElementById('ai-info-lifecycle')!
const aiInfoProject   = document.getElementById('ai-info-project')!
const headerUserChip  = document.getElementById('header-user-chip')!
const headerUserAva   = document.getElementById('header-user-ava')!
const headerUserName  = document.getElementById('header-user-name')!
const aiSelectTarget  = document.getElementById('ai-select-target')!
const aiSelectTargetText = document.getElementById('ai-select-target-text')!

const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接', connecting: '连接中...', connected: '已连接', registered: '已注册', error: '连接错误',
}
const DESKTOP_AGENT_MCP_TOOLS = new Set([
  'fs.list', 'fs.read', 'fs.write',
  'shell.run', 'git.diff',
  'keyboard.type', 'keyboard.press',
  'mouse.move', 'mouse.click', 'mouse.double_click', 'mouse.right_click', 'mouse.scroll', 'mouse.drag',
  'screen.capture', 'screen.capture_region', 'screen.info',
  'clipboard.get', 'clipboard.set',
  'window.list', 'window.focus', 'window.close',
  'process.list', 'process.kill',
])

// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme(theme: 'dark' | 'light', persist = true) {
  currentTheme = theme
  document.body.className = theme
  const icon = theme === 'dark' ? '&#x2600;&#xFE0F;' : '&#x1F319;'
  ;[document.getElementById('theme-toggle'), document.getElementById('theme-toggle2')].forEach(el => { if (el) el.innerHTML = icon })
  if (persist) window.heysureAPI.setTheme(theme)
}
;[document.getElementById('theme-toggle'), document.getElementById('theme-toggle2')].forEach(btn =>
  btn?.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'))
)

// ── Status display ─────────────────────────────────────────────────────────
function setStatus(status: string) {
  currentConnectionStatus = status
  const rawLabel = STATUS_LABELS[status] || status
  const label = status === 'registered' && currentAiDisplayName ? currentAiDisplayName : rawLabel
  statusDot.className = status
  statusLabel.textContent = label
  infoStatus.textContent = rawLabel
  infoStatus.className = `info-value ${status}`
}

function updateStats() {
  statTotal.textContent = String(totalCalls)
  statSuccess.textContent = String(successCalls)
  statFailed.textContent = String(failedCalls)
  statRunning.textContent = String(runningCalls)
}

function setSidebarOpen(open: boolean) {
  sidebarOpen = open
  bodyEl.classList.toggle('sidebar-open', open)
  settingsToggle.classList.toggle('active', open)
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatTime(ts: number) {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}
function escapeHtml(str: string) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function lifecycleLabel(lc: string) {
  return ({ learning: '学习中', working: '工作中', reproducing: '繁殖中', dead: '退役' } as any)[lc] || lc
}

// ── Activity feed ──────────────────────────────────────────────────────────
function addEntry(entry: { id?: string; type: string; status: string; message: string; data?: any; timestamp: number }) {
  feedEmpty.style.display = 'none'
  const el = document.createElement('div')
  el.className = 'entry'

  const iconCls = (() => {
    if (entry.status === 'success') return 'success'
    if (entry.status === 'error') return 'error'
    if (entry.status === 'running') return 'running'
    if (entry.status === 'warn') return 'warn'
    if (entry.type === 'system') return 'system'
    return 'info'
  })()
  const badgeCls = ({ task: 'task', system: 'system', error: 'error', warn: 'warn' } as any)[entry.type] || 'info'
  const icon = ({ success: '✓', error: '✗', running: '▶', warn: '⚠', system: '●' } as any)[entry.status] || 'ℹ'

  let dataHtml = ''
  if (entry.data !== undefined && entry.data !== null) {
    const s = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)
    dataHtml = `<button class="entry-data-toggle" onclick="toggleData(this)"><span class="arrow">&#x25B6;</span> 详情</button><div class="entry-data"><pre>${escapeHtml(s)}</pre></div>`
  }
  let badgeHtml = ''
  if (entry.status === 'success' || entry.status === 'error' || entry.status === 'running') {
    const bLabel = entry.status === 'success' ? '成功' : entry.status === 'error' ? '失败' : '进行中'
    badgeHtml = `<span class="entry-status-badge ${entry.status}">${bLabel}</span>`
  }

  el.innerHTML = `
    <div class="entry-icon ${iconCls}">${icon}</div>
    <div class="entry-body">
      <div class="entry-top"><span class="entry-type ${badgeCls}">${entry.type}</span><span class="entry-time">${formatTime(entry.timestamp)}</span></div>
      <div class="entry-message">${escapeHtml(entry.message)}</div>
      ${badgeHtml}${dataHtml}
    </div>`
  feed.appendChild(el)
  feed.scrollTop = feed.scrollHeight
}

;(window as any).toggleData = function(btn: HTMLButtonElement) {
  btn.classList.toggle('open')
  ;(btn.nextElementSibling as HTMLElement)?.classList.toggle('visible')
}

// ── Settings ───────────────────────────────────────────────────────────────
async function loadMainSettings() {
  const s = await window.heysureAPI.getSettings()
  selectedAiConfigId = typeof s.selectedAiConfigId === 'number' ? s.selectedAiConfigId : null
  cfgServer.value = s.serverUrl || ''
  cfgWorkspace.value = s.workspaceRoot || ''
  infoServer.textContent    = s.serverUrl || '—'
  infoWorkspace.textContent = s.workspaceRoot ? (s.workspaceRoot.split(/[/\\]/).pop() || s.workspaceRoot) : '—'
  if (s.selectedAiConfigName) updateAiMemberDisplay(s)
  else clearAiMemberDisplay()
  updateUserChip(s)
  return s
}

function updateAiMemberDisplay(s: any) {
  const isManager = s.selectedAiConfigRole === 'manager'
  const name = s.selectedAiConfigName || '—'
  selectedAiConfigId = typeof s.selectedAiConfigId === 'number' ? s.selectedAiConfigId : selectedAiConfigId
  currentAiDisplayName = name === '—' ? '' : (isManager ? `★ ${name}` : name)
  aiInfoName.textContent = name
  aiInfoRole.textContent = isManager ? '组长 (Manager)' : '成员 (Member)'
  aiInfoLifecycle.textContent = lifecycleLabel(s.selectedAiConfigLifecycle)
  aiInfoProject.textContent = s.selectedAiConfigProject || '—'
  updateAiSelectTarget()
  setStatus(currentConnectionStatus)
}

function clearAiMemberDisplay() {
  selectedAiConfigId = null
  currentAiDisplayName = ''
  aiInfoName.textContent = '—'
  aiInfoRole.textContent = '—'
  aiInfoLifecycle.textContent = '—'
  aiInfoProject.textContent = '—'
  updateAiSelectTarget()
  setStatus(currentConnectionStatus)
}

function updateAiSelectTarget() {
  if (currentAiDisplayName) {
    aiSelectTarget.classList.remove('empty')
    aiSelectTargetText.innerHTML = `当前 AI：<span class="tb-name">${escapeHtml(currentAiDisplayName)}</span>`
  } else {
    aiSelectTarget.classList.add('empty')
    aiSelectTargetText.textContent = '未选择 AI 成员'
  }
}

async function saveSettings() {
  const settings = {
    serverUrl: cfgServer.value.trim(),
    workspaceRoot: cfgWorkspace.value.trim(),
  }
  try {
    await window.heysureAPI.saveSettings(settings)
    infoServer.textContent = settings.serverUrl || '—'
    infoWorkspace.textContent = settings.workspaceRoot ? (settings.workspaceRoot.split(/[/\\]/).pop() || settings.workspaceRoot) : '—'
    saveFeedback.style.color = ''; saveFeedback.textContent = '已保存 ✓'
    setTimeout(() => { saveFeedback.textContent = '' }, 2000)
  } catch {
    saveFeedback.textContent = '保存失败'; saveFeedback.style.color = 'var(--error)'
    setTimeout(() => { saveFeedback.textContent = ''; saveFeedback.style.color = '' }, 3000)
  }
}
saveBtn.addEventListener('click', saveSettings)

testConnBtn.addEventListener('click', async () => {
  testResult.textContent = '测试中...'; testResult.className = 'test-result'
  testConnBtn.setAttribute('disabled', 'true')
  try {
    const r = await window.heysureAPI.testConnection()
    testResult.textContent = r.success ? `✓ 连接成功 (${r.status}) · ${r.ms}ms` : `✗ ${r.error}`
    testResult.className = `test-result ${r.success ? 'success' : 'error'}`
  } catch (err: any) {
    testResult.textContent = `✗ ${err.message}`; testResult.className = 'test-result error'
  } finally { testConnBtn.removeAttribute('disabled') }
})

connectBtn.addEventListener('click', () => window.heysureAPI.connect())
disconnectBtn.addEventListener('click', () => window.heysureAPI.disconnect())
clearBtn.addEventListener('click', () => {
  feed.querySelectorAll('.entry').forEach(e => e.remove())
  feedEmpty.style.display = 'flex'
})
settingsToggle.addEventListener('click', () => setSidebarOpen(!sidebarOpen))

window.heysureAPI.onStatusChange(setStatus)
window.heysureAPI.onActivityLog(addEntry)
window.heysureAPI.onTaskStart((data) => {
  totalCalls++; runningCalls++
  addEntry({ id: data.taskId, type: 'task', status: 'running', message: `执行工具: ${data.tool}`, data: data.args && Object.keys(data.args).length > 0 ? data.args : undefined, timestamp: data.timestamp || Date.now() })
  updateStats()
})
window.heysureAPI.onTaskResult((data) => {
  runningCalls = Math.max(0, runningCalls - 1)
  data.success ? successCalls++ : failedCalls++
  addEntry({ id: data.taskId + '_result', type: 'task', status: data.success ? 'success' : 'error', message: `${data.success ? '完成' : '失败'}: ${data.tool}`, data: data.result ?? undefined, timestamp: data.timestamp || Date.now() })
  updateStats()
})

// ══════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════
const loginAccountInput  = document.getElementById('login-account') as HTMLInputElement
const loginPasswordInput = document.getElementById('login-password') as HTMLInputElement
const loginBtn           = document.getElementById('login-btn') as HTMLButtonElement
const loginError         = document.getElementById('login-error')!
const loginModal         = document.getElementById('login-modal')!
const loginModalClose    = document.getElementById('login-modal-close')!
const aiSelectModal      = document.getElementById('ai-select-modal')!
const aiSelectModalClose = document.getElementById('ai-select-modal-close')!

function showLoginError(msg: string) { loginError.textContent = msg; loginError.classList.add('visible') }
function clearLoginError() { loginError.classList.remove('visible') }

function openLoginModal() {
  loginModal.classList.remove('hidden')
  clearLoginError()
  window.heysureAPI.getSettings().then(s => {
    loginAccountInput.value = s.userAccount || ''
    updateUserChip(s)
    setTimeout(() => (s.authToken ? loginModalClose : loginAccountInput).focus(), 0)
  }).catch(() => {})
}

function closeLoginModal() {
  loginModal.classList.add('hidden')
}

function openAiSelectModal() {
  aiSelectModal.classList.remove('hidden')
  window.heysureAPI.getSettings().then(s => {
    updateUserChip(s)
    if (!s.authToken) {
      aiGrid.innerHTML = '<div class="ai-empty"><div class="ai-empty-icon">&#x1F512;</div><p>请先点击头像登录软件端账号</p></div>'
      return
    }
    loadAiSelectScreen().catch(() => {})
  }).catch(() => {})
}

function closeAiSelectModal() {
  aiSelectModal.classList.add('hidden')
}

document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  closeLoginModal()
  closeAiSelectModal()
})

window.heysureAPI.onAuthExpired(async reason => {
  const s = await window.heysureAPI.getSettings()
  updateUserChip(s)
  selectedAiConfigId = null
  currentAiDisplayName = ''
  updateAiSelectTarget()
  openLoginModal()
  showLoginError(reason || '登录已过期，请重新登录')
})

async function doLogin() {
  clearLoginError()
  const saved = await window.heysureAPI.getSettings()
  const serverUrl = (cfgServer.value.trim() || saved.serverUrl || '').trim()
  const account   = loginAccountInput.value.trim()
  const password  = loginPasswordInput.value
  if (!serverUrl) { showLoginError('请先在设置中配置服务器地址'); return }
  if (!account)   { showLoginError('请输入账号'); return }
  if (!password)  { showLoginError('请输入密码'); return }

  loginBtn.classList.add('loading'); loginBtn.disabled = true
  try {
    await window.heysureAPI.login({ serverUrl, account, password })
    const s = await window.heysureAPI.getSettings()
    loginPasswordInput.value = ''
    updateUserChip(s)
    closeLoginModal()
    await loadMainSettings()
    openAiSelectModal()
  } catch (err: any) {
    showLoginError(err.message || '登录失败')
  } finally {
    loginBtn.classList.remove('loading'); loginBtn.disabled = false
  }
}
loginBtn.addEventListener('click', doLogin)
;[loginAccountInput, loginPasswordInput].forEach(el =>
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin() })
)
loginModalClose.addEventListener('click', closeLoginModal)
loginModal.addEventListener('click', e => { if (e.target === loginModal) closeLoginModal() })
statusPill.addEventListener('click', openAiSelectModal)
statusPill.addEventListener('keydown', e => {
  const key = (e as KeyboardEvent).key
  if (key === 'Enter' || key === ' ') {
    e.preventDefault()
    openAiSelectModal()
  }
})
aiSelectModalClose.addEventListener('click', closeAiSelectModal)
aiSelectModal.addEventListener('click', e => { if (e.target === aiSelectModal) closeAiSelectModal() })

// ══════════════════════════════════════════════════════
// AI SELECT
// ══════════════════════════════════════════════════════
const aiGrid       = document.getElementById('ai-grid')!
const logoutBtn    = document.getElementById('logout-btn')!
const refreshAiBtn = document.getElementById('refresh-ai-btn')!
const accountInfoBlock     = document.getElementById('account-info') as HTMLElement
const accountInfoAva       = document.getElementById('account-info-ava') as HTMLElement
const accountInfoAvaImg    = document.getElementById('account-info-ava-img') as HTMLImageElement
const accountInfoAvaText   = document.getElementById('account-info-ava-text') as HTMLElement
const accountInfoName      = document.getElementById('account-info-name') as HTMLElement
const accountInfoServer    = document.getElementById('account-info-server') as HTMLElement
const headerUserAvaImg     = document.getElementById('header-user-ava-img') as HTMLImageElement
const headerUserAvaText    = document.getElementById('header-user-ava-text') as HTMLElement
const loginFormBlock       = document.getElementById('login-form') as HTMLElement

function resolveAvatarUrl(avatar: string, server: string): string {
  const raw = (avatar || '').trim()
  if (!raw) return ''
  const base = (server || '').replace(/\/+$/, '')
  // Preset avatars are served by the backend at /avatars/avatarsN.png. The
  // stored value is the web console's bundled URL (e.g. /assets/avatars2-<hash>.png),
  // so extract the 1-5 index and resolve it against the server.
  const preset = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i)
  if (preset) return base ? `${base}/avatars/avatars${preset[1]}.png` : ''
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw
  if (!base) return raw
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`
}

function bindAvatarImage(imgEl: HTMLImageElement, container: HTMLElement, src: string, fallbackText: string, textEl: HTMLElement) {
  textEl.textContent = fallbackText
  container.classList.remove('has-image')
  imgEl.onload = null
  imgEl.onerror = null
  if (!src) {
    imgEl.removeAttribute('src')
    return
  }
  imgEl.onload = () => container.classList.add('has-image')
  imgEl.onerror = () => container.classList.remove('has-image')
  imgEl.src = src
}

function setUserChip(displayName: string, avatar: string, server: string, authenticated = true, avatarDataUrl = '') {
  const host = (() => { try { return new URL(server).hostname } catch { return server || '—' } })()
  const shown = (displayName || '').trim()
  const initial = shown ? shown.slice(0, 1).toUpperCase() : '·'
  // Prefer the cached data URL (instant, offline); fall back to the live URL.
  const resolvedAvatar = authenticated && shown ? (avatarDataUrl || resolveAvatarUrl(avatar, server)) : ''
  headerUserName.textContent = authenticated && shown ? shown : '未登录'
  bindAvatarImage(headerUserAvaImg, headerUserAva, resolvedAvatar, initial, headerUserAvaText)
  headerUserChip.classList.toggle('logged-in', !!(authenticated && shown))
  // Login modal: swap between login form and account info
  if (authenticated && shown) {
    bindAvatarImage(accountInfoAvaImg, accountInfoAva, resolvedAvatar, initial, accountInfoAvaText)
    accountInfoName.textContent = shown
    accountInfoServer.textContent = host
    accountInfoBlock.style.display = 'flex'
    loginFormBlock.style.display = 'none'
  } else {
    accountInfoBlock.style.display = 'none'
    loginFormBlock.style.display = 'flex'
  }
}

function updateUserChip(s: any) {
  setUserChip(s.userName || '', s.userAvatar || '', s.serverUrl || '', !!s.authToken, s.userAvatarDataUrl || '')
}

function parseMcpTools(value: any): string[] {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
}

function hasDesktopMcpPermission(cfg: any) {
  if (cfg?.mcp_enabled === false) return false
  return parseMcpTools(cfg?.mcp_tools).some(tool => DESKTOP_AGENT_MCP_TOOLS.has(tool))
}

function roleOfConfig(cfg: any) {
  if (cfg?.ai_role === 'assistant_admin') return 'assistant_admin'
  return cfg?.digital_member_role === 'manager' ? 'manager' : 'member'
}

function roleLabel(role: string) {
  return ({ assistant_admin: '辅助管理员', manager: '管理者', member: '普通成员' } as Record<string, string>)[role] || role
}

async function doLogout() {
  await window.heysureAPI.logout()
  const s = await window.heysureAPI.getSettings()
  cfgServer.value = s.serverUrl || ''
  loginAccountInput.value = ''
  loginPasswordInput.value = ''
  updateUserChip(s)
  clearAiMemberDisplay()
  clearLoginError()
  closeLoginModal()
  closeAiSelectModal()
  setStatus('disconnected')
}

headerUserChip.addEventListener('click', () => openLoginModal())

async function loadAiSelectScreen() {
  aiGrid.innerHTML = '<div class="ai-loading"><div class="spinner-large"></div><p>加载 AI 成员列表...</p></div>'
  try {
    const [configs, statuses, settings] = await Promise.all([
      window.heysureAPI.listAiConfigs(),
      window.heysureAPI.getAiRuntimeStatus(),
      window.heysureAPI.getSettings(),
    ])
    selectedAiConfigId = typeof settings.selectedAiConfigId === 'number' ? settings.selectedAiConfigId : null
    currentAiDisplayName = settings.selectedAiConfigName || currentAiDisplayName
    updateAiSelectTarget()
    renderAiGrid(configs, statuses)
  } catch (err: any) {
    aiGrid.innerHTML = `<div class="ai-empty"><div class="ai-empty-icon">&#x26A0;</div><p>加载失败: ${escapeHtml(err.message || String(err))}</p><button class="btn btn-secondary" onclick="loadAiSelectScreen()" style="margin-top:8px">重试</button></div>`
  }
}

function renderAiGrid(configs: any[], statuses: any[]) {
  const desktopConfigs = (configs || []).filter(hasDesktopMcpPermission)
  const statusMap = new Map<number, any>()
  statuses.forEach(s => statusMap.set(s.ai_config_id, s))

  if (!configs || configs.length === 0) {
    aiGrid.innerHTML = '<div class="ai-empty"><div class="ai-empty-icon">&#x1F916;</div><p>暂无 AI 成员</p><p style="font-size:11px">请先在网页端项目中创建 AI 成员</p></div>'
    return
  }

  if (desktopConfigs.length === 0) {
    aiGrid.innerHTML = '<div class="ai-empty"><div class="ai-empty-icon">&#x1F5A5;</div><p>暂无具备 Windows 桌面权限的 AI 成员</p><p style="font-size:11px">请在网页端 AI 设置中为成员开启桌面端 MCP 工具权限</p></div>'
    return
  }

  aiGrid.innerHTML = ''
  desktopConfigs.forEach(cfg => {
    const role = roleOfConfig(cfg)
    const isAdmin = role === 'assistant_admin'
    const rs = statusMap.get(cfg.id)
    const isEnabled = rs?.running ?? cfg.enabled
    const tools = parseMcpTools(cfg?.mcp_tools)
    const toolsHtml = tools.length === 0
      ? '<div class="member-tool-empty">未配置可调用的 MCP 工具</div>'
      : `<div class="member-tools">${
          tools.slice(0, 12).map(tool => `<span class="member-tool-chip">${escapeHtml(tool)}</span>`).join('')
        }${tools.length > 12 ? `<span class="member-tool-chip more">+${tools.length - 12}</span>` : ''}</div>`

    const card = document.createElement('div')
    card.className = `member-card${cfg.id === selectedAiConfigId ? ' selected' : ''}${isAdmin ? ' admin-card' : ''}`

    card.innerHTML = `
      <div class="${isEnabled ? 'member-dot-on' : 'member-dot-off'}"></div>
      <div class="member-ava">${escapeHtml((cfg.name || '?').slice(0, 1))}</div>
      <div class="member-info">
        <div class="member-name">${escapeHtml(cfg.name || '未命名')}</div>
        <div class="member-meta">${escapeHtml(cfg.model || '—')} · MCP ${tools.length} 项 · ${escapeHtml(cfg.project_name || cfg.description || '无项目')}</div>
      </div>
      <span class="role-badge ${role}">${roleLabel(role)}</span>
      ${toolsHtml}`

    if (!isAdmin) {
      card.addEventListener('click', async () => {
        card.classList.add('selected')
        try {
          await window.heysureAPI.selectAiConfig(cfg)
          const s = await window.heysureAPI.getSettings()
          await loadMainSettings()
          updateAiMemberDisplay(s)
          const status = await window.heysureAPI.getStatus()
          setStatus(status)
          closeAiSelectModal()
          showScreen('main')
        } catch (err: any) {
          alert('选择失败: ' + (err.message || String(err)))
          await loadAiSelectScreen()
        }
      })
    }

    aiGrid.appendChild(card)
  })
}

;(window as any).loadAiSelectScreen = loadAiSelectScreen

logoutBtn.addEventListener('click', () => doLogout())

refreshAiBtn.addEventListener('click', () => loadAiSelectScreen())

function goToAiSelect() {
  openAiSelectModal()
}
document.getElementById('switch-ai-btn2')?.addEventListener('click', goToAiSelect)

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
async function init() {
  const s = await window.heysureAPI.getSettings()
  applyTheme(s.theme || 'dark', false)
  cfgServer.value = s.serverUrl || ''
  loginAccountInput.value = s.userAccount || ''
  updateUserChip(s)
  await loadMainSettings()
  updateStats()
  const status = await window.heysureAPI.getStatus()
  setStatus(status)
  showScreen('main')

  if (s.authToken && s.selectedAiConfigId) {
    loadAiSelectScreen().catch(() => {})
  } else if (s.authToken) {
    openAiSelectModal()
  } else {
    openLoginModal()
  }
}

init().catch(console.error)
