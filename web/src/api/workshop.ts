import { get, post } from './http'

// 服务端内置图书馆 Agent 的专用绑定管理。
// 当前工具集为空，绑定关系保留给后续 MCP 能力使用。
// 工坊与 AI 为 1:1 —— 只能绑定一个 AI 数字成员，绑定新成员会替换旧绑定。

export interface WorkshopAgentItem {
  device_id: string
  name: string
  online: boolean
  tools: string[]
  /** 是否绑定到查询的 AI */
  bound: boolean
  /** 当前绑定的成员（1:1，可能是其它 AI），null = 未绑定 */
  bound_ai_config_id: number | null
  bound_ai_name: string
  /** 工具箱：多绑、默认自动绑定全部 AI（图书馆则为 1:1）。 */
  is_toolbox?: boolean
  multi?: boolean
}

export const fetchWorkshopBindings = (aiConfigId: number) =>
  get<{ ai_config_id: number; agents: WorkshopAgentItem[] }>(
    `/api/workshop/bindings?ai_config_id=${aiConfigId}`,
    { fallbackError: '图书馆列表加载失败' },
  )

export const setWorkshopBinding = (aiConfigId: number, deviceId: string, bound: boolean) =>
  post<{
    ai_config_id: number
    device_id: string
    bound: boolean
    replaced_ai_config_id: number | null
    replaced_ai_name: string
  }>(
    '/api/workshop/bindings',
    { ai_config_id: aiConfigId, device_id: deviceId, bound },
    { fallbackError: '更新图书馆绑定失败' },
  )
