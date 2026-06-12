/**
 * 数据绑定层：把现有 REST（listAiCards / listConnectedAgents / valhalla / librarian）
 * 和 Socket.IO（ui:join → agent:list / mcp:status / librarian:*）归一成一个世界快照，
 * 供 Phaser 场景消费。框架无关（不依赖 Vue），只读不写。
 *
 * 角色判定与 useDashboardData.ts 对齐：
 *   core_admin  = digital_member_role==='manager' || switch_key==='assistant_default'
 *   assistant   = ai_role==='assistant_admin'
 *   librarian   = is_librarian===true（/api/ai/cards 已透出该字段）
 */
import { io, type Socket } from 'socket.io-client'
import { get, getAuthToken } from '@/api/http'
import { me } from '@/api/auth'
import { listAiCards } from '@/api/ai'
import { listConnectedAgents } from '@/api/agents'
import { listValhallaEntries, type ValhallaEntry } from '@/api/valhalla'
import { listEntries, listProposals, readEntry, type KnowledgeEntryItem } from '@/api/librarian'
import { listWorldActorMeta, type WorldActorAppearance } from '@/api/world'

/** 服务端直推的世界事件（P2）：演出零延迟触发，权威状态仍以 refresh 为准 */
export interface WorldEvent {
  type: 'task_started' | 'task_finished' | 'member_inherited' | 'member_completed' | string
  payload: Record<string, any>
  timestamp: number
}

export type MemberRole = 'core_admin' | 'assistant_admin' | 'librarian' | 'member'

export interface WorldMember {
  id: number
  name: string
  role: MemberRole
  generation: number
  tokensUsed: number
  tokenLimit: number
  lifecycle: 'learning' | 'working' | 'reproducing' | 'dead'
  enabled: boolean
  runtimeStatus: 'running' | 'idle' | 'error'
  runtimeTool: string
  currentBehavior: string
  latestSpeech: string
  taskTitle: string
  taskStatus: string
  hasActiveTask: boolean
  model: string
  projectId: string
  projectName: string
  platform: string
  /** 绑定的端侧 agent id（来自 agent:list 的 aiConfigId 反查） */
  boundAgentIds: string[]
  /** 用户在世界里指定的皮肤（WorldActorMeta），空 = 默认哈希皮肤 */
  skin: string
  /** 外观调色 #RRGGBB（WorldActorMeta），空 = 不调色 */
  tint: string
  /** 体型缩放（WorldActorMeta），1 = 默认 */
  scale: number
  /** 光环颜色 #RRGGBB（WorldActorMeta），空 = 无光环 */
  aura: string
}

export interface WorldWorkshop {
  agentId: string
  name: string
  type: 'desktop' | 'browser' | 'workshop'
  lifecycle: string
  aiConfigId: number | null
  lastError: string | null
  platform: string
  capabilities: number
  online: boolean
}

export interface WorldSnapshot {
  /** token 是否存在且 /api 可用 */
  authOk: boolean
  socketConnected: boolean
  userId: number | null
  members: WorldMember[]
  workshops: WorldWorkshop[]
  valhallaCount: number
  valhallaItems: ValhallaEntry[]
  knowledgeActive: number
  knowledgeItems: KnowledgeEntryItem[]
  knowledgePending: number
  proposals: KnowledgeEntryItem[]
  lastError: string
}

type Listener = (snap: WorldSnapshot) => void

const POLL_MS = 8000

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const normalizeLifecycle = (v: unknown): WorldMember['lifecycle'] => {
  if (v === 'learning' || v === 'working' || v === 'reproducing' || v === 'dead') return v
  return 'working'
}

const normalizeRuntime = (v: unknown): WorldMember['runtimeStatus'] => {
  if (v === 'running' || v === 'error') return v
  return 'idle'
}

const roleOf = (row: Record<string, any>): MemberRole => {
  if (row.is_librarian) return 'librarian'
  if (row.ai_role === 'assistant_admin') return 'assistant_admin'
  if (row.digital_member_role === 'manager' || row.switch_key === 'assistant_default') return 'core_admin'
  return 'member'
}

