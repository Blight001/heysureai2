export type AgentRole = 'admin' | 'worker'
export type AgentStatus = 'learning' | 'working' | 'reproducing' | 'dead'

export interface AgentTaskSnapshot {
  jobId: string
  title: string
  status: string
  effectiveStatus: string
  runStatus: string
  triggerType: string
  scheduleEnabled?: boolean
  scheduleAt?: number
  scheduleLoopEnabled?: boolean
  scheduleDurationMinutes?: number
  generationCount: number
  latestGeneration: number
  taskTokenUsed: number
  taskTokenLimit: number
  createdAt?: number
  updatedAt?: number
  startedAt?: number
  finishedAt?: number
}

export interface Agent {
  id: string
  name: string
  role: AgentRole
  aiRole?: 'assistant_admin' | 'digital_member' | 'admin' | 'worker'
  digitalMemberRole?: 'manager' | 'member'
  tokensUsed: number
  tokenLimit: number
  generation: number
  status: AgentStatus
  platform: string
  currentTask?: string
  summary?: string
  specialty?: string
  projectId?: string
  projectName?: string
  parentAiConfigId?: number | null
  managementScope?: string
  aiConfigId?: number
  enabled?: boolean
  mcpEnabled?: boolean
  mcpTools?: string
  mcpAutoApprove?: boolean
  botChannel?: 'feishu' | 'qq'
  botEnabled?: boolean
  botStatus?: {
    status?: string
    mode?: string
    label?: string
    message?: string
  }
  feishuEnabled?: boolean
  feishuWebhookUrl?: string
  feishuAppId?: string
  feishuDefaultReceiveId?: string
  feishuDefaultReceiveIdType?: string
  feishuStatus?: {
    status?: string
    mode?: string
    label?: string
    message?: string
  }
  qqEnabled?: boolean
  qqAppId?: string
  qqSandbox?: boolean
  qqDefaultTargetId?: string
  qqDefaultTargetType?: string
  qqStatus?: {
    status?: string
    mode?: string
    label?: string
    message?: string
  }
  desktopAgentConnected?: boolean
  desktopAgentId?: string
  desktopAgentName?: string
  desktopAgentPlatform?: string
  desktopAgentCapabilities?: string[]
  browserAgentConnected?: boolean
  browserAgentId?: string
  browserAgentName?: string
  browserAgentPlatform?: string
  browserAgentCapabilities?: string[]
  runtimeStatus?: string
  runtimeTool?: string
  activeRunStatus?: string
  activeRunPhase?: string
  activeRunSessionId?: string
  userChatActive?: boolean
  recentUserChatActive?: boolean
  recentUserChatAt?: number
  model?: string
  currentTaskTitle?: string
  currentTaskStatus?: string
  taskCurrent?: AgentTaskSnapshot | null
  taskCurrentOrRecent?: AgentTaskSnapshot | null
  taskRecentCompleted?: AgentTaskSnapshot | null
  taskScheduledTasks?: AgentTaskSnapshot[]
  latestThinking?: string
}

export interface KnowledgeItem {
  id: string
  title: string
  author: string
  time: string
  tags: string[]
}

export interface ProjectItem {
  id: string
  name: string
  description: string
  status: 'running' | 'ended'
  aiMemberIds: number[]
  readonly?: boolean
}
