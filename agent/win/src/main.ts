import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, net } from 'electron'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { store, AgentSettings } from './store'
import { SCREENSHOT_TIMEOUT_MS } from './constants'
import { HeySureAgent, AgentStatus } from './agent'
import { registerCaptureFn } from './capture-bridge'
import { normalizeServerUrl } from './server-url'

app.setName('HeySure Agent')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.heysure.agent.win')
}

let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
let tray: Tray | null = null
let agent: HeySureAgent | null = null

const APP_ICON_PATH = path.join(__dirname, '../assets/icon.ico')
const TRAY_ICON_PATHS: Record<AgentStatus, string> = {
  disconnected: path.join(__dirname, '../assets/desktop.png'),
  connecting: path.join(__dirname, '../assets/desktop_yellow.png'),
  connected: path.join(__dirname, '../assets/desktop_green.png'),
  registered: path.join(__dirname, '../assets/desktop_green.png'),
  error: path.join(__dirname, '../assets/desktop_red.png'),
}

// ── Tray icons ───────────────────────────────────────────────────────────────
function loadTrayIcon(status: AgentStatus): Electron.NativeImage {
  const iconPath = TRAY_ICON_PATHS[status] || TRAY_ICON_PATHS.disconnected
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    return nativeImage.createFromPath(APP_ICON_PATH)
  }
  return image.resize({ width: 16, height: 16 })
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  disconnected: '未连接',
  connecting:   '连接中...',
  connected:    '已连接',
  registered:   '已注册',
  error:        '连接错误',
}

// ── Capture window (hidden) for desktopCapturer ──────────────────────────────
async function setupCaptureWindow(): Promise<void> {
  captureWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  const captureHtml = `<!DOCTYPE html>
<html><body><script>
const { ipcRenderer, desktopCapturer, screen } = require('electron')

ipcRenderer.on('do-capture', async (event, opts) => {
  try {
    const d = screen.getPrimaryDisplay()
    const w = opts.width || d.size.width
    const h = opts.height || d.size.height
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: w, height: h }
    })
    const idx = Math.min(opts.displayIndex || 0, sources.length - 1)
    let img = sources[idx].thumbnail
    if (opts.cropRegion) {
      img = img.crop(opts.cropRegion)
    }
    const buf = img.toPNG()
    ipcRenderer.send('capture-done', Array.from(buf))
  } catch (e) {
    ipcRenderer.send('capture-error', e.message)
  }
})
</script></body></html>`

  const tmpHtml = path.join(app.getPath('temp'), 'hs-capture.html')
  fs.writeFileSync(tmpHtml, captureHtml, 'utf8')
  await captureWindow.loadFile(tmpHtml)

  // Queue of pending capture promises
  const pending: Array<{ resolve: (buf: Buffer) => void; reject: (err: Error) => void }> = []

  captureWindow.webContents.on('ipc-message', (_event, channel, ...args) => {
    if (channel === 'capture-done' && pending.length > 0) {
      const { resolve } = pending.shift()!
      resolve(Buffer.from(args[0]))
    } else if (channel === 'capture-error' && pending.length > 0) {
      const { reject } = pending.shift()!
      reject(new Error(args[0]))
    }
  })

  // Register the capture function in the bridge so screen.ts can call it
  registerCaptureFn((opts) => new Promise((resolve, reject) => {
    pending.push({ resolve, reject })
    captureWindow?.webContents.send('do-capture', opts)
    setTimeout(() => {
      const idx = pending.findIndex(p => p.reject === reject)
      if (idx !== -1) {
        pending.splice(idx, 1)
        reject(new Error(`Screenshot timed out after ${SCREENSHOT_TIMEOUT_MS / 1000}s`))
      }
    }, SCREENSHOT_TIMEOUT_MS)
  }))
}

// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow(): void {
  const bounds = store.get('windowBounds') || { width: 900, height: 660 }
  mainWindow = new BrowserWindow({
    width: (bounds as any).width || 900,
    height: (bounds as any).height || 660,
    x: (bounds as any).x,
    y: (bounds as any).y,
    minWidth: 700,
    minHeight: 500,
    icon: APP_ICON_PATH,
    frame: true,
    autoHideMenuBar: true,
    title: 'HeySure Agent',
    backgroundColor: store.get('theme') === 'light' ? '#f0f0ff' : '#0e0e1a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))
  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)
}

