import { get, post } from './http'

export interface McpEndpointToolEntry {
  name: string
  mcpSource: 'desktop' | 'browser'
}

export interface McpToolsResponse {
  tools?: any[]
  endpointTools?: McpEndpointToolEntry[]
  roleOrder?: string[]
  roleLabels?: Record<string, string>
  roleDefaults?: Record<string, string[]>
  roleOptions?: Record<string, string[]>
  rolePermissions?: Record<string, string[]>
}

export interface McpCallPayload {
  tool: string
  arguments: Record<string, unknown>
  ai_config_id?: number
}

export const listMcpTools = () =>
  get<McpToolsResponse>('/api/mcp/tools', { fallbackError: 'MCP 工具列表加载失败' })

export const callMcpTool = <T = any>(payload: McpCallPayload) =>
  post<T>('/api/mcp/call', payload, { fallbackError: 'MCP 调用失败' })
