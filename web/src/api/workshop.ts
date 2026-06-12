import { get, post } from './http'

// 知识与进化工坊（agent/workshop/）：AI 侧绑定管理。
// 绑定是 AI 调用 librarian.* / evolution.* 工具的唯一门槛。

export interface WorkshopAgentItem {
  agent_id: string
  name: string
  online: boolean
  tools: string[]
  bound: boolean
  bound_ai_count: number
}

export const fetchWorkshopBindings = (aiConfigId: number) =>
  get<{ ai_config_id: number; agents: WorkshopAgentItem[] }>(
    `/api/workshop/bindings?ai_config_id=${aiConfigId}`,
    { fallbackError: '知识工坊列表加载失败' },
  )

export const setWorkshopBinding = (aiConfigId: number, agentId: string, bound: boolean) =>
  post<{ ai_config_id: number; agent_id: string; bound: boolean }>(
    '/api/workshop/bindings',
    { ai_config_id: aiConfigId, agent_id: agentId, bound },
    { fallbackError: '更新知识工坊绑定失败' },
  )
