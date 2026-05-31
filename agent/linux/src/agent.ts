import { io, Socket } from 'socket.io-client'
import os from 'os'
import path from 'path'
import { executeTask, getAvailableTools, getToolDefs, DispatchedTask } from './executor'
import { getPlatformInfo } from './platform'
import { AgentSettings } from './store'
import { normalizeServerUrl } from './server-url'

export type AgentStatus = 'disconnected' | 'connecting' | 'connected' | 'registered' | 'error'

export interface AgentEvents {
  // aiConfigId is the server-side bound AI (null = none assigned yet), used by
  // the UI status indicator: green = connected + assigned, yellow = connected
  // but unassigned, red = disconnected.
  onStatusChange?: (status: AgentStatus, reason?: string, aiConfigId?: number | null) => void
  onTaskStart?: (taskId: string, tool: string, args: any) => void
  onTaskResult?: (taskId: string, tool: string, result: any, success: boolean) => void
  onLog?: (level: 'info' | 'warn' | 'error', message: string, data?: any) => void
}

type CachedOutcome =
  | { kind: 'running' }
  | { kind: 'result'; payload: any }
  | { kind: 'error'; error: string }

export class HeySureAgent {
  private socket: Socket | null = null
  private taskOutcomes = new Map<string, CachedOutcome>()
  private settings: AgentSettings
  private events: AgentEvents
  private _status: AgentStatus = 'disconnected'
  private _boundAiConfigId: number | null = null
  workspaceRoot: string

  constructor(settings: AgentSettings, events: AgentEvents = {}) {
    this.settings = settings
    this.events = events
    this.workspaceRoot = settings.workspaceRoot || path.join(os.homedir(), 'HeySureWorkspace')
  }

  get status(): AgentStatus { return this._status }
  get boundAiConfigId(): number | null { return this._boundAiConfigId }

  private setStatus(s: AgentStatus, reason?: string) {
    this._status = s
    // Losing the connection clears the binding so we don't show green offline;
    // it is re-applied from the next agent:registered.
    if (s !== 'registered' && s !== 'connected') this._boundAiConfigId = null
    this.events.onStatusChange?.(s, reason, this._boundAiConfigId)
  }

  private log(level: 'info' | 'warn' | 'error', msg: string, data?: any) {
    this.events.onLog?.(level, msg, data)
  }

