// renderer.ts — HeySure Agent desktop renderer process.
//
// The desktop app is a thin tool-calling endpoint. Its main area is the desktop
// MCP tool page. The account, the 3-state connection indicator and settings are
// surfaced through header controls and modals. AI assignment is controlled
// server-side from the web Workshop ("作坊") panel — the device no longer picks
// an AI.

interface ToolDef {
  name: string
  description: string
  input_schema: { type: string; properties: Record<string, any>; required?: string[] }
}

interface Window {
  heysureAPI: {
    getSettings: () => Promise<any>
    saveSettings: (s: any) => Promise<any>
    connect: () => Promise<void>
    disconnect: () => Promise<void>
    getStatus: () => Promise<string>
    onStatusChange: (cb: (status: string, reason?: string, aiConfigId?: number | null) => void) => void
    onActivityLog: (cb: (entry: any) => void) => void
    onTaskStart: (cb: (data: any) => void) => void
    onTaskResult: (cb: (data: any) => void) => void
    onAuthExpired: (cb: (reason: string) => void) => void
    onAuthRefreshed: (cb: () => void) => void
    onReconnecting: (cb: (active: boolean, reason: string | null) => void) => void
    setTheme: (theme: 'dark' | 'light') => Promise<void>
    minimizeWindow: () => Promise<boolean>
    toggleMaximizeWindow: () => Promise<boolean>
    closeWindow: () => Promise<boolean>
    isWindowMaximized: () => Promise<boolean>
    testConnection: () => Promise<{ success: boolean; status?: number; ms?: number; error?: string }>
    login: (params: { serverUrl: string; account: string; password: string }) => Promise<{ success: boolean; user: any }>
    logout: () => Promise<{ success: boolean }>
    mcpList: () => Promise<{ tools: ToolDef[]; overrides: Record<string, { description?: string; parameters?: Record<string, string> }> }>
    mcpSaveDesc: (p: { tool: string; description?: string; parameters?: Record<string, string> }) => Promise<boolean>
    mcpTest: (p: { tool: string; args: Record<string, any> }) => Promise<{ success: boolean; result?: any; summary?: string; error?: string }>
    version: string
  }
}

const $ = (id: string) => document.getElementById(id)!
const windowMinBtn = $('window-min-btn') as HTMLButtonElement
const windowMaxBtn = $('window-max-btn') as HTMLButtonElement
const windowCloseBtn = $('window-close-btn') as HTMLButtonElement

// ── State ──────────────────────────────────────────────────────────────────
let currentTheme: 'dark' | 'light' = 'dark'
let currentStatus = 'disconnected'
// True while the agent is auto-reconnecting (socket.io retry or silent
// re-login after a server update) — drives the orange "reconnecting" prompt.
let reconnecting = false
let reconnectingReason = ''
let boundAiConfigId: number | null = null
let totalCalls = 0, successCalls = 0, failedCalls = 0, runningCalls = 0
let toolDefs: ToolDef[] = []
let overrides: Record<string, { description?: string; parameters?: Record<string, string> }> = {}

