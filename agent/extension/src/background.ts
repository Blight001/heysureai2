// background.ts — HeySure Agent service worker
// Manages: Socket.IO server connection, task dispatching, popup port communication
import { io, Socket } from 'socket.io-client'
import { getSettings, saveSettings, pushActivity, getActivity, getAuth } from './lib/storage'
import { executeTask, executeBrowserTool, effectiveToolDefs } from './lib/tools'
import { callAI } from './lib/ai'
import { screenshotToolContent } from './lib/ai'
import {
  AgentStatus, DispatchedTask, ActivityEntry,
  PopupMsg, BgMsg, ChatMessage, ChatToolEvent,
} from './lib/types'

// ── State ─────────────────────────────────────────────────────────────────
let socket:        Socket | null = null
let currentStatus: AgentStatus   = 'disconnected'
const taskOutcomes = new Map<string, any>()
const popupPorts   = new Set<chrome.runtime.Port>()
let _machineId:    string | null = null
let currentAgentId: string | null = null
// Set while connect() is probing candidate URLs so a parallel call (e.g.
// from the keepalive alarm or popup) doesn't kick off a second probe.
let connecting = false
// URL the current `socket` was opened against — used to detect when the
// configured serverUrl changes and we need to drop the cached endpoint.
let activeSocketUrl: string | null = null
// Set when the server rejected registration for a non-transient reason
// (expired/invalid token or AI-ownership mismatch). Retrying with the same
// token just loops forever, so we stop auto-reconnect and the keepalive
// alarm until the user re-authenticates or explicitly reconnects. Cleared
// at the start of connect() and on logout.
let authRejected = false

async function withTaskTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function taskTimeoutMs(task: DispatchedTask) {
  const fromArgs = Number(task.args?.task_timeout_ms || task.args?.timeout_seconds && Number(task.args.timeout_seconds) * 1000)
  if (Number.isFinite(fromArgs) && fromArgs > 0) return Math.min(110000, Math.max(5000, Math.round(fromArgs)))
  if (task.tool === 'browser_screenshot') return 35000
  return 90000
}

// ── Activity logging ──────────────────────────────────────────────────────
function mkEntry(type: string, status: string, message: string, data?: any): ActivityEntry {
  return { id: Math.random().toString(36).slice(2), type, status, message, data, timestamp: Date.now() }
}

function log(type: string, status: string, message: string, data?: any) {
  const entry = mkEntry(type, status, message, data)
  void pushActivity(entry)
  broadcast({ type: 'activity:log', entry })
}

function refreshPopupStatus() {
  broadcast({ type: 'agent:status', status: currentStatus, aiConfigId: boundAiConfigId })
}

// Server-side bound AI for this device, learned from agent:registered. null =
// none assigned yet → the popup status indicator shows yellow instead of green.
let boundAiConfigId: number | null = null

// ── Status management ─────────────────────────────────────────────────────
function setStatus(status: AgentStatus, reason?: string) {
  currentStatus = status
  if (status !== 'registered' && status !== 'connected') boundAiConfigId = null
  broadcast({ type: 'agent:status', status, reason, aiConfigId: boundAiConfigId })
  const colors: Record<AgentStatus, string> = {
    disconnected: '#787878', connecting: '#f59e0b',
    connected: '#6366f1',    registered: '#22c55e',  error: '#ef4444',
  }
  chrome.action.setBadgeBackgroundColor({ color: colors[status] })
  chrome.action.setBadgeText({ text: status === 'registered' ? '●' : status === 'error' ? '!' : '' })
  chrome.action.setTitle({ title: `HeySure Agent — ${status}` })
}

// ── Popup broadcast ───────────────────────────────────────────────────────
function postToPopup(port: chrome.runtime.Port, msg: BgMsg): boolean {
  try {
    port.postMessage(msg)
    return true
  } catch {
    popupPorts.delete(port)
    return false
  }
}

