// background.ts — HeySure Agent service worker
// Manages: Socket.IO server connection, task dispatching, popup port communication
import { io, Socket } from 'socket.io-client'
import { getSettings, saveSettings, pushActivity, getActivity, getCard } from './lib/storage'
import { executeTask, executeBrowserTool, BROWSER_CAPABILITIES, BROWSER_TOOLS } from './lib/tools'
import { callAI } from './lib/ai'
import {
  AgentStatus, AgentSettings, DispatchedTask, ActivityEntry,
  PopupMsg, BgMsg, ChatMessage,
} from './lib/types'

// ── State ─────────────────────────────────────────────────────────────────
let socket:        Socket | null = null
let currentStatus: AgentStatus   = 'disconnected'
const taskOutcomes = new Map<string, any>()
const popupPorts   = new Set<chrome.runtime.Port>()
let _machineId:    string | null = null

// ── Activity logging ──────────────────────────────────────────────────────
function mkEntry(type: string, status: string, message: string, data?: any): ActivityEntry {
  return { id: Math.random().toString(36).slice(2), type, status, message, data, timestamp: Date.now() }
}

function log(type: string, status: string, message: string, data?: any) {
  const entry = mkEntry(type, status, message, data)
  void pushActivity(entry)
  broadcast({ type: 'activity:log', entry })
}

// ── Status management ─────────────────────────────────────────────────────
function setStatus(status: AgentStatus, reason?: string) {
  currentStatus = status
  broadcast({ type: 'agent:status', status, reason })
  const colors: Record<AgentStatus, string> = {
    disconnected: '#787878', connecting: '#f59e0b',
    connected: '#6366f1',    registered: '#22c55e',  error: '#ef4444',
  }
  chrome.action.setBadgeBackgroundColor({ color: colors[status] })
  chrome.action.setBadgeText({ text: status === 'registered' ? '●' : status === 'error' ? '!' : '' })
  chrome.action.setTitle({ title: `HeySure Agent — ${status}` })
}

// ── Popup broadcast ───────────────────────────────────────────────────────
function broadcast(msg: BgMsg) {
  popupPorts.forEach(port => {
    try { port.postMessage(msg) } catch { popupPorts.delete(port) }
  })
}

// ── Machine ID ────────────────────────────────────────────────────────────
async function getMachineId(): Promise<string> {
  if (_machineId) return _machineId
  const r = await chrome.storage.local.get('_mid')
  if (r._mid) { _machineId = r._mid; return _machineId! }
  const id = 'br-' + Math.random().toString(36).slice(2, 10)
  await chrome.storage.local.set({ _mid: id })
  _machineId = id
  return id
}

// ── Connect ───────────────────────────────────────────────────────────────
async function connect() {
  const settings = await getSettings()
  if (socket?.connected) return

  let url: URL
  try { url = new URL(settings.serverUrl) } catch {
    log('system', 'error', '服务器 URL 格式无效')
    return
  }

  setStatus('connecting')
  log('system', 'info', `连接到 ${url.href}...`)

  socket = io(url.href, {
    transports: ['websocket'],  // XHR polling unavailable in service workers
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity,
    autoConnect: true,
  })

  socket.on('connect', async () => {
    setStatus('connected')
    log('system', 'info', '已连接到服务器')
    await register(settings)
  })

  socket.on('disconnect', (reason: string) => {
    setStatus('disconnected', reason)
    log('system', 'warn', `连接断开: ${reason}`)
  })

  socket.on('connect_error', (err: Error) => {
    setStatus('error', err.message)
    log('system', 'error', `连接失败: ${err.message}`)
  })

  socket.on('agent:registered', (data: any) => {
    setStatus('registered')
    log('system', 'success', `已注册: ${data?.name || settings.agentName}`)
  })

  socket.on('agent:register_rejected', (data: any) => {
    setStatus('error', data?.reason)
    log('system', 'error', `注册被拒绝: ${data?.reason}`)
  })

  socket.on('task:dispatch', (task: DispatchedTask) => { void handleTask(task) })

  // Human-in-the-loop: surface to popup
  socket.on('human:ask', (data: any) => { broadcast({ type: 'activity:log', entry: mkEntry('human', 'warn', `AI提问: ${data.prompt}`, data) }) })
}

async function register(settings: AgentSettings) {
  const id = settings.agentId || await getMachineId()
  socket?.emit('agent:register', {
    id,
    name:            settings.agentName || 'Browser Agent',
    group:           settings.agentGroup || '',
    platform:        `browser-extension (${navigator?.userAgent?.split(' ').pop() || 'chrome'})`,
    os:              { platform: 'browser', arch: 'unknown', release: '1.0', hostname: id },
    capabilities:    BROWSER_CAPABILITIES,
    version:         '1.0.0',
    token:           settings.agentToken || '',
    workspaceRoot:   '',
    lifecycle:       'registered',
    isWindowsDesktop: false,
    isBrowserExtension: true,
  })
}