function esc(str: string) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Theme (also recolors the Electron window via setTheme IPC) ───────────────
function applyTheme(theme: 'dark' | 'light', persist = true) {
  currentTheme = theme
  document.documentElement.className = theme
  document.body.className = theme
  $('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙'
  if (persist) window.heysureAPI.setTheme(theme)
}
$('theme-toggle').addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'))

function syncWindowMaxButton(isMaximized: boolean) {
  windowMaxBtn.classList.toggle('restore', isMaximized)
  windowMaxBtn.classList.toggle('max', !isMaximized)
  windowMaxBtn.title = isMaximized ? '还原' : '最大化'
  windowMaxBtn.setAttribute('aria-label', isMaximized ? '还原' : '最大化')
}
windowMinBtn.addEventListener('click', () => window.heysureAPI.minimizeWindow())
windowMaxBtn.addEventListener('click', async () => {
  syncWindowMaxButton(await window.heysureAPI.toggleMaximizeWindow())
})
windowCloseBtn.addEventListener('click', () => window.heysureAPI.closeWindow())

// ── Status indicator (green / yellow / red) ─────────────────────────────────
const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接', connecting: '连接中...', connected: '已连接', registered: '已连接到服务器', error: '连接错误',
}
function renderStatus() {
  const statusPill = $('status-pill')
  statusPill.classList.toggle('reconnecting', reconnecting)
  if (reconnecting) {
    $('status-dot').className = 'status-dot orange'
    $('status-label').textContent = '重连中…'
    statusPill.title = reconnectingReason || '正在自动重连服务器'
    $('info-status').textContent = reconnectingReason || '正在自动重连…'
    $('info-ai').textContent = boundAiConfigId == null ? '未分配' : `#${boundAiConfigId}`
    return
  }
  const connected = currentStatus === 'registered' || currentStatus === 'connected'
  let color: 'green' | 'yellow' | 'red', label: string
  if (!connected) { color = 'red'; label = '未连接' }
  else if (boundAiConfigId == null) { color = 'yellow'; label = '未分配 AI' }
  else { color = 'green'; label = '已连接' }
  $('status-dot').className = `status-dot ${color}`
  $('status-label').textContent = label
  $('info-status').textContent = STATUS_LABELS[currentStatus] || currentStatus
  $('info-ai').textContent = boundAiConfigId == null ? '未分配' : `#${boundAiConfigId}`
}
function setStatus(status: string, _reason?: string, aiConfigId?: number | null) {
  currentStatus = status
  // Back online — the reconnect is over (also signalled by onReconnecting, but
  // clear here too so the orange prompt never lingers).
  if (status === 'registered' || status === 'connected') reconnecting = false
  if (status !== 'registered' && status !== 'connected') boundAiConfigId = null
  else if (typeof aiConfigId !== 'undefined') boundAiConfigId = aiConfigId
  renderStatus()
}
function setReconnecting(active: boolean, reason?: string | null) {
  reconnecting = active
  reconnectingReason = active ? (reason || '正在自动重连服务器') : ''
  renderStatus()
}

// ── Tool-call stats ──────────────────────────────────────────────────────
function updateStats() {
  $('stat-total').textContent = String(totalCalls)
  $('stat-success').textContent = String(successCalls)
  $('stat-failed').textContent = String(failedCalls)
  $('stat-running').textContent = String(runningCalls)
}

// ── MCP tool page ──────────────────────────────────────────────────────────
function nsOf(name: string): string {
  if (name.includes('.')) return name.split('.')[0]
  const i = name.indexOf('_'); return i > 0 ? name.slice(0, i) : 'other'
}
function isEdited(name: string): boolean {
  const o = overrides[name]
  return !!(o && (o.description || (o.parameters && Object.keys(o.parameters).length)))
}
function effDesc(t: ToolDef): string { return overrides[t.name]?.description?.trim() || t.description || '' }
function effParam(tool: string, p: string, raw: string): string { return overrides[tool]?.parameters?.[p]?.trim() || raw || '' }

function showList() {
  $('mcp-detail-pane').classList.add('hidden')
  $('mcp-list-pane').classList.remove('hidden')
}

async function loadMcp() {
  const data = await window.heysureAPI.mcpList()
  toolDefs = data.tools || []
  overrides = data.overrides || {}
  renderMcpList()
}

function renderMcpList() {
  $('mcp-count').textContent = `${toolDefs.length} 个`
  const list = $('mcp-list'); list.innerHTML = ''
  if (!toolDefs.length) { list.innerHTML = '<div class="empty-note">无可用工具</div>'; return }
  const groups = new Map<string, ToolDef[]>()
  for (const t of toolDefs) {
    const ns = nsOf(t.name)
    if (!groups.has(ns)) groups.set(ns, [])
    groups.get(ns)!.push(t)
  }
  for (const ns of Array.from(groups.keys()).sort()) {
    const title = document.createElement('div')
    title.className = 'ns-title'; title.textContent = `${ns}/ (${groups.get(ns)!.length})`
    list.appendChild(title)
    for (const t of groups.get(ns)!) {
      const el = document.createElement('div')
      el.className = 'tool-item'
      el.innerHTML = `
        <div class="tool-item-top">
          <span class="tool-name">${esc(t.name)}</span>
          ${isEdited(t.name) ? '<span class="tool-edited">已自定义</span>' : ''}
        </div>
        <div class="tool-desc">${esc((effDesc(t) || '（无描述）').slice(0, 120))}</div>`
      el.addEventListener('click', () => openTool(t.name))
      list.appendChild(el)
    }
  }
}

