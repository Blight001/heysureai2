import { get, post, put } from './http'

export interface ConnectedDeviceRow {
  id?: string
  socketId?: string
  deviceId?: string
  name?: string
  platform?: string
  aiConfigId?: number
  ai_config_id?: number
  isWindowsDesktop?: boolean
  isBrowserExtension?: boolean
  isAndroid?: boolean
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

export const listConnectedDevices = () =>
  get<{ agents?: ConnectedDeviceRow[] }>('/api/devices/connected', {
    fallbackError: '连接 Agent 列表加载失败',
  })

// Assign (or clear, when aiConfigId is null) the server-side AI for a connected
// device. The server persists the binding and broadcasts an updated device:list.
export const assignDeviceAi = (deviceId: string, aiConfigId: number | null) =>
  post<{ ok: boolean; deviceId: string; aiConfigId: number | null }>(
    '/api/devices/bind',
    { deviceId, aiConfigId },
    { fallbackError: '分配 AI 失败' },
  )

export interface DeviceMcpScope {
  deviceId: string
  agentName?: string
  deviceType?: 'desktop' | 'browser' | 'android' | 'workshop' | 'toolbox' | null
  platform?: string
  aiConfigId?: number | null
  capabilities: string[]
  toolDefs?: Record<string, {
    description?: string
    input_schema?: Record<string, any>
    destructive?: boolean
  }>
  allowed: string[]
  hasRecord: boolean
}

// Endpoint (desktop / browser / workshop / toolbox) MCP permission scope for a connected agent.
// Visible only while the device is online; persisted per (AI, agent type) so a
// reconnecting agent of the same type keeps its scope.
export const getDeviceMcpScope = (deviceId: string) =>
  get<DeviceMcpScope>(`/api/devices/${encodeURIComponent(deviceId)}/mcp-scope`, {
    fallbackError: 'Agent MCP 权限加载失败',
  })

export const setDeviceMcpScope = (deviceId: string, tools: string[]) =>
  put<DeviceMcpScope>(
    `/api/devices/${encodeURIComponent(deviceId)}/mcp-scope`,
    { tools },
    { fallbackError: 'Agent MCP 权限保存失败' },
  )
