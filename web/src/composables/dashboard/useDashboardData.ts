import { onUnmounted, ref, watch } from 'vue'
import { io, type Socket } from 'socket.io-client'
import type {
  Agent,
  AgentRole,
  AgentStatus,
  AgentTaskSnapshot,
  KnowledgeItem,
  McpStatusPayload,
  ProjectItem,
} from '@/types'
import { listValhallaEntries, type ValhallaEntry } from '@/api/valhalla'
import { listEntries, listProposals, type KnowledgeEntryItem } from '@/api/librarian'
import { listAiCards, toggleAiRun } from '@/api/ai'
import {
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  listProjects,
  updateProject as apiUpdateProject,
  type UpsertProjectPayload,
} from '@/api/projects'
import { listConnectedAgents } from '@/api/agents'
import { listWorkspaceFiles } from '@/api/workspace'
import { getAuthToken } from '@/api/http'
import { TOKEN_LIMIT_DEFAULTS } from '@/constants/dashboard'

export interface ConnectedAgent {
  id: string
  name: string
  platform?: string
  aiConfigId?: number
  isWindowsDesktop?: boolean
  isBrowserExtension?: boolean
  capabilities: string[]
  version?: string
  lifecycle?: string
  group?: string
  workspaceRoot?: string
  lastTaskId?: string | null
  lastTaskStatus?: string | null
  lastTaskAt?: number | null
  lastError?: string | null
  connectedAt?: number
}

type MessageType = 'info' | 'success' | 'warning' | 'error'
type AlertFn = (options: string | { message: string; type?: MessageType }) => Promise<void>
type ConfirmFn = (options: string | { message: string; type?: MessageType }) => Promise<boolean>

interface UseDashboardDataOptions {
  unassignedProjectId: string
  alert: AlertFn
  confirm: ConfirmFn
  getCurrentUserId: () => number
  getMcpAutoApprove: (configId?: number) => boolean
}

