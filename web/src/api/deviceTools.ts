import { get, post, del } from './http'

export type DeviceToolType = 'desktop' | 'browser'

// One instruction of the dynamic MCP program (call / set / return).
export interface DynamicToolStep {
  op: 'call' | 'set' | 'return'
  tool?: string
  args?: Record<string, unknown>
  name?: string
  value?: unknown
  save_as?: string
}

export interface DynamicToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
  code: DynamicToolStep[]
}

export interface DeviceDynamicTool extends DynamicToolDefinition {
  enabled: boolean
  revision: string
  updated_at: number
}

export interface DeviceToolsResponse {
  deviceType: DeviceToolType
  tools: DeviceDynamicTool[]
  // Tools a live device of this type currently advertises — offered as call targets.
  availableTools: { name: string; description: string }[]
}

export const listDeviceTools = (deviceType: DeviceToolType) =>
  get<DeviceToolsResponse>('/api/device-tools', {
    query: { device_type: deviceType },
    fallbackError: '设备动态 MCP 工具加载失败',
  })

export const upsertDeviceTool = (
  deviceType: DeviceToolType,
  definition: DynamicToolDefinition,
  enabled = true,
) =>
  post<{ tool: DeviceDynamicTool; pushedToDevices: number }>(
    '/api/device-tools',
    { device_type: deviceType, definition, enabled },
    { fallbackError: '保存动态 MCP 工具失败' },
  )

export const toggleDeviceTool = (deviceType: DeviceToolType, name: string, enabled: boolean) =>
  post<{ tool: DeviceDynamicTool; pushedToDevices: number }>(
    '/api/device-tools/toggle',
    { device_type: deviceType, name, enabled },
    { fallbackError: '切换动态 MCP 工具失败' },
  )

export const deleteDeviceTool = (deviceType: DeviceToolType, name: string) =>
  del<{ ok: boolean; pushedToDevices: number }>(
    `/api/device-tools/${encodeURIComponent(name)}`,
    { query: { device_type: deviceType }, fallbackError: '删除动态 MCP 工具失败' },
  )