function saveBounds() {
  if (!mainWindow) return
  store.set('windowBounds', mainWindow.getBounds())
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray(): void {
  tray = new Tray(loadTrayIcon('disconnected'))
  tray.setToolTip('HeySure Agent — 未连接')
  updateTrayMenu('disconnected')
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })
}

function updateTrayMenu(status: AgentStatus): void {
  if (!tray) return
  tray.setImage(loadTrayIcon(status))
  tray.setToolTip(`HeySure Agent — ${STATUS_LABELS[status]}`)

  const isActive = status === 'registered' || status === 'connected'
  const menu = Menu.buildFromTemplate([
    { label: `状态: ${STATUS_LABELS[status]}`, enabled: false },
    { type: 'separator' },
    {
      label: isActive ? '断开连接' : '连接服务器',
      click: () => {
        if (isActive) { agent?.disconnect() } else { agent?.connect() }
      },
    },
    {
      label: '打开面板',
      click: () => { mainWindow?.show(); mainWindow?.focus() },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => { (app as any).isQuitting = true; app.quit() },
    },
  ])
  tray.setContextMenu(menu)
}

// ── Agent ─────────────────────────────────────────────────────────────────────
function createAgent(settings: AgentSettings): HeySureAgent {
  return new HeySureAgent(settings, {
    onStatusChange: (status, reason) => {
      updateTrayMenu(status)
      mainWindow?.webContents.send('agent:status-changed', status, reason)
      sendActivityLog(
        'system',
        status === 'registered' ? 'success' : status === 'error' ? 'error' : 'info',
        `状态变更: ${STATUS_LABELS[status]}${reason ? ` (${reason})` : ''}`,
      )
    },
    onLog: (level, message, data) => {
      sendActivityLog(level, 'info', message, data)
    },
    onTaskStart: (taskId, tool, args) => {
      mainWindow?.webContents.send('task:start', { taskId, tool, args, timestamp: Date.now() })
      sendActivityLog('task', 'running', `[工具] ${tool}`, args)
    },
    onTaskResult: (taskId, tool, result, success) => {
      mainWindow?.webContents.send('task:result', { taskId, tool, result, success, timestamp: Date.now() })
      sendActivityLog(
        'task',
        success ? 'success' : 'error',
        `${success ? '✓' : '✗'} ${tool}`,
        success ? (result?.summary || result) : result,
      )
    },
  })
}

function sendActivityLog(type: string, status: string, message: string, data?: any) {
  mainWindow?.webContents.send('activity:log', {
    id: Math.random().toString(36).slice(2),
    type,
    status,
    message,
    data,
    timestamp: Date.now(),
  })
}

function clearSelectedAiConfig(): void {
  store.set('selectedAiConfigId', null)
  store.set('selectedAiConfigName', '')
  store.set('selectedAiConfigRole', 'member')
  store.set('selectedAiConfigLifecycle', 'working')
  store.set('selectedAiConfigProject', '')
  store.set('agentToken', '')
  store.set('agentId', '')
  store.set('agentName', 'Windows Agent')
  store.set('agentGroup', '')
}

function clearAiSelectionIfLoggedOut(): boolean {
  if (store.get('authToken')) return false
  if (!store.get('selectedAiConfigId')) return false
  clearSelectedAiConfig()
  return true
}