const workshopTypeOf = (raw: Record<string, any>): 'desktop' | 'browser' | 'workshop' | null => {
  const platform = String(raw.platform || '').toLowerCase()
  const id = String(raw.id || '')
  // 知识与进化工坊：服务端内置，常在线（/api/agents/connected 注入虚拟条目）
  if (raw.isWorkshop || platform.includes('workshop')) return 'workshop'
  if (raw.isWindowsDesktop || id.startsWith('win-desktop-') || platform.includes('desktop') || platform.includes('windows')) {
    return 'desktop'
  }
  if (raw.isBrowserExtension || platform.includes('browser')) return 'browser'
  return null
}

const workshopAiConfigId = (raw: Record<string, any>): number | null => {
  const direct = num(raw.aiConfigId ?? raw.ai_config_id, NaN)
  if (Number.isFinite(direct) && direct > 0) return direct
  const m = String(raw.id || '').match(/^win-desktop-(\d+)$/)
  if (m) {
    const parsed = Number(m[1])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

export class WorldStore {
  private listeners: Listener[] = []
  private socket: Socket | null = null
  private pollTimer: number | null = null
  private rawAgents: Record<string, any>[] = []
  private rawOfflineAgents: Record<string, any>[] = []
  private runtimeOverride = new Map<number, { state: WorldMember['runtimeStatus']; tool: string }>()
  private metaByConfig = new Map<number, WorldActorAppearance>()

  snapshot: WorldSnapshot = {
    authOk: false,
    socketConnected: false,
    userId: null,
    members: [],
    workshops: [],
    valhallaCount: 0,
    valhallaItems: [],
    knowledgeActive: 0,
    knowledgeItems: [],
    knowledgePending: 0,
    proposals: [],
    lastError: '',
  }

  subscribe(fn: Listener): () => void {
    this.listeners.push(fn)
    fn(this.snapshot)
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn)
    }
  }

  private eventListeners: Array<(ev: WorldEvent) => void> = []

  /** 订阅服务端直推的世界事件（task_started / member_inherited / …） */
  onEvent(fn: (ev: WorldEvent) => void): () => void {
    this.eventListeners.push(fn)
    return () => {
      this.eventListeners = this.eventListeners.filter(l => l !== fn)
    }
  }

  /** 分发一条世界事件并安排一次去抖刷新（也供调试/测试注入） */
  dispatchEvent(ev: WorldEvent) {
    for (const fn of this.eventListeners) fn(ev)
    if (this.eventRefreshTimer !== null) window.clearTimeout(this.eventRefreshTimer)
    this.eventRefreshTimer = window.setTimeout(() => {
      this.eventRefreshTimer = null
      void this.refresh()
    }, 800)
  }

  private eventRefreshTimer: number | null = null

  private emit() {
    for (const fn of this.listeners) fn(this.snapshot)
  }

  start() {
    void this.refresh()
    this.pollTimer = window.setInterval(() => void this.refresh(), POLL_MS)
  }

  stop() {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer)
    this.pollTimer = null
    this.socket?.disconnect()
    this.socket = null
  }

  private async ensureSocket() {
    if (this.socket || this.snapshot.userId === null) return
    const userId = this.snapshot.userId
    const socket = io('/', { transports: ['websocket', 'polling'] })
    this.socket = socket
    socket.on('connect', () => {
      this.snapshot.socketConnected = true
      socket.emit('ui:join', { userId })
      this.emit()
    })
    socket.on('disconnect', () => {
      this.snapshot.socketConnected = false
      this.emit()
    })
    socket.on('agent:list', (rows: unknown) => {
      this.rawAgents = Array.isArray(rows) ? rows : []
      this.rebuildWorkshops()
      this.emit()
    })
    socket.on('mcp:status', (payload: Record<string, any>) => {
      if (num(payload?.userId, NaN) !== userId) return
      const configId = num(payload?.aiConfigId, NaN)
      if (!Number.isFinite(configId)) return
      this.runtimeOverride.set(configId, {
        state: normalizeRuntime(String(payload?.state || '').toLowerCase()),
        tool: String(payload?.tool || ''),
      })
      const target = this.snapshot.members.find(m => m.id === configId)
      if (target) {
        const o = this.runtimeOverride.get(configId)!
        target.runtimeStatus = o.state
        if (o.tool) target.runtimeTool = o.tool
        this.emit()
      }
    })
    const refreshKnowledge = () => void this.refreshKnowledge().then(() => this.emit())
    socket.on('librarian:proposal_new', refreshKnowledge)
    socket.on('librarian:proposal_resolved', refreshKnowledge)
    socket.on('world:event', (data: Record<string, any>) => {
      if (num(data?.userId, NaN) !== userId) return
      this.dispatchEvent({
        type: String(data?.type || ''),
        payload: (data?.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<string, any>,
        timestamp: num(data?.timestamp, Date.now() / 1000),
      })
    })
  }

  private rebuildWorkshops() {
    const workshops: WorldWorkshop[] = []
    const onlineIds = new Set(this.rawAgents.map(raw => String(raw.id || raw.socketId || '')))
    const rows = [
      ...this.rawAgents,
      ...this.rawOfflineAgents.filter(raw => !onlineIds.has(String(raw.id || raw.socketId || ''))),
    ]
    for (const raw of rows) {
      const type = workshopTypeOf(raw)
      if (!type) continue
      workshops.push({
        agentId: String(raw.id || raw.socketId || ''),
        name: String(raw.name || raw.id || 'agent'),
        type,
        lifecycle: String(raw.lifecycle || 'connected'),
        aiConfigId: workshopAiConfigId(raw),
        lastError: raw.lastError ? String(raw.lastError) : null,
        platform: String(raw.platform || ''),
        capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.length : 0,
        online: raw.online !== false && String(raw.lifecycle || '').toLowerCase() !== 'offline',
      })
    }
    workshops.sort((a, b) => a.agentId.localeCompare(b.agentId))
    this.snapshot.workshops = workshops
    // 成员 ←→ 作坊绑定反查
    const byConfig = new Map<number, string[]>()
    for (const w of workshops) {
      if (w.aiConfigId === null) continue
      const list = byConfig.get(w.aiConfigId) || []
      list.push(w.agentId)
      byConfig.set(w.aiConfigId, list)
    }
    for (const m of this.snapshot.members) {
      m.boundAgentIds = byConfig.get(m.id) || []
    }
  }

  private async refreshKnowledge() {
    const token = getAuthToken()
    if (!token) return
    try {
      const [entries, proposals] = await Promise.all([
        listEntries(token, { status: 'active' }),
        listProposals(token),
      ])
      const baseItems = entries.items ?? []
      this.snapshot.knowledgeItems = await Promise.all(
        baseItems.map(async item => {
          try {
            return await readEntry(token, item.memory_id)
          } catch {
            return item
          }
        }),
      )
      this.snapshot.knowledgeActive = this.snapshot.knowledgeItems.length
      this.snapshot.proposals = proposals.items ?? []
      this.snapshot.knowledgePending = this.snapshot.proposals.length
    } catch {
      // best-effort：知识计数失败不阻塞世界
    }
  }

  /** 操作（启停/绑定/审批/派任务）完成后立即重拉，不等下个轮询周期 */
  refreshNow(): Promise<void> {
    return this.refresh()
  }

  private applyMeta(items: Array<Record<string, any>>) {
    this.metaByConfig.clear()
    const hex = /^#[0-9a-fA-F]{6}$/
    for (const item of items || []) {
      const tint = String(item.tint || '')
      const aura = String(item.aura || '')
      const scale = num(item.scale, 1)
      const meta: WorldActorAppearance = {
        skin: String(item.skin || ''),
        tint: hex.test(tint) ? tint : '',
        scale: scale >= 0.7 && scale <= 1.4 ? scale : 1,
        aura: hex.test(aura) ? aura : '',
      }
      if (meta.skin || meta.tint || meta.aura || meta.scale !== 1) {
        this.metaByConfig.set(num(item.ai_config_id), meta)
      }
    }
  }

  private applyCards(cards: Record<string, any>[]) {
    this.snapshot.members = (Array.isArray(cards) ? cards : []).map((row): WorldMember => {
      const id = num(row.id)
      const override = this.runtimeOverride.get(id)
      const taskTitle = String(row.current_task_title || row.task_current?.title || '')
      const taskStatus = String(row.current_task_status || 'idle')
      const meta = this.metaByConfig.get(id)
      return {
        id,
        name: String(row.name || `AI-${id}`),
        role: roleOf(row),
        generation: Math.max(1, num(row.generation, 1)),
        tokensUsed: num(row.token_used),
        tokenLimit: num(row.token_limit),
        lifecycle: normalizeLifecycle(row.lifecycle_status),
        enabled: !!row.enabled,
        runtimeStatus: override?.state ?? normalizeRuntime(row.runtime_status),
        runtimeTool: override?.tool || String(row.latest_mcp_tool || row.runtime_tool || ''),
        currentBehavior: String(row.current_behavior || ''),
        latestSpeech: String(row.latest_thinking || ''),
        taskTitle,
        taskStatus,
        hasActiveTask: taskStatus === 'running' || taskStatus === 'queued' || !!row.task_current,
        model: String(row.model || ''),
        projectId: String(row.project_id || ''),
        projectName: String(row.project_name || ''),
        platform: String(row.platform || 'Server-Core'),
        boundAgentIds: [],
        skin: meta?.skin || '',
        tint: meta?.tint || '',
        scale: meta?.scale ?? 1,
        aura: meta?.aura || '',
      }
    })
  }

  private applyAgentRows(rows: Record<string, any>[]) {
    this.rawAgents = rows.filter(raw => raw.online !== false && String(raw.lifecycle || '').toLowerCase() !== 'offline')
    this.rawOfflineAgents = rows.filter(raw => raw.online === false || String(raw.lifecycle || '').toLowerCase() === 'offline')
  }

  /** P2 聚合：一次 /api/world/snapshot 拿全量；旧后端无该接口时返回 false 走分域回退 */
  private async refreshViaSnapshot(): Promise<boolean> {
    let data: Record<string, any>
    try {
      data = await get<Record<string, any>>('/api/world/snapshot', { fallbackError: 'snapshot 加载失败' })
    } catch {
      return false
    }
    this.applyMeta(Array.isArray(data.actor_meta) ? data.actor_meta : [])
    this.applyCards(Array.isArray(data.cards) ? data.cards : [])
    if (Array.isArray(data.agents)) this.applyAgentRows(data.agents)
    this.rebuildWorkshops()
    this.snapshot.valhallaItems = Array.isArray(data.valhalla_items) ? data.valhalla_items : []
    this.snapshot.valhallaCount = this.snapshot.valhallaItems.length
    this.snapshot.knowledgeItems = Array.isArray(data.knowledge_items) ? data.knowledge_items : []
    this.snapshot.knowledgeActive = this.snapshot.knowledgeItems.length || num(data.knowledge_active)
    this.snapshot.proposals = Array.isArray(data.proposals) ? data.proposals : []
    this.snapshot.knowledgePending = this.snapshot.proposals.length
    return true
  }

  /** 分域回退（兼容未部署 /api/world/snapshot 的后端） */
  private async refreshViaDomains(token: string) {
    const [cards, connected] = await Promise.all([listAiCards(), listConnectedAgents()])
    if (Array.isArray(connected?.agents)) this.applyAgentRows(connected.agents)
    try {
      const meta = await listWorldActorMeta()
      this.applyMeta(meta.items || [])
    } catch {
      // best-effort：旧后端没有该接口时退回默认皮肤
    }
    this.applyCards(cards as Record<string, any>[])
    this.rebuildWorkshops()
    try {
      const valhalla = await listValhallaEntries(token, { limit: 200 })
      this.snapshot.valhallaItems = valhalla.items ?? []
      this.snapshot.valhallaCount = this.snapshot.valhallaItems.length
    } catch {
      // best-effort
    }
    await this.refreshKnowledge()
  }

  private async refresh() {
    const token = getAuthToken()
    if (!token) {
      this.snapshot.authOk = false
      this.snapshot.lastError = '未登录：请先在主控制台登录，再刷新本页'
      this.emit()
      return
    }
    try {
      if (this.snapshot.userId === null) {
        const user = await me(token)
        this.snapshot.userId = num((user as Record<string, any>).id, NaN) || null
      }
      if (!(await this.refreshViaSnapshot())) {
        await this.refreshViaDomains(token)
      }
      this.snapshot.authOk = true
      this.snapshot.lastError = ''
      await this.ensureSocket()
    } catch (err) {
      this.snapshot.authOk = false
      this.snapshot.lastError = err instanceof Error ? err.message : '数据加载失败'
    }
    this.emit()
  }
}