function broadcast(msg: BgMsg) {
  popupPorts.forEach(port => {
    postToPopup(port, msg)
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

// ── Candidate URL discovery ───────────────────────────────────────────────
// The agent Socket.IO endpoint isn't always the same as the HTTP login
// URL. In split deployments (api-gateway on 3000 + connector-runtime on
// 3002) registering against the gateway succeeds at the transport layer
// but never receives `agent:registered` because only user-side handlers
// are bound there. We therefore probe a small set of likely endpoints
// derived from the configured serverUrl and remember the winner.
function buildAgentCandidates(serverUrl: string, override: string, cached: string): string[] {
  const list: string[] = []
  const push = (raw: string) => {
    const trimmed = String(raw || '').trim()
    if (!trimmed) return
    try {
      const u = new URL(trimmed)
      const href = u.href.replace(/\/+$/, '')
      if (!list.includes(href)) list.push(href)
    } catch { /* ignore malformed */ }
  }

  // Manual override always wins and short-circuits everything else.
  if (override.trim()) {
    push(override)
    return list
  }

  push(cached)
  push(serverUrl)

  // Heuristic siblings of the login URL — the standard split deployment
  // exposes connector-runtime on 3002 (agents) next to api-gateway on
  // 3000 (HTTP). Also probe 3001 in case a custom layout swaps them.
  try {
    const base = new URL(serverUrl)
    for (const port of ['3002', '3001']) {
      const alt = new URL(base.href)
      alt.port = port
      push(alt.href)
    }
  } catch { /* serverUrl already validated by caller */ }

  return list
}

interface ProbeOutcome {
  kind:    'registered' | 'rejected' | 'failed'
  socket?: Socket
  reason?: string
  aiConfigId?: number | null
}

function parseAiConfigId(raw: any): number | null {
  const n = typeof raw === 'number' ? raw : (raw != null && String(raw).trim() !== '' ? Number(raw) : null)
  return Number.isFinite(n as number) ? (n as number) : null
}

// Try to register against a single URL. Resolves once the server replies
// with agent:registered (success), agent:register_rejected (auth/AI
// problem — not a routing issue, bail without trying more candidates), a
// connect_error, or the timeout. On non-success the probe socket is
// torn down before resolving so we never leak partial connections.
function probeRegister(url: string, timeoutMs: number): Promise<ProbeOutcome> {
  return new Promise(resolve => {
    const probe = io(url, {
      transports:           ['websocket'],
      reconnection:         false,
      timeout:              timeoutMs,
      forceNew:             true,
      autoConnect:          true,
    })

    let settled = false
    const settle = (outcome: ProbeOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (outcome.kind === 'registered') {
        resolve(outcome)
      } else {
        try { probe.removeAllListeners(); probe.disconnect() } catch { /* noop */ }
        resolve(outcome)
      }
    }

    const timer = setTimeout(() => settle({ kind: 'failed', reason: '注册超时（无响应）' }), timeoutMs)

    probe.on('connect', () => { void emitRegisterOn(probe) })
    probe.on('connect_error', (err: Error) => settle({ kind: 'failed', reason: err?.message || 'connect_error' }))
    probe.on('disconnect',    (reason: string) => settle({ kind: 'failed', reason: `disconnected: ${reason}` }))
    probe.on('agent:registered',        (data: any)  => settle({ kind: 'registered', socket: probe, aiConfigId: parseAiConfigId(data?.aiConfigId) }))
    probe.on('agent:register_rejected', (data: any)  => settle({ kind: 'rejected',   reason: data?.reason || '注册被服务器拒绝' }))
  })
}

async function emitRegisterOn(s: Socket): Promise<void> {
  const settings = await getSettings()
  const auth = await getAuth()
  if (settings.offlineMode) return
  const id = settings.agentId || await getMachineId()
  currentAgentId = id
  // The extension no longer picks its own AI — it logs in and connects, then an
  // operator assigns a server-side AI to this device from the web Workshop
  // ("作坊") panel. The server re-applies that binding on every register, so we
  // always send aiConfigId: null.
  // Only the tools the user has enabled in the popup are reported. Capabilities
  // are derived from the same enabled toolDefs so the two never drift — disabled
  // (e.g. unchecked 特殊类) tools are withheld from the server entirely.
  const toolDefs = await effectiveToolDefs()
  s.emit('agent:register', {
    id,
    aiConfigId: null,
    name:            settings.agentName || 'Browser Agent',
    group:           settings.agentGroup || '',
    platform:        `browser-extension (${navigator?.userAgent?.split(' ').pop() || 'chrome'})`,
    os:              { platform: 'browser', arch: 'unknown', release: '1.0', hostname: id },
    capabilities:    toolDefs.map(t => t.name),
    // Full self-described tool schemas (with the user's local description edits
    // merged in). The server stores these and surfaces them in mcp.list_tools /
    // describe_tool instead of hardcoding browser tool schemas, so a tool added
    // here — or a description edited in the popup — needs no server change.
    toolDefs,
    version:         '1.0.0',
    token:           auth.token || settings.agentToken || '',
    userId:          auth.userId ?? null,
    workspaceRoot:   '',
    lifecycle:       'registered',
    isWindowsDesktop: false,
    isBrowserExtension: true,
  })
}

// ── Connect ───────────────────────────────────────────────────────────────
async function connect() {
  const settings = await getSettings()
  if (socket?.connected || connecting) return
  if (settings.offlineMode) {
    log('system', 'info', '离线模式已开启，跳过服务器连接')
    return
  }

  // Hard gate: an unauthenticated agent is rejected at agent:register
  // anyway. Refusing to even open the socket prevents the UI from
  // flashing "已连接" before the server rejects.
  const auth = await getAuth()
  if (!auth.token) {
    setStatus('disconnected')
    log('system', 'warn', '未登录，已阻止连接服务器（请先登录账号）')
    return
  }

  try { new URL(settings.serverUrl) } catch {
    log('system', 'error', '服务器 URL 格式无效')
    return
  }

  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
    activeSocketUrl = null
  }

  const candidates = buildAgentCandidates(
    settings.serverUrl,
    settings.agentServerUrl || '',
    settings.lastWorkingAgentUrl || '',
  )
  if (!candidates.length) {
    log('system', 'error', '没有可用的 Agent 服务器地址')
    return
  }

  // A fresh, user-initiated connect clears any prior rejection latch.
  authRejected = false
  connecting = true
  setStatus('connecting')

  try {
    let winner: Socket | null = null
    let winnerUrl = ''
    let winnerAiConfigId: number | null = null
    let rejected: string | null = null
    const failures: Array<{ url: string; reason: string }> = []

    for (const candidate of candidates) {
      log('system', 'info', `探测 Agent 服务器: ${candidate}`)
      const outcome = await probeRegister(candidate, 6000)
      if (outcome.kind === 'registered' && outcome.socket) {
        winner = outcome.socket
        winnerUrl = candidate
        winnerAiConfigId = outcome.aiConfigId ?? null
        break
      }
      if (outcome.kind === 'rejected') {
        rejected = outcome.reason || '注册被服务器拒绝'
        break  // auth/AI problem — trying another URL won't help
      }
      failures.push({ url: candidate, reason: outcome.reason || '未知失败' })
    }

    if (rejected) {
      setStatus('error', rejected)
      log('system', 'error', `注册被拒绝: ${rejected}`)
      return
    }

    if (!winner) {
      setStatus('error', '无法连接到 Agent 服务器')
      log('system', 'error',
        `无法连接到 Agent 服务器，尝试过：\n${failures.map(f => `· ${f.url} — ${f.reason}`).join('\n')}\n` +
        '请检查服务器是否启动；如服务端拆分部署，请在设置中填写 Agent 服务器 URL（如 http://your-host:3002）。',
        failures,
      )
      return
    }

    // Promote the probe socket to the active long-lived socket. We strip
    // the probe listeners and re-attach the full operational set so future
    // events (task dispatch, disconnect, registered after reconnect) flow
    // through the normal handlers.
    winner.removeAllListeners()
    socket = winner
    activeSocketUrl = winnerUrl
    boundAiConfigId = winnerAiConfigId
    setStatus('registered')
    log('system', 'success', `已连接并注册到 ${winnerUrl}`)
    if (settings.lastWorkingAgentUrl !== winnerUrl) {
      await saveSettings({ lastWorkingAgentUrl: winnerUrl })
    }
    attachOperationalListeners(socket, settings.agentName || 'Browser Agent')
  } finally {
    connecting = false
  }
}

function attachOperationalListeners(s: Socket, agentName: string) {
  // Probe sockets were created with reconnection:false to keep failed
  // probes from looping. Now that we're promoting one to the long-lived
  // socket, flip those Manager-level toggles back on. opts.reconnection
  // alone is read-only at runtime — the Manager actually checks
  // ``_reconnection`` set via the setter methods below.
  s.io.reconnection(true)
  s.io.reconnectionDelay(2000)
  s.io.reconnectionAttempts(Infinity)

  s.on('connect', async () => {
    setStatus('connected')
    log('system', 'info', '已连接到服务器')
    // Re-register after auto-reconnect with the freshest aiConfigId.
    await register()
  })

  s.on('disconnect', (reason: string) => {
    setStatus('disconnected', reason)
    log('system', 'warn', `连接断开: ${reason}`)
  })

  s.on('connect_error', (err: Error) => {
    setStatus('error', err.message)
    log('system', 'error', `连接失败: ${err.message}`)
  })

  s.on('agent:registered', (data: any) => {
    const raw = data?.aiConfigId
    const parsed = typeof raw === 'number' ? raw : (raw != null && String(raw).trim() !== '' ? Number(raw) : null)
    boundAiConfigId = Number.isFinite(parsed as number) ? (parsed as number) : null
    setStatus('registered')
    log('system', 'success', `已注册: ${data?.name || agentName}${boundAiConfigId == null ? '（未分配 AI）' : ''}`)
  })

  s.on('agent:list', (rows: any[]) => {
    if (!currentAgentId || !Array.isArray(rows)) return
    const mine = rows.find(row => String(row?.id || '') === currentAgentId)
    if (!mine) return
    const raw = mine?.aiConfigId ?? mine?.ai_config_id
    const parsed = typeof raw === 'number' ? raw : (raw != null && String(raw).trim() !== '' ? Number(raw) : null)
    const nextAiConfigId = Number.isFinite(parsed as number) ? (parsed as number) : null
    if (nextAiConfigId !== boundAiConfigId) {
      boundAiConfigId = nextAiConfigId
      refreshPopupStatus()
      log('system', 'info', `AI 绑定已更新: ${boundAiConfigId == null ? '未分配' : `#${boundAiConfigId}`}`)
    }
  })

  s.on('agent:register_rejected', (data: any) => {
    const reason = data?.reason || '注册被服务器拒绝'
    // Non-transient: the token is invalid/expired or the AI no longer
    // belongs to this user. Reconnecting and re-registering with the same
    // token would loop forever (reconnectionAttempts is Infinity), so we
    // latch authRejected, disable reconnection and tear the socket down.
    // The user must re-login (or pick a valid AI) and connect again.
    authRejected = true
    try { s.io.reconnection(false) } catch { /* noop */ }
    disconnect()
    setStatus('error', reason)
    log('system', 'error', `注册被拒绝，已停止自动重连（请重新登录后再连接）: ${reason}`)
  })

  s.on('task:dispatch', (task: DispatchedTask) => { void handleTask(task) })
}

async function register() {
  const settings = await getSettings()
  if (settings.offlineMode) {
    log('system', 'info', '离线模式已开启，跳过注册')
    return
  }
  if (!socket) return
  log('system', 'info', '注册 agent（AI 由服务器作坊分配）')
  await emitRegisterOn(socket)
}

function disconnect() {
  socket?.disconnect()
  socket = null
  activeSocketUrl = null
  setStatus('disconnected')
}

async function restoreAndConnectOnStartup() {
  const s = await getSettings()
  const auth = await getAuth()
  // Logged-in + online → link to the server automatically so the device shows
  // up in the Workshop panel ready to be assigned an AI.
  if (!s.offlineMode && auth.token) await connect()
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
    const timeoutMs = taskTimeoutMs(task)
    const outcome  = await withTaskTimeout(executeTask(task, settings), timeoutMs, `Endpoint task ${tool}`)
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
  let httpResult: any = null
  try {
    const start = Date.now()
    const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) })
      .catch(() => fetch(base, { signal: AbortSignal.timeout(5000) }))
    httpResult = { success: true, status: res.status, ms: Date.now() - start }
  } catch (err: any) {
    httpResult = { success: false, error: err.message }
  }

  // Probe the candidate agent URLs so the user can see which (if any)
  // accepts agent registration. We don't fail the whole test if no
  // candidate registers — the HTTP login may still be reachable while
  // the agent socket is being moved/restarted.
  const candidates = buildAgentCandidates(
    settings.serverUrl,
    settings.agentServerUrl || '',
    settings.lastWorkingAgentUrl || '',
  )
  const auth = await getAuth()
  const agentProbes: Array<{ url: string; ok: boolean; reason?: string }> = []
  let agentOkUrl = ''
  if (auth.token) {
    for (const candidate of candidates) {
      const outcome = await probeRegister(candidate, 5000)
      if (outcome.kind === 'registered') {
        agentProbes.push({ url: candidate, ok: true })
        agentOkUrl = candidate
        try { outcome.socket?.removeAllListeners(); outcome.socket?.disconnect() } catch { /* noop */ }
        break
      }
      agentProbes.push({ url: candidate, ok: false, reason: outcome.reason })
      if (outcome.kind === 'rejected') break  // not a routing issue
    }
  }

  return {
    success: httpResult.success,
    http: httpResult,
    agentProbes,
    agentOkUrl,
    needsLogin: !auth.token,
  }
}

