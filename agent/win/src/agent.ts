import { io, Socket } from 'socket.io-client'
import os from 'os'
import path from 'path'
import { executeTask, getAvailableTools, DispatchedTask } from './executor'
import { getPlatformInfo } from './platform'
import { AgentSettings } from './store'
import { normalizeServerUrl } from './server-url'

export type AgentStatus = 'disconnected' | 'connecting' | 'connected' | 'registered' | 'error'

export interface AgentEvents {
  onStatusChange?: (status: AgentStatus, reason?: string) => void
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
  workspaceRoot: string

  constructor(settings: AgentSettings, events: AgentEvents = {}) {
    this.settings = settings
    this.events = events
    this.workspaceRoot = settings.workspaceRoot || path.join(os.homedir(), 'HeySureWorkspace')
  }

  get status(): AgentStatus { return this._status }

  private setStatus(s: AgentStatus, reason?: string) {
    this._status = s
    this.events.onStatusChange?.(s, reason)
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
      this.setStatus('registered')
      this.log('info', `注册成功: ${data?.name || this.settings.agentName}`)
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
    const selectedAiConfigId = hasAuth ? this.settings.selectedAiConfigId : null
    if (!hasAuth && this.settings.selectedAiConfigId) {
      this.log('warn', '未登录，已忽略残留的 AI 成员自动注册选择')
    }
    this.socket?.emit('agent:register', {
      id: agentId,
      name: this.settings.agentName || os.hostname(),
      group: this.settings.agentGroup || '',
      platform: `win32-desktop (${os.hostname()})`,
      os: getPlatformInfo(),
      capabilities: getAvailableTools(),
      version: '2.0.0',
      // The server requires a valid user JWT. ``authToken`` is the source
      // of truth; agentToken is kept as a legacy shared-secret fallback.
      token: this.settings.authToken || this.settings.agentToken || '',
      workspaceRoot: this.workspaceRoot,
      lifecycle: 'registered',
      isWindowsDesktop: true,
      aiConfigId: selectedAiConfigId,
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

  updateSettings(newSettings: AgentSettings): void {
    const wasConnected = this.socket?.connected
    if (wasConnected) this.disconnect()
    this.settings = newSettings
    this.workspaceRoot = newSettings.workspaceRoot || path.join(os.homedir(), 'HeySureWorkspace')
    if (wasConnected) this.connect()
  }
}
