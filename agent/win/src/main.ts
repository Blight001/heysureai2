import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, net } from 'electron'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { store, AgentSettings } from './store'
import { SCREENSHOT_TIMEOUT_MS } from './constants'
import { HeySureAgent, AgentStatus } from './agent'
import { registerCaptureFn } from './capture-bridge'

app.setName('HeySure Agent')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.heysure.agent.win')
}

let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
let tray: Tray | null = null
let agent: HeySureAgent | null = null

// ── Icon generation ─────────────────────────────────────────────────────────
function makeColorIcon(r: number, g: number, b: number, size = 16): Electron.NativeImage {
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const o = i * 4
    buf[o + 0] = b   // BGRA order
    buf[o + 1] = g
    buf[o + 2] = r
    buf[o + 3] = 255
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

const ICONS = {
  disconnected: makeColorIcon(120, 120, 120, 16),
  connecting:   makeColorIcon(251, 191,  36, 16),
  connected:    makeColorIcon( 99, 102, 241, 16),
  registered:   makeColorIcon( 34, 197,  94, 16),
  error:        makeColorIcon(239,  68,  68, 16),
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
    frame: true,
    title: 'HeySure Agent',
    backgroundColor: store.get('theme') === 'light' ? '#f0f0ff' : '#0e0e1a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'))

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
  tray = new Tray(ICONS.disconnected)
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
  tray.setImage(ICONS[status] || ICONS.disconnected)
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

// ── IPC handlers ──────────────────────────────────────────────────────────────
function registerIpc(): void {
  ipcMain.handle('settings:get', () => store.store)

  ipcMain.handle('settings:save', (_event, newSettings: Partial<AgentSettings>) => {
    Object.entries(newSettings).forEach(([k, v]) => store.set(k as any, v as any))
    agent?.updateSettings(store.store)
    return store.store
  })

  ipcMain.handle('agent:connect', () => {
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
    let url: URL
    try { url = new URL(raw) } catch { return { success: false, error: '服务器 URL 格式无效' } }
    const base = url.href.replace(/\/$/, '')
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

  ipcMain.handle('chat:send', async (_event, messages: any[]) => {
    const s = store.store
    if (!s.aiKey) throw new Error('未配置 AI Key')
    return callAiApi(s.aiBaseUrl || 'https://api.anthropic.com', s.aiKey, s.aiModel || 'claude-sonnet-4-5', messages)
  })
}

// ── AI API helper ─────────────────────────────────────────────────────────────
async function callAiApi(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const isAnthropic = baseUrl.includes('anthropic.com')
  const endpoint = isAnthropic
    ? `${baseUrl.replace(/\/$/, '')}/v1/messages`
    : `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isAnthropic) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const body = JSON.stringify({ model, max_tokens: 4096, messages })

  const res = await net.fetch(endpoint, { method: 'POST', headers, body })
  const data: any = await res.json()

  if (!res.ok) {
    throw new Error(data?.error?.message || `API error ${res.status}`)
  }

  if (isAnthropic) {
    return data.content?.[0]?.text || ''
  } else {
    return data.choices?.[0]?.message?.content || ''
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await setupCaptureWindow()

  const settings = store.store
  agent = createAgent(settings)

  registerIpc()
  createMainWindow()
  createTray()

  // Auto-connect on startup
  agent.connect()
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