export const useDashboardData = (options: UseDashboardDataOptions) => {
  const { unassignedProjectId, alert, confirm, getCurrentUserId, getMcpAutoApprove } = options

  const agents = ref<Agent[]>([])
  const connectedAgents = ref<ConnectedAgent[]>([])
  const knowledgeBase = ref<KnowledgeItem[]>([])
  const projects = ref<ProjectItem[]>([])
  const globalGeneration = ref(1)
  const allFiles = ref<string[]>([])
  const totalChatTokens = ref(0)
  const dashboardSocketConnected = ref(false)
  const valhallaEntries = ref<ValhallaEntry[]>([])
  const librarianPending = ref<KnowledgeEntryItem[]>([])

  let dashboardRefreshing = false
  let dashboardSocket: Socket | null = null
  const latestRuntimeToolByConfig = new Map<number, string>()

  const normalizeLifecycleStatus = (value?: string): AgentStatus => {
    if (value === 'learning' || value === 'working' || value === 'reproducing' || value === 'dead') {
      return value
    }
    return 'working'
  }

  const normalizeProjectStatus = (value?: string): 'running' | 'ended' => {
    return value === 'ended' ? 'ended' : 'running'
  }

  const normalizeRuntimeStatus = (value?: string): 'running' | 'idle' | 'error' => {
    if (value === 'running' || value === 'error') return value
    return 'idle'
  }

  const rememberLatestRuntimeTool = (configId?: number, tool?: string) => {
    if (typeof configId !== 'number' || !Number.isFinite(configId)) return ''
    const normalized = String(tool || '').trim()
    if (normalized) {
      latestRuntimeToolByConfig.set(configId, normalized)
      return normalized
    }
    return latestRuntimeToolByConfig.get(configId) || ''
  }

  const syncChatTokensToAgents = (chatTokens: number) => {
    totalChatTokens.value = chatTokens
  }

  const getProjectName = (projectId: string, fallbackName?: string) => {
    if (projectId === unassignedProjectId) return '学习中'
    const match = projects.value.find(project => project.id === projectId)
    return match?.name ?? fallbackName ?? projectId
  }

  const createAgent = (payload: Omit<Agent, 'id' | 'tokensUsed'> & { id?: string; tokensUsed?: number }) => {
    const id = payload.id ?? `${payload.role}-${Date.now()}`
    return {
      ...payload,
      id,
      tokensUsed: payload.tokensUsed ?? 0,
    }
  }

  const parseTaskSnapshot = (raw: any): AgentTaskSnapshot | null => {
    if (!raw || typeof raw !== 'object') return null
    const title = String(raw.title || '').trim()
    if (!title) return null
    return {
      jobId: String(raw.job_id || ''),
      title,
      status: String(raw.status || ''),
      effectiveStatus: String(raw.effective_status || raw.status || 'idle'),
      runStatus: String(raw.run_status || ''),
      triggerType: String(raw.trigger_type || ''),
      scheduleEnabled: !!raw.schedule_enabled,
      scheduleAt: Number.isFinite(Number(raw.schedule_at)) ? Number(raw.schedule_at) : undefined,
      scheduleLoopEnabled: !!raw.schedule_loop_enabled,
      scheduleDurationMinutes: Math.max(0, Number(raw.schedule_duration_minutes) || 0),
      generationCount: Math.max(1, Number(raw.generation_count) || 1),
      latestGeneration: Math.max(1, Number(raw.latest_generation) || 1),
      taskTokenUsed: Math.max(0, Number(raw.task_token_used) || 0),
      taskTokenLimit: Number(raw.task_token_limit) || 0,
      createdAt: Number.isFinite(Number(raw.created_at)) ? Number(raw.created_at) : undefined,
      updatedAt: Number.isFinite(Number(raw.updated_at)) ? Number(raw.updated_at) : undefined,
      startedAt: Number.isFinite(Number(raw.started_at)) ? Number(raw.started_at) : undefined,
      finishedAt: Number.isFinite(Number(raw.finished_at)) ? Number(raw.finished_at) : undefined,
    }
  }

  const addKnowledge = (title: string, author: string, tags: string[]) => {
    knowledgeBase.value.unshift({
      id: `k-${Date.now()}`,
      title,
      author,
      time: new Date().toLocaleTimeString(),
      tags,
    })
  }

  const loadProjectContext = async () => {
    if (!getAuthToken()) return
    try {
      allFiles.value = await listWorkspaceFiles()
    } catch (err) {
      console.error('Failed to load project context:', err)
    }
  }

  const loadProjects = async () => {
    if (!getAuthToken()) return
    let rows
    try {
      rows = await listProjects()
    } catch {
      return
    }
    projects.value = (Array.isArray(rows) ? rows : []).map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      status: normalizeProjectStatus(row.status),
      aiMemberIds: Array.isArray(row.ai_member_ids)
        ? row.ai_member_ids.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v))
        : [],
    }))
  }

  const loadAIAgents = async () => {
    if (!getAuthToken()) return
    let rows
    try {
      rows = await listAiCards()
    } catch {
      return
    }
    agents.value = (Array.isArray(rows) ? rows : []).map((row: any) => {
      const parsedConfigId = Number(row.id)
      const configId = Number.isFinite(parsedConfigId) ? parsedConfigId : undefined
      const projectId = row.project_id || unassignedProjectId
      const aiRole = (row.ai_role || 'digital_member') as 'assistant_admin' | 'digital_member' | 'admin' | 'worker'
      const digitalMemberRole = (row.digital_member_role === 'manager' ? 'manager' : 'member') as 'manager' | 'member'
      const isCoreMember = digitalMemberRole === 'manager' || row.switch_key === 'assistant_default'
      const uiRole: AgentRole = aiRole === 'assistant_admin' || isCoreMember ? 'admin' : 'worker'
      const defaultTokenLimit = aiRole === 'assistant_admin'
        ? 0
        : (uiRole === 'admin' ? TOKEN_LIMIT_DEFAULTS.admin : TOKEN_LIMIT_DEFAULTS.worker)
      const parsedTokenLimit = Number(row.token_limit)
      const runtimeTool = rememberLatestRuntimeTool(configId, row.latest_mcp_tool || row.runtime_tool || '')
      const taskCurrent = parseTaskSnapshot(row.task_current)
      const taskCurrentOrRecent = parseTaskSnapshot(row.task_current_or_recent)
      const taskRecentCompleted = parseTaskSnapshot(row.task_recent_completed)
      const taskScheduledTasks = Array.isArray(row.task_scheduled_tasks)
        ? row.task_scheduled_tasks.map(parseTaskSnapshot).filter(Boolean) as AgentTaskSnapshot[]
        : []
      if (taskScheduledTasks.length === 0) {
        const fallbackScheduled = taskCurrentOrRecent
          && String(taskCurrentOrRecent.triggerType || '').toLowerCase() === 'schedule'
          && !taskCurrent
          ? taskCurrentOrRecent
          : null
        if (fallbackScheduled) taskScheduledTasks.push(fallbackScheduled)
      }
      const parsedGeneration = Math.max(
        1,
        Number(row.generation) || 1,
        Number(taskCurrent?.latestGeneration) || 1,
        Number(taskCurrentOrRecent?.latestGeneration) || 1,
        Number(taskRecentCompleted?.latestGeneration) || 1,
      )
      return createAgent({
        id: `cfg-${row.id}`,
        name: row.name,
        role: uiRole,
        aiRole,
        digitalMemberRole,
        tokenLimit: Number.isFinite(parsedTokenLimit) ? parsedTokenLimit : defaultTokenLimit,
        generation: parsedGeneration,
        status: normalizeLifecycleStatus(row.lifecycle_status),
        platform: row.platform || 'Server-Core',
        currentTask: row.current_behavior || '等待指令...',
        projectId,
        projectName: getProjectName(projectId, row.project_name),
        parentAiConfigId: Number.isFinite(Number(row.parent_ai_config_id)) ? Number(row.parent_ai_config_id) : null,
        managementScope: row.management_scope || 'self',
        tokensUsed: row.token_used || 0,
        aiConfigId: configId,
        enabled: !!row.enabled,
        mcpEnabled: !!row.mcp_enabled,
        mcpTools: row.mcp_tools || '[]',
        mcpAutoApprove: getMcpAutoApprove(configId),
        botChannel: row.bot_channel === 'qq' ? 'qq' : 'feishu',
        botEnabled: !!row.bot_enabled,
        botStatus: row.bot_status || undefined,
        feishuEnabled: !!row.feishu_enabled,
        feishuWebhookUrl: row.feishu_webhook_url || '',
        feishuAppId: row.feishu_app_id || '',
        feishuDefaultReceiveId: row.feishu_default_receive_id || '',
        feishuDefaultReceiveIdType: row.feishu_default_receive_id_type || 'chat_id',
        feishuStatus: row.feishu_status || undefined,
        qqEnabled: !!row.qq_enabled,
        qqAppId: row.qq_app_id || '',
        qqSandbox: row.qq_sandbox !== false,
        qqDefaultTargetId: row.qq_default_target_id || '',
        qqDefaultTargetType: row.qq_default_target_type || 'c2c',
        qqStatus: row.qq_status || undefined,
        desktopAgentConnected: false,
        desktopAgentId: '',
        desktopAgentName: '',
        desktopAgentPlatform: '',
        desktopAgentCapabilities: [],
        browserAgentConnected: false,
        browserAgentId: '',
        browserAgentName: '',
        browserAgentPlatform: '',
        browserAgentCapabilities: [],
        runtimeStatus: normalizeRuntimeStatus(row.runtime_status),
        runtimeTool,
        activeRunStatus: String(row.active_run_status || ''),
        activeRunPhase: String(row.active_run_phase || 'idle'),
        activeRunSessionId: String(row.active_run_session_id || ''),
        userChatActive: !!row.user_chat_active,
        recentUserChatActive: !!row.recent_user_chat_active,
        recentUserChatAt: Number.isFinite(Number(row.recent_user_chat_at)) ? Number(row.recent_user_chat_at) : undefined,
        model: row.model || '',
        currentTaskTitle: row.current_task_title || '',
        currentTaskStatus: row.current_task_status || 'idle',
        taskCurrent,
        taskCurrentOrRecent,
        taskRecentCompleted,
        taskScheduledTasks,
        latestThinking: row.latest_thinking || '',
      })
    })
    decorateAgentsWithEndpointConnections()
    const maxGeneration = agents.value.reduce((max, agent) => Math.max(max, Number(agent.generation) || 1), 1)
    globalGeneration.value = Math.max(1, maxGeneration)
  }

  const createProject = async (payload: UpsertProjectPayload) => {
    if (!getAuthToken()) return
    try {
      await apiCreateProject(payload)
    } catch (err: any) {
      void alert({ message: err?.message || '项目创建失败', type: 'error' })
      return
    }
    void alert({ message: '项目已创建', type: 'success' })
    await loadProjects()
    await loadAIAgents()
  }

  const updateProject = async (payload: { id: string; data: UpsertProjectPayload }) => {
    if (!getAuthToken()) return
    try {
      await apiUpdateProject(payload.id, payload.data)
    } catch (err: any) {
      void alert({ message: err?.message || '项目更新失败', type: 'error' })
      return
    }
    void alert({ message: '项目已更新', type: 'success' })
    await loadProjects()
    await loadAIAgents()
  }

  const deleteProject = async (projectId: string) => {
    if (!(await confirm({ message: '确认删除该项目？关联 AI 将转为未分配。', type: 'warning' }))) return
    if (!getAuthToken()) return
    try {
      await apiDeleteProject(projectId)
    } catch (err: any) {
      void alert({ message: err?.message || '项目删除失败', type: 'error' })
      return
    }
    void alert({ message: '项目已删除', type: 'success' })
    await loadProjects()
    await loadAIAgents()
  }

  const toggleAiRunByConfigId = async (configId?: number) => {
    if (!configId) return
    if (!getAuthToken()) return
    try {
      await toggleAiRun(configId)
    } catch {
      // best-effort
    }
    await loadAIAgents()
  }

  const applyMcpStatusLive = (payload: McpStatusPayload) => {
    const currentUserId = Number(getCurrentUserId())
    const payloadUserId = Number(payload?.userId)
    if (!Number.isFinite(currentUserId) || !Number.isFinite(payloadUserId) || payloadUserId !== currentUserId) return
    const configId = Number(payload?.aiConfigId)
    if (!Number.isFinite(configId)) return
    const state = normalizeRuntimeStatus(String(payload?.state || '').toLowerCase())
    const tool = rememberLatestRuntimeTool(configId, payload?.tool)
    const target = agents.value.find(agent => Number(agent.aiConfigId) === configId)
    if (!target) return
    target.runtimeStatus = state
    if (tool) target.runtimeTool = tool
  }

  const parseConnectedAiConfigId = (raw: any) => {
    const direct = Number(raw?.aiConfigId ?? raw?.ai_config_id)
    if (Number.isFinite(direct) && direct > 0) return direct
    const id = String(raw?.id || raw?.agentId || '')
    const match = id.match(/^win-desktop-(\d+)$/)
    if (!match) return undefined
    const parsed = Number(match[1])
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  const decorateAgentsWithEndpointConnections = () => {
    const desktopByConfig = new Map<number, ConnectedAgent>()
    const browserByConfig = new Map<number, ConnectedAgent>()
    for (const connected of connectedAgents.value) {
      const configId = Number(connected.aiConfigId)
      if (!Number.isFinite(configId) || configId <= 0) continue
      const platform = String(connected.platform || '').toLowerCase()
      const isDesktop = !!connected.isWindowsDesktop
        || String(connected.id || '').startsWith('win-desktop-')
        || platform.includes('desktop')
      const isBrowser = !!connected.isBrowserExtension
        || platform.includes('browser-extension')
        || platform.includes('browser')
      if (isDesktop) desktopByConfig.set(configId, connected)
      if (isBrowser) browserByConfig.set(configId, connected)
    }
    for (const agent of agents.value) {
      const configId = Number(agent.aiConfigId)
      const desktop = Number.isFinite(configId) ? desktopByConfig.get(configId) : undefined
      const browser = Number.isFinite(configId) ? browserByConfig.get(configId) : undefined
      agent.desktopAgentConnected = !!desktop
      agent.desktopAgentId = desktop?.id || ''
      agent.desktopAgentName = desktop?.name || ''
      agent.desktopAgentPlatform = desktop?.platform || ''
      agent.desktopAgentCapabilities = desktop?.capabilities || []
      agent.browserAgentConnected = !!browser
      agent.browserAgentId = browser?.id || ''
      agent.browserAgentName = browser?.name || ''
      agent.browserAgentPlatform = browser?.platform || ''
      agent.browserAgentCapabilities = browser?.capabilities || []
    }
  }

  const normalizeConnectedAgent = (raw: any): ConnectedAgent => ({
    id: String(raw?.id ?? raw?.socketId ?? ''),
    name: String(raw?.name ?? raw?.id ?? 'agent'),
    platform: raw?.platform ? String(raw.platform) : undefined,
    aiConfigId: parseConnectedAiConfigId(raw),
    isWindowsDesktop: !!raw?.isWindowsDesktop,
    isBrowserExtension: !!raw?.isBrowserExtension,
    capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities.map((c: any) => String(c)) : [],
    version: raw?.version ? String(raw.version) : undefined,
    lifecycle: raw?.lifecycle ? String(raw.lifecycle) : undefined,
    group: raw?.group ? String(raw.group) : undefined,
    workspaceRoot: raw?.workspaceRoot ? String(raw.workspaceRoot) : undefined,
    lastTaskId: raw?.lastTaskId ?? null,
    lastTaskStatus: raw?.lastTaskStatus ?? null,
    lastTaskAt: Number.isFinite(Number(raw?.lastTaskAt)) ? Number(raw.lastTaskAt) : null,
    lastError: raw?.lastError ?? null,
    connectedAt: Number.isFinite(Number(raw?.connectedAt)) ? Number(raw.connectedAt) : undefined,
  })

  const applyConnectedAgents = (rows: any) => {
    connectedAgents.value = (Array.isArray(rows) ? rows : []).map(normalizeConnectedAgent)
    decorateAgentsWithEndpointConnections()
  }

  const loadConnectedAgents = async () => {
    if (!getAuthToken()) return
    try {
      const data = await listConnectedAgents()
      applyConnectedAgents(data?.agents)
    } catch (err) {
      console.error('Failed to load connected agents:', err)
    }
  }

  const disconnectDashboardSocket = () => {
    if (!dashboardSocket) return
    dashboardSocket.off('connect')
    dashboardSocket.off('disconnect')
    dashboardSocket.off('connect_error')
    dashboardSocket.off('mcp:status')
    dashboardSocket.off('agent:list')
    dashboardSocket.disconnect()
    dashboardSocket = null
    dashboardSocketConnected.value = false
  }

  const connectDashboardSocket = (userId: number) => {
    if (!Number.isFinite(userId) || userId <= 0) return
    if (dashboardSocket) return
    dashboardSocket = io('/', { transports: ['websocket', 'polling'] })
    dashboardSocket.on('connect', () => {
      dashboardSocketConnected.value = true
      dashboardSocket?.emit('ui:join', { userId })
      void loadConnectedAgents()
    })
    dashboardSocket.on('disconnect', () => {
      dashboardSocketConnected.value = false
    })
    dashboardSocket.on('connect_error', () => {
      dashboardSocketConnected.value = false
    })
    dashboardSocket.on('mcp:status', (payload: McpStatusPayload) => {
      applyMcpStatusLive(payload)
    })
    dashboardSocket.on('agent:list', (rows: any) => {
      applyConnectedAgents(rows)
    })
    dashboardSocket.on('librarian:proposal_new', () => {
      loadLibrarianPending()
    })
    dashboardSocket.on('librarian:proposal_resolved', () => {
      loadLibrarianPending()
      loadKnowledgeEntries()
    })
  }

  const loadValhallaEntries = async () => {
    const token = getAuthToken()
    if (!token) return
    try {
      const data = await listValhallaEntries(token, { limit: 200 })
      valhallaEntries.value = data.items || []
    } catch {
      // best-effort：英灵殿加载失败不阻塞主面板
    }
  }

  const loadLibrarianPending = async () => {
    const token = getAuthToken()
    if (!token) return
    try {
      const data = await listProposals(token)
      librarianPending.value = data.items || []
    } catch {
      // best-effort
    }
  }

  const formatKnowledgeTime = (ts: number) => {
    if (!ts) return ''
    const date = new Date(ts * 1000)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const scopeLabel = (entry: KnowledgeEntryItem) => {
    if (entry.scope === 'global') return '系统'
    if (entry.scope === 'project') return '业务'
    if (entry.scope === 'ai') return '传承'
    return entry.scope || '知识'
  }

  const loadKnowledgeEntries = async () => {
    const token = getAuthToken()
    if (!token) return
    try {
      const data = await listEntries(token, { status: 'active' })
      knowledgeBase.value = (data.items || []).map(entry => {
        const tags = [
          scopeLabel(entry),
          ...entry.triggers.slice(0, 3),
        ].filter(Boolean)
        return {
          id: entry.memory_id,
          title: entry.title,
          author: entry.source_job_id ? `任务传承 · 第 ${entry.source_generation || 1} 代` : '图书管理员',
          time: formatKnowledgeTime(entry.updated_at || entry.created_at),
          tags: tags.length ? tags : ['知识'],
        }
      })
    } catch {
      // best-effort
    }
  }

  const refreshDashboardLive = async (
    onRefreshOpenTaskPanel: () => Promise<void>,
    options: { force?: boolean } = {},
  ) => {
    if (dashboardRefreshing && !options.force) return
    dashboardRefreshing = true
    try {
      await loadAIAgents()
      await loadConnectedAgents()
      await loadValhallaEntries()
      await loadLibrarianPending()
      await loadKnowledgeEntries()
      await onRefreshOpenTaskPanel()
    } finally {
      dashboardRefreshing = false
    }
  }

  const createSeedData = async () => {
    await loadProjects()
    await loadAIAgents()
    await loadConnectedAgents()
    await loadValhallaEntries()
    await loadLibrarianPending()
    await loadKnowledgeEntries()
    if (knowledgeBase.value.length === 0) {
      knowledgeBase.value = [
        { id: 'k1', title: '学习总结数据库规范 v1.0', author: '主脑·阿尔法', time: '2026-03-01', tags: ['记忆', '规范'] },
        { id: 'k2', title: '多 Agent 端接入与行为准则', author: '主脑·阿尔法', time: '2026-03-05', tags: ['接入', '治理'] },
      ]
    }
  }

  watch(
    () => getCurrentUserId(),
    (value) => {
      disconnectDashboardSocket()
      const userId = Number(value)
      if (Number.isFinite(userId) && userId > 0) connectDashboardSocket(userId)
    },
    { immediate: true }
  )

  onUnmounted(() => {
    disconnectDashboardSocket()
  })

  return {
    agents,
    connectedAgents,
    knowledgeBase,
    projects,
    globalGeneration,
    allFiles,
    dashboardSocketConnected,
    syncChatTokensToAgents,
    loadProjectContext,
    loadProjects,
    loadAIAgents,
    loadValhallaEntries,
    valhallaEntries,
    loadLibrarianPending,
    librarianPending,
    loadKnowledgeEntries,
    loadConnectedAgents,
    createProject,
    updateProject,
    deleteProject,
    toggleAiRunByConfigId,
    addKnowledge,
    createSeedData,
    refreshDashboardLive,
  }
}
