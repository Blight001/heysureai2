import { get, post } from './http'

export interface McpEndpointToolEntry {
  name: string
  mcpSource: 'desktop' | 'browser'
}

export interface McpToolsResponse {
  tools?: any[]
  endpointTools?: McpEndpointToolEntry[]
  endpointToolDefs?: any[]
  promptTools?: any[]
  promptToolsScope?: 'current_ai' | 'all_current'
  promptToolsAiConfigId?: number | null
  promptToolsMcpEnabled?: boolean
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

export const listMcpTools = (options: { aiConfigId?: number } = {}) =>
  get<McpToolsResponse>('/api/mcp/tools', {
    query: { ai_config_id: options.aiConfigId },
    fallbackError: 'MCP 工具列表加载失败',
  })

export const callMcpTool = <T = any>(payload: McpCallPayload) =>
  post<T>('/api/mcp/call', payload, { fallbackError: 'MCP 调用失败' })

export interface InheritanceMcpTestPayload {
  model_preset_id: string
  tool: string
  device_id: string
  device_type?: string
  description?: string
  parameters?: Array<{
    name: string
    type: string
    required: boolean
    description: string
  }>
  input_schema?: Record<string, unknown>
  implementation?: Record<string, unknown>
  user_hint?: string
}

export interface InheritanceMcpTestResult {
  ok: boolean
  model_preset?: {
    id: string
    name: string
    model: string
  }
  model_reply?: string
  tool_call?: {
    tool: string
    arguments: Record<string, unknown>
  } | null
  tool_result?: Record<string, unknown> | null
  detail?: string
}

export const runInheritanceMcpTest = (payload: InheritanceMcpTestPayload) =>
  post<InheritanceMcpTestResult>('/api/mcp/inheritance-test', payload, {
    fallbackError: 'MCP 传承测试失败',
  })
