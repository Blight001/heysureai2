import { get } from './http'

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
