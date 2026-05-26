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
      auto_prompts: Array<{
        key: string
        label: string
        content: string
      }>
      updated_at: number
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