function paramEntries(t: ToolDef) {
  const props = t.input_schema?.properties || {}
  const required = new Set(t.input_schema?.required || [])
  return Object.keys(props).map(p => {
    const cfg = (props as any)[p] || {}
    const ty = Array.isArray(cfg.type) ? cfg.type.join('|') : (cfg.type || 'any')
    return { name: p, type: String(ty), required: required.has(p), desc: String(cfg.description || '') }
  })
}

function openTool(name: string) {
  const tool = toolDefs.find(t => t.name === name)
  if (!tool) return
  $('mcp-list-pane').classList.add('hidden')
  $('mcp-detail-pane').classList.remove('hidden')
  $('mcp-detail').scrollTop = 0
  renderDetail(tool)
}

function renderDetail(tool: ToolDef) {
  const params = paramEntries(tool)
  const paramHtml = params.length
    ? params.map(p => `
        <div class="param-row">
          <div class="param-head">
            <span class="param-name">${esc(p.name)}</span>
            <span class="param-type">${esc(p.type)}</span>
            ${p.required ? '<span class="param-req">必填</span>' : ''}
          </div>
          <div class="tool-desc">${esc(effParam(tool.name, p.name, p.desc) || '（无说明）')}</div>
          <input type="text" data-param="${esc(p.name)}" class="edit-param" placeholder="自定义参数说明（留空用默认）" value="${esc(overrides[tool.name]?.parameters?.[p.name] || '')}" style="margin-top:5px;"/>
        </div>`).join('')
    : '<div class="empty-note">该工具无参数</div>'
  const argTemplate = JSON.stringify(Object.fromEntries(params.filter(p => p.required).map(p => [p.name, ''])), null, 2)

  $('mcp-detail').innerHTML = `
    <div class="card">
      <div class="card-title">${esc(tool.name)}</div>
      <div class="tool-desc" style="font-size:12px;">${esc(effDesc(tool) || '（无描述）')}</div>
    </div>
    <div class="card">
      <div class="card-title">参数说明</div>
      ${paramHtml}
    </div>
    <div class="card">
      <div class="card-title">编辑描述（本地保存，随上报同步给服务器）</div>
      <div class="fg"><label>工具描述（用途 + 使用场景）</label>
        <textarea class="ta" id="edit-desc" placeholder="留空使用默认描述">${esc(overrides[tool.name]?.description || '')}</textarea>
      </div>
      <button class="btn btn-primary" id="edit-save">保存描述</button>
      <button class="btn btn-secondary" id="edit-reset">恢复默认</button>
      <div class="save-feedback" id="edit-feedback"></div>
    </div>
    <div class="card">
      <div class="card-title">测试调用 (mcp.test)</div>
      <div class="login-hint">在本机直接执行该工具并返回原始结果。</div>
      <div class="fg"><label>参数 (JSON)</label>
        <textarea class="ta" id="test-args" style="min-height:72px;font-family:'Cascadia Code',Consolas,monospace;">${esc(argTemplate)}</textarea>
      </div>
      <button class="btn btn-primary" id="test-run">测试</button>
      <div class="test-result" id="test-result" style="display:none;"></div>
    </div>`

  $('edit-save').addEventListener('click', async () => {
    const description = ($('edit-desc') as HTMLTextAreaElement).value
    const parameters: Record<string, string> = {}
    $('mcp-detail').querySelectorAll<HTMLInputElement>('.edit-param').forEach(inp => { parameters[inp.dataset.param!] = inp.value })
    await window.heysureAPI.mcpSaveDesc({ tool: tool.name, description, parameters })
    await loadMcp()
    const fb = $('edit-feedback'); fb.textContent = '已保存 ✓ 已同步给服务器'; fb.style.color = 'var(--success)'
  })
  $('edit-reset').addEventListener('click', async () => {
    await window.heysureAPI.mcpSaveDesc({ tool: tool.name, description: '', parameters: {} })
    await loadMcp()
    const t = toolDefs.find(x => x.name === tool.name); if (t) renderDetail(t)
  })
  $('test-run').addEventListener('click', async () => {
    const out = $('test-result')
    let args: Record<string, any> = {}
    const raw = ($('test-args') as HTMLTextAreaElement).value.trim()
    if (raw) {
      try { args = JSON.parse(raw) } catch (e: any) {
        out.style.display = 'block'; out.className = 'test-result fail'; out.textContent = `参数 JSON 解析失败：${e?.message || e}`; return
      }
    }
    out.style.display = 'block'; out.className = 'test-result'; out.textContent = '执行中…'
    try {
      const r = await window.heysureAPI.mcpTest({ tool: tool.name, args })
      if (r.success) { out.className = 'test-result ok'; out.textContent = '成功\n' + safeStringify(r.result) }
      else { out.className = 'test-result fail'; out.textContent = '失败：' + (r.error || r.summary || '未知错误') }
    } catch (err: any) {
      out.className = 'test-result fail'; out.textContent = '失败：' + (err?.message || err)
    }
  })
}
function safeStringify(v: any): string { try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) } catch { return String(v) } }

