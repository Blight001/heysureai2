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
  // 'js' (desktop): server-stored JS run on the device with (args, cap, ctx).
  // 'program' (browser): the call/set/return DSL.
  code_kind?: 'js' | 'program'
  code?: DynamicToolStep[]
  js?: string
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

export interface DeviceToolVersion {
  version_id: number
  name: string
  revision: string
  action: 'upsert' | 'delete' | 'restore'
  actor: 'web' | 'ai'
  ai_config_id: number | null
  description: string
  code_kind: 'js' | 'program'
  created_at: number
}

export const listDeviceToolVersions = (deviceType: DeviceToolType, name: string) =>
  get<{ deviceType: DeviceToolType; name: string; versions: DeviceToolVersion[] }>(
    '/api/device-tools/versions',
    { query: { device_type: deviceType, name }, fallbackError: '历史版本加载失败' },
  )

export const restoreDeviceToolVersion = (deviceType: DeviceToolType, versionId: number) =>
  post<{ tool: DeviceDynamicTool; pushedToDevices: number }>(
    '/api/device-tools/restore',
    { device_type: deviceType, version_id: versionId },
    { fallbackError: '回滚失败' },
  )

export interface DeviceToolStat {
  tool: string
  total: number
  failures: number
  failure_rate: number
  last_called_at: number
  last_failure_at: number
  last_error: string
}

export interface DeviceToolFailure {
  tool: string
  error: string
  ai_config_id: number | null
  session_id: string
  run_id: string
  message_id: number | null
  created_at: number
}

export const listDeviceToolStats = (deviceType: DeviceToolType) =>
  get<{ deviceType: DeviceToolType; stats: DeviceToolStat[] }>(
    '/api/device-tools/stats',
    { query: { device_type: deviceType }, fallbackError: '调用统计加载失败' },
  )

export const listDeviceToolFailures = (name: string) =>
  get<{ name: string; failures: DeviceToolFailure[] }>(
    '/api/device-tools/failures',
    { query: { name }, fallbackError: '失败记录加载失败' },
  )