// ── IPC handlers ──────────────────────────────────────────────────────────────
function registerIpc(): void {
  ipcMain.handle('settings:get', () => {
    clearAiSelectionIfLoggedOut()
    return store.store
  })

  ipcMain.handle('settings:save', (_event, newSettings: Partial<AgentSettings>) => {
    Object.entries(newSettings).forEach(([k, v]) => store.set(k as any, v as any))
    if (clearAiSelectionIfLoggedOut()) {
      sendActivityLog('system', 'warn', '未登录，已取消 AI 成员自动注册选择')
    }
    agent?.updateSettings(store.store)
    return store.store
  })

  ipcMain.handle('agent:connect', () => {
    if (!store.get('authToken')) {
      if (clearAiSelectionIfLoggedOut()) {
        agent?.updateSettings(store.store)
      }
      sendActivityLog('system', 'warn', '请先登录并选择 AI 成员后再连接软件端 Agent')
      return false
    }
    agent?.connect()
    return true
  })

  ipcMain.handle('agent:disconnect', () => {
    agent?.disconnect()
    return true
  })

  ipcMain.handle('agent:status', () => agent?.status || 'disconnected')

  ipcMain.handle('theme:set', (_event, theme: 'dark' | 'light') => {
    store.set('theme', theme)
    mainWindow?.setBackgroundColor(theme === 'light' ? '#f0f0ff' : '#0e0e1a')
    return true
  })

  ipcMain.handle('connection:test', async () => {
    const raw = String(store.get('serverUrl') || '').trim()
    if (!raw) return { success: false, error: '未配置服务器 URL' }
    let base: string
    try { base = normalizeServerUrl(raw) } catch { return { success: false, error: '服务器 URL 格式无效' } }
    try {
      const start = Date.now()
      const res = await net.fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
        .catch(() => net.fetch(base, { signal: AbortSignal.timeout(5000) }))
      const ms = Date.now() - start
      return { success: true, status: res.status, ms }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('chat:history', async () => {
    const s = store.store
    return getServerChatHistory(s)
  })

  ipcMain.handle('chat:send', async (_event, content: string) => {
    const s = store.store
    return callServerChat(s, String(content || ''))
  })

  ipcMain.handle('auth:login', async (_event, params: { serverUrl: string; account: string; password: string }) => {
    const { serverUrl, account, password } = params
    if (!serverUrl) throw new Error('服务器 URL 不能为空')
    let base: string
    try { base = normalizeServerUrl(serverUrl) } catch { throw new Error('服务器 URL 格式无效') }
    const res = await net.fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password }),
      signal: AbortSignal.timeout(10000),
    })
    const data: any = await res.json()
    if (!res.ok) throw new Error(data?.detail || `登录失败 (${res.status})`)
    store.set('serverUrl', base)
    store.set('authToken', data.access_token)
    store.set('userAccount', account)
    store.set('userId', data.user?.id ?? null)
    clearSelectedAiConfig()
    agent?.updateSettings(store.store)
    return { success: true, user: data.user }
  })

  ipcMain.handle('auth:logout', () => {
    agent?.disconnect()
    store.set('authToken', '')
    store.set('userAccount', '')
    store.set('userId', null)
    clearSelectedAiConfig()
    return { success: true }
  })

  ipcMain.handle('ai-config:list', async () => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) throw new Error('未登录')
    const base = normalizeServerUrl(s.serverUrl)
    const res = await net.fetch(`${base}/api/ai/configs`, {
      headers: { 'Authorization': `Bearer ${s.authToken}` },
      signal: AbortSignal.timeout(10000),
    })
    const data: any = await res.json()
    if (!res.ok) throw new Error(data?.detail || `获取 AI 列表失败 (${res.status})`)
    return data
  })

  ipcMain.handle('ai-config:runtime-status', async () => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) return []
    const base = normalizeServerUrl(s.serverUrl)
    try {
      const res = await net.fetch(`${base}/api/ai/runtime-status`, {
        headers: { 'Authorization': `Bearer ${s.authToken}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return []
      return await res.json()
    } catch { return [] }
  })

  ipcMain.handle('ai-config:select', async (_event, cfg: any) => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) {
      clearSelectedAiConfig()
      agent?.updateSettings(store.store)
      throw new Error('请先登录后再选择 AI 成员')
    }
    if (!cfg?.id) throw new Error('AI 成员无效')
    store.set('selectedAiConfigId', cfg.id)
    store.set('selectedAiConfigName', cfg.name)
    store.set('selectedAiConfigRole', cfg.digital_member_role || 'member')
    store.set('selectedAiConfigLifecycle', cfg.lifecycle_status || 'working')
    store.set('selectedAiConfigProject', cfg.project_name || '')
    store.set('agentToken', store.get('authToken'))
    store.set('agentId', `win-desktop-${cfg.id}`)
    store.set('agentName', 'Windows Agent')
    store.set('agentGroup', cfg.project_name || '')
    agent?.disconnect()
    agent = createAgent(store.store)
    agent.connect()
    return { success: true }
  })

  ipcMain.handle('ai-config:clone', async (_event, configId: number) => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) throw new Error('未登录')
    const base = normalizeServerUrl(s.serverUrl)
    const res = await net.fetch(`${base}/api/ai/configs/${configId}/clone`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${s.authToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    const data: any = await res.json()
    if (!res.ok) throw new Error(data?.detail || `克隆失败 (${res.status})`)
    return data
  })

  ipcMain.handle('task:list', async () => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) throw new Error('未登录')
    if (!s.selectedAiConfigId) throw new Error('未选择 AI 成员')
    const base = normalizeServerUrl(s.serverUrl)
    const headers = { 'Authorization': `Bearer ${s.authToken}` }
    const [taskRes, jobRes] = await Promise.all([
      net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-list`, {
        headers,
        signal: AbortSignal.timeout(10000),
      }),
      net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-jobs`, {
        headers,
        signal: AbortSignal.timeout(10000),
      }),
    ])
    const taskData: any = await taskRes.json()
    const jobData: any = await jobRes.json()
    if (!taskRes.ok) throw new Error(taskData?.detail || `任务列表加载失败 (${taskRes.status})`)
    if (!jobRes.ok) throw new Error(jobData?.detail || `任务执行记录加载失败 (${jobRes.status})`)
    return {
      tasks: Array.isArray(taskData?.tasks) ? taskData.tasks : [],
      jobs: Array.isArray(jobData?.jobs) ? jobData.jobs : [],
    }
  })

  ipcMain.handle('task:generations', async (_event, jobId: string) => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) throw new Error('未登录')
    if (!s.selectedAiConfigId) throw new Error('未选择 AI 成员')
    if (!jobId) throw new Error('任务 ID 不能为空')
    const base = normalizeServerUrl(s.serverUrl)
    const res = await net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-jobs/${encodeURIComponent(jobId)}/generations`, {
      headers: { 'Authorization': `Bearer ${s.authToken}` },
      signal: AbortSignal.timeout(10000),
    })
    const data: any = await res.json()
    if (!res.ok) throw new Error(data?.detail || `任务详情加载失败 (${res.status})`)
    return Array.isArray(data?.generations) ? data.generations : []
  })

  ipcMain.handle('task:trigger', async (_event, payload: any) => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) throw new Error('未登录')
    if (!s.selectedAiConfigId) throw new Error('未选择 AI 成员')
    const base = normalizeServerUrl(s.serverUrl)
    const res = await net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-trigger`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${s.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(10000),
    })
    const data: any = await res.json()
    if (!res.ok) throw new Error(data?.detail || `创建任务失败 (${res.status})`)
    return data
  })

  ipcMain.handle('task:pause', async (_event, jobId: string) => callTaskJobAction(jobId, 'pause', '暂停任务失败'))
  ipcMain.handle('task:resume', async (_event, jobId: string) => callTaskJobAction(jobId, 'resume', '恢复任务失败'))

  ipcMain.handle('task:delete', async (_event, jobId: string) => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) throw new Error('未登录')
    if (!s.selectedAiConfigId) throw new Error('未选择 AI 成员')
    if (!jobId) throw new Error('任务 ID 不能为空')
    const base = normalizeServerUrl(s.serverUrl)
    const res = await net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${s.authToken}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}))
      throw new Error(data?.detail || `删除任务失败 (${res.status})`)
    }
    return { success: true }
  })

  ipcMain.handle('workspace:files', async () => {
    const s = store.store
    if (!s.serverUrl || !s.authToken) throw new Error('未登录')
    const base = normalizeServerUrl(s.serverUrl)
    const res = await net.fetch(`${base}/api/chat/files`, {
      headers: { 'Authorization': `Bearer ${s.authToken}` },
      signal: AbortSignal.timeout(10000),
    })
    const data: any = await res.json()
    if (!res.ok) throw new Error(data?.detail || `工作区目录加载失败 (${res.status})`)
    return Array.isArray(data) ? data : []
  })
}

async function callTaskJobAction(jobId: string, action: 'pause' | 'resume', fallback: string) {
  const s = store.store
  if (!s.serverUrl || !s.authToken) throw new Error('未登录')
  if (!s.selectedAiConfigId) throw new Error('未选择 AI 成员')
  if (!jobId) throw new Error('任务 ID 不能为空')
  const base = normalizeServerUrl(s.serverUrl)
  const res = await net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-jobs/${encodeURIComponent(jobId)}/${action}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${s.authToken}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}))
    throw new Error(data?.detail || `${fallback} (${res.status})`)
  }
  return { success: true }
}

// ── Server-backed AI chat helper ──────────────────────────────────────────────
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function requireChatSettings(settings: AgentSettings): { base: string; token: string; aiConfigId: number } {
  if (!settings.serverUrl || !settings.authToken) throw new Error('请先登录服务器')
  if (!settings.selectedAiConfigId) throw new Error('请先选择 AI 成员')
  return {
    base: normalizeServerUrl(settings.serverUrl),
    token: settings.authToken,
    aiConfigId: Number(settings.selectedAiConfigId),
  }
}

async function readJsonResponse(res: Response, fallback: string): Promise<any> {
  const text = await res.text()
  let data: any = {}
  if (text) {
    try { data = JSON.parse(text) } catch { data = { detail: text } }
  }
  if (!res.ok) throw new Error(data?.detail || data?.error || `${fallback} (${res.status})`)
  return data
}

async function ensureDesktopChatSession(settings: AgentSettings): Promise<{ id: string; name: string }> {
  const { base, token, aiConfigId } = requireChatSettings(settings)
  const query = new URLSearchParams({ ai_kind: 'assistant', ai_config_id: String(aiConfigId) }).toString()
  const listRes = await net.fetch(`${base}/api/chat/sessions?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  })
  const sessions = await readJsonResponse(listRes, '会话列表加载失败')
  if (Array.isArray(sessions) && sessions.length > 0) {
    const preferred = sessions.find((s: any) => /^软件端对话|^Windows Agent/.test(String(s?.name || ''))) || sessions[0]
    return { id: String(preferred.id), name: String(preferred.name || '软件端对话') }
  }

  const createRes = await net.fetch(`${base}/api/chat/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: '软件端对话',
      ai_config_id: aiConfigId,
      ai_kind: 'assistant',
    }),
    signal: AbortSignal.timeout(10000),
  })
  const created = await readJsonResponse(createRes, '会话创建失败')
  return { id: String(created?.id || ''), name: String(created?.name || '软件端对话') }
}

async function getServerChatHistory(settings: AgentSettings): Promise<any[]> {
  const { base, token, aiConfigId } = requireChatSettings(settings)
  const session = await ensureDesktopChatSession(settings)
  const query = new URLSearchParams({
    ai_kind: 'assistant',
    ai_config_id: String(aiConfigId),
    session_id: session.id,
  }).toString()
  const res = await net.fetch(`${base}/api/chat/history?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  })
  const rows = await readJsonResponse(res, '会话历史加载失败')
  return Array.isArray(rows) ? rows : []
}

