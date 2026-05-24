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

export const archiveEntry = (token: string, memoryId: string) =>
  post<{ archived: boolean; entry: KnowledgeEntryItem }>(
    `/api/librarian/entries/${encodeURIComponent(memoryId)}/archive`,
    {},
    { token, fallbackError: '归档失败' },
  )