// ── AI chat with agentic browser-tool loop ────────────────────────────────
const CHAT_SYSTEM = `You are HeySure AI, a browser automation assistant running as a Chrome extension.
You can navigate pages, click, double-click, right-click, type, drag, press keys, scroll, take
screenshots, search the web, detect and close popups/modals/dialogs, extract data, and more.

Use browser_page_info to know where you are on the page (scroll position, current section,
visible headings); after scrolling, read the returned position so you know where you landed and
what changed.

If a popup/modal/dialog blocks the page, call browser_find_popups to inspect detected dialogs and
browser_close_popup to close the matching one before continuing.

When asked to complete tasks, use the available tools systematically and summarize what you did.
Respond in the same language as the user. For factual questions, search the web if needed.`

async function runChat(messages: ChatMessage[]): Promise<{ text: string; toolsUsed: string[]; toolEvents: ChatToolEvent[] }> {
  const settings = await getSettings()
  if (!settings.aiKey) throw new Error('未配置 AI Key')

  const toolsUsed: string[] = []
  const toolEvents: ChatToolEvent[] = []
  let iter = 0
  const MAX = 12
  // Offline chat also respects the popup's tool selection: only enabled tools
  // (with local description edits applied) are offered to the model.
  const chatTools = await effectiveToolDefs()

  while (iter < MAX) {
    const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, chatTools, CHAT_SYSTEM)

    if (!resp.toolUses?.length) {
      return { text: resp.text || '完成', toolsUsed, toolEvents }
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
          content = screenshotToolContent(result)
          toolEvents.push({
            key: `${tu.id || tu.name}:${toolEvents.length}`,
            label: '浏览器截图',
            detail: [result.url, result.method].filter(Boolean).join('\n'),
            imageUrl: result.dataUrl,
          })
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
  return { text: '已达到最大迭代次数', toolsUsed, toolEvents }
}

// ── Popup port management ─────────────────────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return
  popupPorts.add(port)

  // Send current state immediately
  postToPopup(port, { type: 'agent:status', status: currentStatus, aiConfigId: boundAiConfigId })
  getActivity().then(entries => {
    entries.forEach(e => postToPopup(port, { type: 'activity:log', entry: e }))
  })

  port.onDisconnect.addListener(() => popupPorts.delete(port))

  port.onMessage.addListener(async (msg: PopupMsg) => {
    switch (msg.type) {
      case 'agent:connect':    { await connect(); break }
      case 'agent:disconnect': { disconnect();    break }
      case 'auth:logout': {
        // Drop the socket entirely so the server sees us leaving and we
        // don't keep re-registering with an empty/stale token. Also
        // clear the cached agent URL so the next login re-probes the
        // (possibly different) backend.
        authRejected = false
        disconnect()
        await saveSettings({ selectedAiConfigId: null, lastWorkingAgentUrl: '' })
        break
      }

      case 'settings:get': {
        const settings = await getSettings()
        postToPopup(port, { type: 'settings:data', settings })
        break
      }
      case 'settings:save': {
        const prev = await getSettings()
        const payload = { ...msg.payload }
        // If the user edited either the login URL or the manual agent
        // override, drop the cached working URL so the next connect()
        // re-probes against the new topology instead of reconnecting to
        // a stale endpoint.
        const serverUrlChanged = payload.serverUrl !== undefined && payload.serverUrl !== prev.serverUrl
        const agentUrlChanged  = payload.agentServerUrl !== undefined && payload.agentServerUrl !== prev.agentServerUrl
        if ((serverUrlChanged || agentUrlChanged) && payload.lastWorkingAgentUrl === undefined) {
          payload.lastWorkingAgentUrl = ''
        }
        await saveSettings(payload)
        if (payload.offlineMode === true && socket?.connected) {
          disconnect()
        }
        if ((serverUrlChanged || agentUrlChanged) && socket) {
          // Topology may have moved — drop the current socket so future
          // connect() calls re-probe instead of clinging to the old one.
          const wasConnected = !!socket
          disconnect()
          if (wasConnected && !payload.offlineMode) {
            // Reconnect against the new URL so the user doesn't have to
            // re-click "connect" after editing the address.
            void connect()
          }
        }
        break
      }
      case 'chat:send': {
        const requestId = msg.requestId
        try {
          const result = await runChat(msg.messages)
          postToPopup(port, { type: 'chat:response', text: result.text, toolsUsed: result.toolsUsed, toolEvents: result.toolEvents, requestId })
        } catch (err: any) {
          postToPopup(port, { type: 'chat:error', error: err.message, requestId })
        }
        break
      }

      case 'connection:test': {
        const result = await testConnection()
        postToPopup(port, { type: 'connection:result', result })
        break
      }

      case 'mcp:test': {
        // Run one browser tool locally and return its raw result to the popup.
        log('task', 'running', `测试: ${msg.tool}`, msg.args)
        try {
          const result = await withTaskTimeout(
            executeBrowserTool(msg.tool, msg.args || {}),
            taskTimeoutMs({ taskId: 'mcp-test', tool: msg.tool, args: msg.args }),
            `mcp.test ${msg.tool}`,
          )
          log('task', 'success', `测试完成: ${msg.tool}`)
          postToPopup(port, { type: 'mcp:test:result', requestId: msg.requestId, ok: true, result })
        } catch (err: any) {
          log('task', 'error', `测试失败: ${msg.tool} — ${err?.message || err}`)
          postToPopup(port, { type: 'mcp:test:result', requestId: msg.requestId, ok: false, error: err?.message || String(err) })
        }
        break
      }

    }
  })
})