$('mcp-back').addEventListener('click', showList)

// ── Settings modal ───────────────────────────────────────────────────────
const cfgServer    = $('cfg-server') as HTMLInputElement
const cfgWorkspace = $('cfg-workspace') as HTMLInputElement
const cfgAiKey     = $('cfg-ai-key') as HTMLInputElement
const cfgAiBase    = $('cfg-ai-base') as HTMLInputElement
const cfgAiModel   = $('cfg-ai-model') as HTMLInputElement
const cfgOffline   = $('cfg-offline-mode') as HTMLInputElement
const cfgMouseFx   = $('cfg-mouse-fx') as HTMLInputElement
const cfgProvider  = $('cfg-ai-provider') as HTMLSelectElement

const PROVIDER_PRESETS: Record<string, { base: string; model: string }> = {
  anthropic:  { base: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  openai:     { base: 'https://api.openai.com',    model: 'gpt-4o' },
  deepseek:   { base: 'https://api.deepseek.com',  model: 'deepseek-chat' },
  openrouter: { base: 'https://openrouter.ai/api', model: 'anthropic/claude-3.5-sonnet' },
  ollama:     { base: 'http://localhost:11434',    model: 'llama3.1' },
}
cfgProvider.addEventListener('change', () => {
  const p = PROVIDER_PRESETS[cfgProvider.value]
  if (p) { cfgAiBase.value = p.base; cfgAiModel.value = p.model }
  cfgProvider.value = ''
})
function updateOfflineUi() { $('offline-model-config').classList.toggle('hidden', !cfgOffline.checked) }
cfgOffline.addEventListener('change', updateOfflineUi)

function openSettings()  { $('settings-modal').classList.remove('hidden') }
function closeSettings() { $('settings-modal').classList.add('hidden') }
$('settings-btn').addEventListener('click', openSettings)
$('settings-close').addEventListener('click', closeSettings)
$('settings-modal').addEventListener('click', e => { if (e.target === $('settings-modal')) closeSettings() })

$('save-btn').addEventListener('click', async () => {
  const fb = $('save-feedback')
  try {
    await window.heysureAPI.saveSettings({
      serverUrl: cfgServer.value.trim(),
      workspaceRoot: cfgWorkspace.value.trim(),
      offlineMode: cfgOffline.checked,
      mouseFx: cfgMouseFx.checked,
      aiKey: cfgAiKey.value.trim(),
      aiBaseUrl: cfgAiBase.value.trim() || 'https://api.anthropic.com',
      aiModel: cfgAiModel.value.trim() || 'claude-sonnet-4-5',
    })
    $('info-server').textContent = cfgServer.value.trim() || '—'
    $('info-workspace').textContent = cfgWorkspace.value.trim() ? (cfgWorkspace.value.trim().split(/[/\\]/).pop() || cfgWorkspace.value.trim()) : '—'
    fb.style.color = 'var(--success)'; fb.textContent = '已保存 ✓'
    setTimeout(() => { fb.textContent = '' }, 2000)
  } catch {
    fb.style.color = 'var(--error)'; fb.textContent = '保存失败'
    setTimeout(() => { fb.textContent = '' }, 3000)
  }
})

// ── Members modal (connection + AI assignment info) ─────────────────────────
function openMembers()  { $('members-modal').classList.remove('hidden'); renderStatus() }
function closeMembers() { $('members-modal').classList.add('hidden') }
$('status-pill').addEventListener('click', openMembers)
$('members-modal-close').addEventListener('click', closeMembers)
$('members-modal').addEventListener('click', e => { if (e.target === $('members-modal')) closeMembers() })
$('connect-btn').addEventListener('click', () => window.heysureAPI.connect())
$('disconnect-btn').addEventListener('click', () => window.heysureAPI.disconnect())

// ── Status / task events ──────────────────────────────────────────────────
window.heysureAPI.onStatusChange(setStatus)
window.heysureAPI.onActivityLog(() => { /* feed removed; stats tracked via task events */ })
window.heysureAPI.onTaskStart(() => { totalCalls++; runningCalls++; updateStats() })
window.heysureAPI.onTaskResult((data) => {
  runningCalls = Math.max(0, runningCalls - 1)
  data.success ? successCalls++ : failedCalls++
  updateStats()
})

// ── Login ──────────────────────────────────────────────────────────────────
const loginAccount  = $('login-account') as HTMLInputElement
const loginPassword = $('login-password') as HTMLInputElement
const loginBtn      = $('login-btn') as HTMLButtonElement
const loginError    = $('login-error')
const loginModal    = $('login-modal')

function showLoginError(msg: string) { loginError.textContent = msg; loginError.classList.add('visible') }
function clearLoginError() { loginError.classList.remove('visible') }
function openLoginModal() {
  loginModal.classList.remove('hidden'); clearLoginError()
  window.heysureAPI.getSettings().then(s => { loginAccount.value = s.userAccount || ''; updateUserChip(s) }).catch(() => {})
}
function closeLoginModal() { loginModal.classList.add('hidden') }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLoginModal(); closeSettings(); closeMembers() } })