  connect(): void {
    if (this.socket?.connected) return
    // Hard gate: an agent that hasn't logged in cannot talk to the server.
    // Without this guard the socket would open transport-level, the UI would
    // flash "已连接", then the server would reject agent:register a moment
    // later. Refusing here keeps the status honest.
    if (!this.settings.authToken) {
      this.setStatus('disconnected')
      this.log('warn', '未登录，已阻止连接服务器（请先登录账号）')
      return
    }
    this.setStatus('connecting')
    let serverUrl: string
    try {
      serverUrl = normalizeServerUrl(this.settings.serverUrl)
    } catch {
      this.setStatus('error', '服务器 URL 格式无效')
      this.log('error', '连接错误: 服务器 URL 格式无效')
      return
    }
    this.log('info', `正在连接 ${serverUrl}…`)

    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    })

    this.socket.on('connect', () => {
      this.setStatus('connected')
      this.log('info', '已连接到服务器')
      this.register()
    })

    this.socket.on('disconnect', (reason: string) => {
      this.setStatus('disconnected', reason)
      this.log('warn', `连接断开: ${reason}`)
    })

    this.socket.on('connect_error', (err: Error) => {
      this.setStatus('error', err.message)
      this.log('error', `连接错误: ${err.message}`)
    })

    this.socket.on('agent:registered', (data: any) => {
      const raw = data?.aiConfigId
      const n = typeof raw === 'number' ? raw : (raw != null && String(raw).trim() !== '' ? Number(raw) : null)
      this._boundAiConfigId = Number.isFinite(n as number) ? (n as number) : null
      this.setStatus('registered')
      this.log('info', `注册成功: ${data?.name || this.settings.agentName}${this._boundAiConfigId == null ? '（未分配 AI）' : ''}`)
    })

    this.socket.on('agent:register_rejected', (data: any) => {
      this.setStatus('error', data?.reason || '注册被拒绝')
      this.log('error', `注册失败: ${data?.reason}`)
    })

    this.socket.on('task:dispatch', (task: DispatchedTask) => {
      void this.handleTask(task)
    })
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
    this.setStatus('disconnected')
  }

  private register(): void {
    const agentId = this.settings.agentId ||
      `agent-${os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    const hasAuth = !!this.settings.authToken
    // The desktop client no longer picks its own AI. It just logs in and
    // connects; an operator assigns a server-side AI to this device from the
    // web Workshop ("作坊") panel. The server re-applies that binding on every
    // register, so we send aiConfigId: null and let the server decide.
    this.log('info', '注册 agent（AI 由服务器作坊分配）')
    this.socket?.emit('agent:register', {
      id: agentId,
      name: this.settings.agentName || os.hostname(),
      group: this.settings.agentGroup || '',
      platform: `linux-desktop (${os.hostname()})`,
      os: getPlatformInfo(),
      capabilities: getAvailableTools(),
      // Full self-described tool schemas (with the user's local description edits
      // merged in). The server stores these and surfaces them in mcp.list_tools /
      // describe_tool instead of hardcoding desktop tool schemas, so a tool added
      // to the catalog — or a description edited in the app — needs no server change.
      toolDefs: this.effectiveToolDefs(),
      version: '2.0.0',
      // The server requires a valid user JWT. ``authToken`` is the source
      // of truth; agentToken is kept as a legacy shared-secret fallback.
      token: this.settings.authToken || this.settings.agentToken || '',
      workspaceRoot: this.workspaceRoot,
      lifecycle: 'registered',
      // The server classifies an agent as "desktop" when its platform string
      // contains "desktop"/"windows" or one of these flags is set. The
      // platform above already carries "desktop"; we keep isWindowsDesktop set
      // so existing routing that checks that flag still treats this Linux
      // endpoint as a desktop agent, and add isLinuxDesktop for clarity.
      isWindowsDesktop: true,
      isLinuxDesktop: true,
      aiConfigId: null,
      userId: hasAuth ? this.settings.userId : null,
    })
  }

  private async handleTask(task: DispatchedTask): Promise<void> {
    const taskId = task.taskId
    if (!taskId) return

    // Idempotency: replay cached outcome for duplicate dispatches
    const cached = this.taskOutcomes.get(taskId)
    if (cached) {
      if (cached.kind === 'result') this.socket?.emit('task:result', cached.payload)
      else if (cached.kind === 'error') this.socket?.emit('task:error', { taskId, error: cached.error })
      return
    }

    this.taskOutcomes.set(taskId, { kind: 'running' })
    const tool = task.tool || '(infer)'
    this.events.onTaskStart?.(taskId, tool, task.args || {})
    this.log('info', `任务 [${taskId}] 开始: ${tool}`, task.args)

    this.socket?.emit('task:progress', { taskId, progress: 0, message: `开始执行 ${tool}…` })

    try {
      const outcome = await executeTask(this.workspaceRoot, task)
      const payload = {
        taskId,
        userId: task.userId,
        aiConfigId: task.aiConfigId,
        sessionId: task.sessionId,
        tool: outcome.tool,
        success: outcome.success,
        result: outcome.result,
        summary: outcome.summary,
        workspaceRoot: this.workspaceRoot,
      }
      this.taskOutcomes.set(taskId, { kind: 'result', payload })
      this.socket?.emit('task:result', payload)
      this.events.onTaskResult?.(taskId, outcome.tool, outcome.result, outcome.success)
      this.log(outcome.success ? 'info' : 'warn', `任务 [${taskId}] ${outcome.success ? '完成' : '失败'}: ${outcome.summary}`)
    } catch (err: any) {
      const errMsg = err?.message || String(err)
      this.taskOutcomes.set(taskId, { kind: 'error', error: errMsg })
      this.socket?.emit('task:error', { taskId, userId: task.userId, error: errMsg })
      this.events.onTaskResult?.(taskId, tool, null, false)
      this.log('error', `任务 [${taskId}] 异常: ${errMsg}`)
    }
  }

  // Run a single tool locally for the MCP tester page (no server dispatch).
  async runToolLocally(tool: string, args: Record<string, any>): Promise<{ success: boolean; result: any; summary: string }> {
    const task: DispatchedTask = { taskId: `local-${Date.now()}`, tool, args: args || {} }
    return executeTask(this.workspaceRoot, task)
  }

  // getToolDefs() with the user's local description edits merged in.
  effectiveToolDefs() {
    const overrides = (this.settings as any).toolDescOverrides || {}
    return getToolDefs().map(def => {
      const o = overrides[def.name]
      if (!o) return def
      const desc = String(o.description || '').trim()
      const props = (def.input_schema && def.input_schema.properties) || {}
      let nextProps = props
      if (o.parameters && Object.keys(o.parameters).length) {
        nextProps = {}
        for (const [k, v] of Object.entries(props)) {
          const pd = String(o.parameters[k] || '').trim()
          nextProps[k] = pd ? { ...(v as any), description: pd } : v
        }
      }
      return {
        ...def,
        description: desc || def.description,
        input_schema: { ...def.input_schema, properties: nextProps },
      }
    })
  }

  updateSettings(newSettings: AgentSettings): void {
    const wasConnected = this.socket?.connected
    if (wasConnected) this.disconnect()
    this.settings = newSettings
    this.workspaceRoot = newSettings.workspaceRoot || path.join(os.homedir(), 'HeySureWorkspace')
    if (wasConnected) this.connect()
  }
}
