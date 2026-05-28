import { del, get, post, put } from './http'

/**
 * `/api/ai/cards` returns the dashboard "agent card" projection — heavy on
 * runtime fields the dashboard renders directly. We keep the row as a loose
 * record because the backend may add fields we want to surface without a
 * coordinated frontend bump.
 */
export type AiCardRow = Record<string, any>

export type AiConfigRow = Record<string, any>

export type QqDiagnoseRow = Record<string, any>

export interface AiConfigUpsertPayload {
  name: string
  description?: string
  ai_role: 'assistant_admin' | 'digital_member'
  digital_member_role: 'manager' | 'member'
  platform: string
  token_limit: number
  workspace_root: string | null
  model?: string
  model_preset_id?: string
  prompt?: string
  mcp_tools: string
  bot_channel: 'feishu' | 'qq'
  feishu_enabled: boolean
  feishu_webhook_url?: string
  feishu_app_id?: string
  feishu_app_secret?: string
  feishu_verification_token?: string
  feishu_default_receive_id?: string
  feishu_default_receive_id_type?: string
  qq_enabled?: boolean
  qq_app_id?: string
  qq_app_secret?: string
  qq_sandbox?: boolean
  qq_default_target_id?: string
  system_auto_control: string
}

export const listAiCards = () =>
  get<AiCardRow[]>('/api/ai/cards', { fallbackError: 'AI 列表加载失败' })

export const listAiConfigs = () =>
  get<AiConfigRow[]>('/api/ai/configs', { fallbackError: 'AI 配置加载失败' })

export const createAiConfig = (payload: AiConfigUpsertPayload) =>
  post<AiConfigRow>('/api/ai/configs', payload, { fallbackError: 'AI 创建失败' })

export const updateAiConfig = (configId: number, payload: AiConfigUpsertPayload) =>
  put<AiConfigRow>(`/api/ai/configs/${configId}`, payload, { fallbackError: 'AI 更新失败' })

export const updateAiConfigFields = (configId: number, payload: Partial<AiConfigUpsertPayload> & Record<string, any>) =>
  put<AiConfigRow>(`/api/ai/configs/${configId}`, payload, { fallbackError: 'AI 更新失败' })

export const deleteAiConfig = (configId: number) =>
  del<void>(`/api/ai/configs/${configId}`, { fallbackError: 'AI 删除失败' })

export const toggleAiRun = (configId: number) =>
  post<void>(`/api/ai/configs/${configId}/toggle-run`, undefined, {
    fallbackError: 'AI 启停切换失败',
  })

export const diagnoseQqBot = (configId: number) =>
  get<QqDiagnoseRow>(`/api/qq/diagnose/${configId}`, {
    fallbackError: 'QQ 诊断失败',
  })

export const sendQqBotTest = (configId: number, payload: Record<string, any> = {}) =>
  post<QqDiagnoseRow>(`/api/qq/diagnose/${configId}/send-test`, payload, {
    fallbackError: 'QQ 测试发送失败',
  })