window.heysureAPI.onAuthExpired(async reason => {
  setReconnecting(false)
  const s = await window.heysureAPI.getSettings()
  updateUserChip(s); openLoginModal(); showLoginError(reason || '登录已过期，请重新登录')
})

// A silent re-login (using the saved credentials) succeeded — refresh the
// account chip and dismiss the login prompt if it was open. The orange prompt
// stays up until the socket re-registers (cleared in setStatus/onReconnecting).
window.heysureAPI.onAuthRefreshed(async () => {
  const s = await window.heysureAPI.getSettings()
  updateUserChip(s); closeLoginModal()
})

// Orange "reconnecting" prompt, driven by the main process so it reflects the
// real retry state (and never lingers for an intentional disconnect/logout).
window.heysureAPI.onReconnecting((active, reason) => setReconnecting(active, reason))

async function doLogin() {
  clearLoginError()
  const saved = await window.heysureAPI.getSettings()
  const serverUrl = (cfgServer.value.trim() || saved.serverUrl || '').trim()
  const account = loginAccount.value.trim()
  const password = loginPassword.value
  if (!serverUrl) { showLoginError('请先在设置中配置服务器地址'); return }
  if (!account) { showLoginError('请输入账号'); return }
  if (!password) { showLoginError('请输入密码'); return }
  loginBtn.disabled = true
  try {
    await window.heysureAPI.login({ serverUrl, account, password })
    const s = await window.heysureAPI.getSettings()
    loginPassword.value = ''
    updateUserChip(s); closeLoginModal(); await loadMainSettings()
    window.heysureAPI.connect()
  } catch (err: any) {
    showLoginError(err.message || '登录失败')
  } finally {
    loginBtn.disabled = false
  }
}
loginBtn.addEventListener('click', doLogin)
;[loginAccount, loginPassword].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin() }))
$('login-modal-close').addEventListener('click', closeLoginModal)
loginModal.addEventListener('click', e => { if (e.target === loginModal) closeLoginModal() })

