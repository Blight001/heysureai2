import { get, post } from './http'

export interface ConnectedAgentRow {
  id?: string
  socketId?: string
  agentId?: string
  name?: string
  platform?: string
  aiConfigId?: number
  ai_config_id?: number
  isWindowsDesktop?: boolean
  isBrowserExtension?: boolean
  capabilities?: any[]
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

export const listConnectedAgents = () =>
  get<{ agents?: ConnectedAgentRow[] }>('/api/agents/connected', {
    fallbackError: '连接 Agent 列表加载失败',
  })

// Assign (or clear, when aiConfigId is null) the server-side AI for a connected
// device. The server persists the binding and broadcasts an updated agent:list.
export const assignAgentAi = (agentId: string, aiConfigId: number | null) =>
  post<{ ok: boolean; agentId: string; aiConfigId: number | null }>(
    '/api/agents/bind',
    { agentId, aiConfigId },
    { fallbackError: '分配 AI 失败' },
  )