function disconnect() {
  socket?.disconnect()
  socket = null
  setStatus('disconnected')
}

// ── Task handling ─────────────────────────────────────────────────────────
async function handleTask(task: DispatchedTask) {
  const taskId = task.taskId
  if (!taskId) return

  const cached = taskOutcomes.get(taskId)
  if (cached) {
    if (cached.kind === 'result') socket?.emit('task:result', cached.payload)
    else if (cached.kind === 'error') socket?.emit('task:error', { taskId, error: cached.error })
    return
  }

  taskOutcomes.set(taskId, { kind: 'running' })
  const tool = task.tool || '(infer)'
  log('task', 'running', `[工具] ${tool}`, task.args)
  broadcast({ type: 'task:start', data: { taskId, tool, args: task.args, timestamp: Date.now() } })
  socket?.emit('task:progress', { taskId, progress: 0, message: `执行 ${tool}...` })

  try {
    const settings = await getSettings()
    const outcome  = await executeTask(task, settings)
    const payload  = {
      taskId,
      userId:      task.userId,
      aiConfigId:  task.aiConfigId,
      sessionId:   task.sessionId,
      tool:        outcome.tool,
      success:     outcome.success,
      result:      outcome.result,
      summary:     outcome.summary,
    }
    taskOutcomes.set(taskId, { kind: 'result', payload })
    socket?.emit('task:result', payload)
    log('task', outcome.success ? 'success' : 'error', `${outcome.success ? '完成' : '失败'}: ${outcome.tool}`, outcome.result)
    broadcast({ type: 'task:result', data: { taskId, tool: outcome.tool, result: outcome.result, success: outcome.success, timestamp: Date.now() } })
  } catch (err: any) {
    const errMsg = err?.message || String(err)
    taskOutcomes.set(taskId, { kind: 'error', error: errMsg })
    socket?.emit('task:error', { taskId, userId: task.userId, error: errMsg })
    log('task', 'error', `异常: ${tool} — ${errMsg}`)
    broadcast({ type: 'task:result', data: { taskId, tool, result: null, success: false, timestamp: Date.now() } })
  }
}

// ── Connection test ───────────────────────────────────────────────────────
async function testConnection(): Promise<any> {
  const settings = await getSettings()
  if (!settings.serverUrl) return { success: false, error: '未配置服务器 URL' }
  let url: URL
  try { url = new URL(settings.serverUrl) } catch { return { success: false, error: 'URL 格式无效' } }
  const base = url.href.replace(/\/$/, '')
  try {
    const start = Date.now()
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
      .catch(() => fetch(base, { signal: AbortSignal.timeout(5000) }))
    return { success: true, status: res.status, ms: Date.now() - start }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

// ── AI chat with agentic browser-tool loop ────────────────────────────────
const CHAT_SYSTEM = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You can navigate pages, click, double-click, right-click, type, drag, press keys, scroll, take
screenshots, search the web, extract data, and more.

Use browser_page_info to know where you are on the page (scroll position, current section,
visible headings); after scrolling, read the returned position so you know where you landed and
what changed. When asked to complete tasks, use the available tools systematically and summarize
what you did. Respond in the same language as the user. For factual questions, search the web if needed.`

async function runChat(messages: ChatMessage[]): Promise<{ text: string; toolsUsed: string[] }> {
  const settings = await getSettings()
  if (!settings.aiKey) throw new Error('未配置 AI Key')

  const toolsUsed: string[] = []
  let iter = 0
  const MAX = 12

  while (iter < MAX) {
    const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, BROWSER_TOOLS, CHAT_SYSTEM)

    if (!resp.toolUses?.length) {
      return { text: resp.text || '完成', toolsUsed }
    }

    messages.push({ role: 'assistant', content: resp.toolUses as any[] })

    const toolResults: any[] = []
    for (const tu of resp.toolUses) {
      toolsUsed.push(tu.name)
      log('task', 'running', `[AI工具] ${tu.name}`, tu.input)
      try {
        const result = await executeBrowserTool(tu.name, tu.input)
        let content: any = typeof result === 'string' ? result : JSON.stringify(result)
        if (tu.name === 'browser_screenshot' && result?.dataUrl) {
          const b64 = result.dataUrl.replace(/^data:image\/png;base64,/, '')
          content = [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
            { type: 'text', text: `Page: ${result.url || ''}` },
          ]
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content })
        log('task', 'success', `完成: ${tu.name}`)
      } catch (err: any) {
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${err.message}`, is_error: true })
        log('task', 'error', `失败: ${tu.name} — ${err.message}`)
      }
    }
    messages.push({ role: 'user', content: toolResults })
    iter++
  }
  return { text: '已达到最大迭代次数', toolsUsed }
}