// ── Account / user chip ──────────────────────────────────────────────────
function resolveAvatarUrl(avatar: string, server: string): string {
  const raw = (avatar || '').trim(); if (!raw) return ''
  const base = (server || '').replace(/\/+$/, '')
  const preset = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i)
  if (preset) return base ? `${base}/avatars/avatars${preset[1]}.png` : ''
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw
  if (!base) return raw
  return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`
}
function bindAvatar(imgEl: HTMLImageElement, container: HTMLElement, src: string, fallback: string, textEl: HTMLElement) {
  textEl.textContent = fallback; container.classList.remove('has-image')
  imgEl.onload = null; imgEl.onerror = null
  if (!src) { imgEl.removeAttribute('src'); return }
  imgEl.onload = () => container.classList.add('has-image')
  imgEl.onerror = () => container.classList.remove('has-image')
  imgEl.src = src
}
function updateUserChip(s: any) {
  const authenticated = !!s.authToken
  const shown = String(s.userName || '').trim()
  const initial = shown ? shown.slice(0, 1).toUpperCase() : '·'
  const avatar = authenticated && shown ? (s.userAvatarDataUrl || resolveAvatarUrl(s.userAvatar || '', s.serverUrl || '')) : ''
  $('header-user-name').textContent = authenticated && shown ? shown : '未登录'
  bindAvatar($('header-user-ava-img') as HTMLImageElement, $('header-user-ava'), avatar, initial, $('header-user-ava-text'))
  if (authenticated && shown) {
    const host = (() => { try { return new URL(s.serverUrl).hostname } catch { return s.serverUrl || '—' } })()
    bindAvatar($('account-info-ava-img') as HTMLImageElement, $('account-info-ava'), avatar, initial, $('account-info-ava-text'))
    $('account-info-name').textContent = shown
    $('account-info-server').textContent = host
    $('account-info').style.display = 'flex'
    $('login-form').style.display = 'none'
  } else {
    $('account-info').style.display = 'none'
    $('login-form').style.display = 'flex'
  }
}
async function doLogout() {
  await window.heysureAPI.logout()
  const s = await window.heysureAPI.getSettings()
  cfgServer.value = s.serverUrl || ''; loginAccount.value = ''; loginPassword.value = ''
  setReconnecting(false)
  updateUserChip(s); clearLoginError(); closeLoginModal(); setStatus('disconnected')
}
$('header-user-chip').addEventListener('click', openLoginModal)
$('logout-btn').addEventListener('click', doLogout)

// ── Settings load ──────────────────────────────────────────────────────────
async function loadMainSettings() {
  const s = await window.heysureAPI.getSettings()
  cfgServer.value = s.serverUrl || ''
  cfgWorkspace.value = s.workspaceRoot || ''
  cfgAiKey.value = s.aiKey || ''
  cfgAiBase.value = s.aiBaseUrl || ''
  cfgAiModel.value = s.aiModel || ''
  cfgOffline.checked = !!s.offlineMode
  cfgMouseFx.checked = s.mouseFx !== false
  updateOfflineUi()
  $('info-server').textContent = s.serverUrl || '—'
  $('info-workspace').textContent = s.workspaceRoot ? (s.workspaceRoot.split(/[/\\]/).pop() || s.workspaceRoot) : '—'
  updateUserChip(s)
  return s
}

// ── Init ─────────────────────────────────────────────────────────────────
async function init() {
  const s = await window.heysureAPI.getSettings()
  applyTheme(s.theme || 'dark', false)
  syncWindowMaxButton(await window.heysureAPI.isWindowMaximized())
  loginAccount.value = s.userAccount || ''
  await loadMainSettings()
  updateStats()
  await loadMcp()
  const status = await window.heysureAPI.getStatus()
  setStatus(status)
  if (s.authToken) window.heysureAPI.connect()
  else openLoginModal()
}
init().catch(console.error)
