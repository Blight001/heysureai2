export interface User {
  id: number
  name: string
  account: string
  avatar?: string
  ui_theme_mode?: 'light' | 'dark'
  ui_font_size?: 'sm' | 'md' | 'lg'
}

export type AgentRole = 'admin' | 'worker'
export type AgentStatus = 'learning' | 'working' | 'reproducing' | 'dead'

export interface AgentTaskSnapshot {
  jobId: string
  title: string
  status: string
  effectiveStatus: string
  runStatus: string
  triggerType: string
  generationCount: number
  latestGeneration: number
  taskTokenUsed: number
  taskTokenLimit: number
  createdAt?: number
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
  taskCurrentOrRecent?: AgentTaskSnapshot | null
  taskRecentCompleted?: AgentTaskSnapshot | null
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

export interface TaskItem {
  id: string
  title: string
  role: AgentRole
  projectId: string
  specialty?: string
  status: 'queued' | 'running' | 'done'
}

export interface McpStatusPayload {
  userId?: number
  aiConfigId?: number
  state?: string
  tool?: string
  updatedAt?: number
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, any>
  destructive?: boolean
  zhLabel?: string
  zhDescription?: string
  zhTags?: string[]
}

export interface McpToolParamRow {
  name: string
  type: string
  required: boolean
  description: string
}