// ── Memory card execution ─────────────────────────────────────────────────
let cardRunning = false
let cardStopRequested = false

async function runCard(cardId: string) {
  if (cardRunning) {
    log('card', 'warn', '已有卡片正在执行，请先停止')
    return
  }
  const card = await getCard(cardId)
  if (!card) {
    broadcast({ type: 'card:done', cardId, success: false, reason: '卡片不存在' })
    log('card', 'error', '卡片不存在')
    return
  }
  cardRunning = true
  cardStopRequested = false
  const total = card.steps.length
  log('card', 'info', `开始执行卡片「${card.name}」，共 ${total} 步`)

  try {
    for (let i = 0; i < total; i++) {
      if (cardStopRequested) {
        log('card', 'warn', `已停止：${card.name}（第 ${i + 1}/${total} 步前）`)
        broadcast({ type: 'card:done', cardId, success: false, reason: 'stopped' })
        return
      }
      const step = card.steps[i]
      const label = `[${i + 1}/${total}] ${step.note}`
      broadcast({ type: 'card:progress', cardId, index: i, total, note: step.note, tool: step.tool, status: 'running' })
      log('card', 'running', label, { tool: step.tool, args: step.args })
      try {
        const result = await executeBrowserTool(step.tool, step.args || {})
        log('card', 'success', `完成 ${label}`, result)
        broadcast({ type: 'card:progress', cardId, index: i, total, note: step.note, tool: step.tool, status: 'success' })
      } catch (err: any) {
        const errMsg = err?.message || String(err)
        log('card', 'error', `失败 ${label} — ${errMsg}`)
        broadcast({ type: 'card:progress', cardId, index: i, total, note: step.note, tool: step.tool, status: 'error', error: errMsg })
        broadcast({ type: 'card:done', cardId, success: false, reason: errMsg })
        return
      }
    }
    log('card', 'success', `卡片执行完成：${card.name}`)
    broadcast({ type: 'card:done', cardId, success: true })
  } finally {
    cardRunning = false
  }
}

// ── Popup port management ─────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return
  popupPorts.add(port)

  // Send current state immediately
  port.postMessage({ type: 'agent:status', status: currentStatus })
  getActivity().then(entries => {
    entries.forEach(e => port.postMessage({ type: 'activity:log', entry: e }))
  })

  port.onDisconnect.addListener(() => popupPorts.delete(port))

  port.onMessage.addListener(async (msg: PopupMsg) => {
    switch (msg.type) {
      case 'agent:connect':    { await connect(); break }
      case 'agent:disconnect': { disconnect();    break }

      case 'settings:get': {
        const settings = await getSettings()
        port.postMessage({ type: 'settings:data', settings })
        break
      }
      case 'settings:save': {
        await saveSettings(msg.payload)
        break
      }

      case 'chat:send': {
        try {
          const result = await runChat(msg.messages)
          port.postMessage({ type: 'chat:response', text: result.text, toolsUsed: result.toolsUsed })
        } catch (err: any) {
          port.postMessage({ type: 'chat:error', error: err.message })
        }
        break
      }

      case 'connection:test': {
        const result = await testConnection()
        port.postMessage({ type: 'connection:result', result })
        break
      }

      case 'card:run': {
        void runCard(msg.cardId)
        break
      }
      case 'card:stop': {
        if (cardRunning) { cardStopRequested = true; log('card', 'warn', '收到停止请求') }
        break
      }
    }
  })
})

// ── Keepalive alarm ───────────────────────────────────────────────────────
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && socket && !socket.connected && currentStatus !== 'connecting') {
    socket.connect()
  }
})

// ── Context menus ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'hs-ask', title: 'HeySure AI: 询问选中内容', contexts: ['selection'] })
  chrome.contextMenus.create({ id: 'hs-screenshot', title: 'HeySure AI: 截图分析此页', contexts: ['page'] })
})

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'hs-ask' && info.selectionText) {
    await chrome.storage.session.set({ _pendingChat: info.selectionText })
  }
})

// ── Auto-connect on browser startup ──────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  const s = await getSettings()
  if (s.autoConnect) await connect()
})

// On install / update — register alarms fresh
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
})