// ── Keepalive alarm ───────────────────────────────────────────────────────
chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && socket && !socket.connected && currentStatus !== 'connecting' && !authRejected) {
    socket.connect()
  }
})

// ── Context menus ─────────────────────────────────────────────────────────
// Single onInstalled handler. removeAll() first so re-creating on update
// doesn't throw on the already-registered ids. The keepalive alarm is
// (re)created at module scope above on every service-worker wake, which is
// what actually matters for an MV3 worker that gets torn down frequently.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'hs-ask', title: 'HeySure AI: 询问选中内容', contexts: ['selection'] })
    chrome.contextMenus.create({ id: 'hs-screenshot', title: 'HeySure AI: 截图分析此页', contexts: ['page'] })
  })
})

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'hs-ask' && info.selectionText) {
    await chrome.storage.session.set({ _pendingChat: info.selectionText })
  } else if (info.menuItemId === 'hs-screenshot') {
    // Pre-fill the chat so opening the popup kicks off a screenshot+analyze
    // turn (the agent has browser_screenshot available). Without this the
    // menu item was registered but did nothing when clicked.
    await chrome.storage.session.set({ _pendingChat: '请截图并分析当前页面' })
  }
})

// ── Auto-connect on browser startup ──────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  await restoreAndConnectOnStartup()
})

void restoreAndConnectOnStartup()

// Login happens in the popup, but the actual socket lives in this service
// worker. Watch auth storage directly so a successful login always attempts
// to register even if the one-off popup port message is missed.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return
  const authChange = changes._auth_state
  if (!authChange) return

  const oldToken = String(authChange.oldValue?.token || '')
  const newToken = String(authChange.newValue?.token || '')
  if (oldToken === newToken) return

  authRejected = false
  if (newToken) {
    if (socket) disconnect()
    void connect()
  } else {
    disconnect()
  }
})
