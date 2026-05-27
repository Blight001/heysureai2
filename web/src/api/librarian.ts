import { get, post } from './http'

export interface KnowledgeEntryItem {
  memory_id: string
  title: string
  triggers: string[]
  scope: string
  scope_target: string | null
  status: 'pending' | 'active' | 'archived' | 'rejected'
  confidence: number
  use_count: number
  last_used_at?: number | null
  file_path: string
  summary: string
  source_job_id?: string | null
  source_generation?: number | null
  source_ai_config_id?: number | null
  source_message_id?: number | null
  created_at: number
  updated_at: number
  body?: string
  intrinsic_properties?: {
    description: string
    total: number
    categories: Array<{
      namespace: string
      count: number
      tools: Array<{
        name: string
        description: string
        inputSchema?: Record<string, any>
        parameters?: Array<{
          name: string
          type: string
          required: boolean
          description: string
        }>
        destructive?: boolean
        source?: 'server' | 'endpoint'
      }>
    }>
  }
  intrinsic_personas?: {
    description: string
    total: number
    agents: Array<{
      id: number | null
      name: string
      description: string
      role: string
      digital_member_role: string
      is_librarian: boolean
      enabled: boolean
      model: string
      platform: string
      generation: number
      prompt: string
      system_auto_control_raw?: string
      auto_control_enabled?: boolean
      auto_prompts: Array<{
        key: string
        label: string
        content: string
      }>
      updated_at: number
    }>
  }
  system_prompts?: {
    description: string
    total: number
    sections: Array<{
      key: string
      title: string
      count: number
      items: Array<{
        key: string
        label: string
        type: 'text' | 'number'
        content: string
      }>
    }>
  }
}

export const listProposals = (token: string) =>
  get<{ items: KnowledgeEntryItem[]; total: number }>('/api/librarian/proposals', {
    token,
    fallbackError: '待审批清单加载失败',
  })

export const approveProposal = (token: string, memoryId: string, editedContent?: string) =>
  post<{ approved: boolean; entry: KnowledgeEntryItem }>(
    `/api/librarian/proposals/${encodeURIComponent(memoryId)}/approve`,
    editedContent != null ? { edited_content: editedContent } : {},
    { token, fallbackError: '审批失败' },
  )

export const rejectProposal = (token: string, memoryId: string, reason?: string) =>
  post<{ rejected: boolean; entry: KnowledgeEntryItem }>(
    `/api/librarian/proposals/${encodeURIComponent(memoryId)}/reject`,
    reason ? { reason } : {},
    { token, fallbackError: '驳回失败' },
  )

export const listEntries = (
  token: string,
  opts: { scope?: string; status?: 'pending' | 'active' | 'archived' | 'rejected' | 'all' } = {},
) =>
  get<{ items: KnowledgeEntryItem[]; total: number }>('/api/librarian/entries', {
    token,
    query: opts,
    fallbackError: '知识库加载失败',
  })

export const readEntry = (token: string, memoryId: string) =>
  get<KnowledgeEntryItem>(`/api/librarian/entries/${encodeURIComponent(memoryId)}`, {
    token,
    fallbackError: '条目加载失败',
  })

export const saveIntrinsicProperties = (
  token: string,
  tools: Array<{
    name: string
    description: string
    parameters?: Array<{ name: string; description: string }>
  }>,
) =>
  post<KnowledgeEntryItem>(
    '/api/librarian/intrinsic-properties',
    { tools },
    { token, fallbackError: '固有属性保存失败' },
  )

export const saveSystemPrompts = (
  token: string,
  prompts: Array<{ key: string; content: string | number }>,
) =>
  post<KnowledgeEntryItem>(
    '/api/librarian/system-prompts',
    { prompts },
    { token, fallbackError: '固有思路保存失败' },
  )