async function callServerChat(
  settings: AgentSettings,
  content: string,
): Promise<{ text: string; sessionId: string }> {
  const text = String(content || '').trim()
  if (!text) throw new Error('消息内容不能为空')
  const { base, token, aiConfigId } = requireChatSettings(settings)
  const session = await ensureDesktopChatSession(settings)
  const startRes = await net.fetch(`${base}/api/chat/run/start`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      visible_content: text,
      model_content: text,
      session_id: session.id,
      session_name: session.name,
      ai_config_id: aiConfigId,
      ai_kind: 'assistant',
    }),
    signal: AbortSignal.timeout(15000),
  })
  const started = await readJsonResponse(startRes, '发起对话失败')
  const runId = String(started?.run_id || '')
  if (!runId) throw new Error('服务器未返回运行 ID')

  let lastText = ''
  const MAX_POLLS = 600
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(800)
    const statusRes = await net.fetch(`${base}/api/chat/run/status/${encodeURIComponent(runId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    })
    const st = await readJsonResponse(statusRes, '运行状态查询失败')
    lastText = String(st?.live_text || lastText || '')
    const status = String(st?.status || '')
    if (status === 'completed') return { text: lastText || '完成', sessionId: session.id }
    if (status === 'stopped') return { text: lastText || '（已停止）', sessionId: session.id }
    if (status === 'error') throw new Error(st?.error_message || 'AI 对话执行失败')
  }
  return { text: lastText || '（超时，未收到完整回复）', sessionId: session.id }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await setupCaptureWindow()

  clearAiSelectionIfLoggedOut()
  const settings = store.store
  agent = createAgent(settings)

  registerIpc()
  Menu.setApplicationMenu(null)
  createMainWindow()
  createTray()

  // Auto-connect only if a user has already logged in and selected an AI
  if (store.get('authToken') && store.get('selectedAiConfigId')) {
    agent.connect()
  }
})

// Keep running in tray even when all windows are closed
app.on('window-all-closed', (e: Event) => {
  e.preventDefault()
})

app.on('before-quit', () => {
  ;(app as any).isQuitting = true
  agent?.disconnect()
})

app.on('activate', () => {
  mainWindow?.show()
})
