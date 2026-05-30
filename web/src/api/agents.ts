import { get, post, put } from './http'

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

export interface AgentMcpScope {
  agentId: string
  agentName?: string
  agentType?: 'desktop' | 'browser' | null
  platform?: string
  aiConfigId?: number | null
  capabilities: string[]
  allowed: string[]
  hasRecord: boolean
}

// Endpoint (desktop / browser) MCP permission scope for a connected agent.
// Visible only while the device is online; persisted per (AI, agent type) so a
// reconnecting agent of the same type keeps its scope.
export const getAgentMcpScope = (agentId: string) =>
  get<AgentMcpScope>(`/api/agents/${encodeURIComponent(agentId)}/mcp-scope`, {
    fallbackError: 'Agent MCP 权限加载失败',
  })

export const setAgentMcpScope = (agentId: string, tools: string[]) =>
  put<AgentMcpScope>(
    `/api/agents/${encodeURIComponent(agentId)}/mcp-scope`,
    { tools },
    { fallbackError: 'Agent MCP 权限保存失败' },
  )
