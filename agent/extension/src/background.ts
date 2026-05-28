// background.ts — HeySure Agent service worker
// Manages: Socket.IO server connection, task dispatching, popup port communication
import { io, Socket } from 'socket.io-client'
import { getSettings, saveSettings, pushActivity, getActivity, getCard, getAuth } from './lib/storage'
import { listConfigs, MemberConfig } from './lib/client'
import { executeTask, executeBrowserTool, BROWSER_CAPABILITIES, BROWSER_TOOLS, runCardSteps, setCardProgress, runScheduledCard } from './lib/tools'
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
// Set while connect() is probing candidate URLs so a parallel call (e.g.
// from the keepalive alarm or popup) doesn't kick off a second probe.
let connecting = false
// URL the current `socket` was opened against — used to detect when the
// configured serverUrl changes and we need to drop the cached endpoint.
let activeSocketUrl: string | null = null

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
    probe.on('agent:registered',        ()           => settle({ kind: 'registered', socket: probe }))
    probe.on('agent:register_rejected', (data: any)  => settle({ kind: 'rejected',   reason: data?.reason || '注册被服务器拒绝' }))
  })
}

async function emitRegisterOn(s: Socket): Promise<void> {
  const settings = await getSettings()
  const auth = await getAuth()
  if (settings.offlineMode) return
  const id = settings.agentId || await getMachineId()
  const selectedAiConfigId = auth.token ? (settings.selectedAiConfigId || null) : null
  s.emit('agent:register', {
    id,
    aiConfigId: selectedAiConfigId,
    name:            settings.agentName || 'Browser Agent',
    group:           settings.agentGroup || '',
    platform:        `browser-extension (${navigator?.userAgent?.split(' ').pop() || 'chrome'})`,
    os:              { platform: 'browser', arch: 'unknown', release: '1.0', hostname: id },
    capabilities:    BROWSER_CAPABILITIES,
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

  connecting = true
  setStatus('connecting')

  try {
    let winner: Socket | null = null
    let winnerUrl = ''
    let rejected: string | null = null
    const failures: Array<{ url: string; reason: string }> = []

    for (const candidate of candidates) {
      log('system', 'info', `探测 Agent 服务器: ${candidate}`)
      const outcome = await probeRegister(candidate, 6000)
      if (outcome.kind === 'registered' && outcome.socket) {
        winner = outcome.socket
        winnerUrl = candidate
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
    setStatus('registered')
    log('system', 'success', `已注册: ${data?.name || agentName}`)
  })

  s.on('agent:register_rejected', (data: any) => {
    setStatus('error', data?.reason)
    log('system', 'error', `注册被拒绝: ${data?.reason}`)
  })

  s.on('task:dispatch', (task: DispatchedTask) => { void handleTask(task) })
}

async function register() {
  const settings = await getSettings()
  const auth = await getAuth()
  if (settings.offlineMode) {
    log('system', 'info', '离线模式已开启，跳过注册')
    return
  }
  if (!socket) return
  const selectedAiConfigId = auth.token ? (settings.selectedAiConfigId || null) : null
  if (!auth.token && settings.selectedAiConfigId) {
    await saveSettings({ selectedAiConfigId: null })
    log('system', 'warn', '未登录，已取消 AI 成员自动注册选择')
  }
  log('system', 'info', `注册 agent (AI=${selectedAiConfigId ?? '未选择'})`)
  await emitRegisterOn(socket)
}

function disconnect() {
  socket?.disconnect()
  socket = null
  activeSocketUrl = null
  setStatus('disconnected')
}

async function refreshServerAiSelectionOnStartup(): Promise<number | null> {
  const settings = await getSettings()
  const auth = await getAuth()
  if (settings.offlineMode || !auth.token || !settings.serverUrl) return null

  let members: MemberConfig[]
  try {
    members = await listConfigs(settings.serverUrl, auth.token)
  } catch (err: any) {
    log('system', 'warn', `启动时获取 AI 成员失败: ${err?.message || err}`)
    return null
  }

  const selectedAiConfigId = settings.selectedAiConfigId || null
  if (!selectedAiConfigId) return null

  const selected = members.find(m => m.id === selectedAiConfigId)
  if (!selected) {
    await saveSettings({ selectedAiConfigId: null })
    log('system', 'warn', '上次选择的 AI 已不存在，已清除自动选择')
    return null
  }

  log('system', 'info', `已恢复上次选择的 AI：${selected.name || selected.id}`)
  return selectedAiConfigId
}

async function restoreAndConnectOnStartup() {
  const selectedAiConfigId = await refreshServerAiSelectionOnStartup()
  const s = await getSettings()
  if (!s.offlineMode && (selectedAiConfigId || s.autoConnect)) await connect()
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

Memory cards: when the user asks to save a sequence of actions, call card_save (steps are
{tool,args,note}, where note is a 备注). Replay with card_run by name/id. If card_run returns a
failedStep, diagnose it, fix that step with card_update_step, and run again until it works.

When asked to complete tasks, use the available tools systematically and summarize what you did.
Respond in the same language as the user. For factual questions, search the web if needed.`

async function runChat(messages: ChatMessage[]): Promise<{ text: string; toolsUsed: string[]; toolEvents: ChatToolEvent[] }> {
  const settings = await getSettings()
  if (!settings.aiKey) throw new Error('未配置 AI Key')

  const toolsUsed: string[] = []
  const toolEvents: ChatToolEvent[] = []
  let iter = 0
  const MAX = 12

  while (iter < MAX) {
    const resp = await callAI(settings.aiBaseUrl, settings.aiKey, settings.aiModel, messages, BROWSER_TOOLS, CHAT_SYSTEM)

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

// ── Memory card execution ─────────────────────────────────────────────────
let cardRunning = false
let cardStopRequested = false

// Surface per-step progress (for both popup-triggered and AI-triggered runs)
// to the activity feed and the cards UI.
setCardProgress((cardId, index, total, note, tool, status, error) => {
  broadcast({ type: 'card:progress', cardId, index, total, note, tool, status, error })
  const label = `[${index + 1}/${total}] ${note}`
  if (status === 'running')      log('card', 'running', label, { tool })
  else if (status === 'success') log('card', 'success', `完成 ${label}`)
  else if (status === 'error')   log('card', 'error', `失败 ${label} — ${error || ''}`)
})

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
  log('card', 'info', `开始执行卡片「${card.name}」，共 ${card.steps.length} 步`)
  try {
    const res = await runCardSteps(card, { shouldStop: () => cardStopRequested })
    if (res.stopped) {
      log('card', 'warn', `已停止：${card.name}`)
      broadcast({ type: 'card:done', cardId, success: false, reason: 'stopped' })
    } else if (res.success) {
      log('card', 'success', `卡片执行完成：${card.name}`)
      broadcast({ type: 'card:done', cardId, success: true })
    } else {
      broadcast({ type: 'card:done', cardId, success: false, reason: res.failedStep?.error || '执行失败' })
    }
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
      case 'auth:logout': {
        // Drop the socket entirely so the server sees us leaving and we
        // don't keep re-registering with an empty/stale token. Also
        // clear the cached agent URL so the next login re-probes the
        // (possibly different) backend.
        disconnect()
        await saveSettings({ selectedAiConfigId: null, lastWorkingAgentUrl: '' })
        break
      }

      case 'settings:get': {
        const settings = await getSettings()
        port.postMessage({ type: 'settings:data', settings })
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
      case 'agent:selected-ai': {
        const auth = await getAuth()
        const aiConfigId = auth.token ? msg.aiConfigId : null
        if (msg.aiConfigId && !auth.token) {
          log('system', 'warn', '请先登录软件端账号，再选择 AI 成员自动注册')
        }
        await saveSettings({ selectedAiConfigId: aiConfigId })
        if (socket?.connected) {
          // Already connected — re-register so the server updates the
          // agent record with the new aiConfigId.
          await register()
        } else if (aiConfigId && auth.token) {
          // Not yet connected. The user has shown intent (logged-in +
          // selected an AI) so connect now. Without this, the agent
          // either never registers, or — if the user later clicks
          // "connect" — registers without an aiConfigId, leaving the
          // server-side record showing the agent with no AI assigned.
          await connect()
        }
        break
      }

      case 'chat:send': {
        const requestId = msg.requestId
        try {
          const result = await runChat(msg.messages)
          port.postMessage({ type: 'chat:response', text: result.text, toolsUsed: result.toolsUsed, toolEvents: result.toolEvents, requestId })
        } catch (err: any) {
          port.postMessage({ type: 'chat:error', error: err.message, requestId })
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
  if (alarm.name.startsWith('card_schedule:')) {
    const scheduleId = alarm.name.slice('card_schedule:'.length)
    void runScheduledCard(scheduleId).then(res => {
      log('card', res?.success ? 'success' : 'error', `定时卡片 ${scheduleId} ${res?.success ? '完成' : '失败'}`, res)
    })
    return
  }
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
  await restoreAndConnectOnStartup()
})

void restoreAndConnectOnStartup()

// On install / update — register alarms fresh
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
})
