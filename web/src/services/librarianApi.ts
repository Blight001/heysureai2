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

const authHeaders = (token: string, withJson: boolean = false): HeadersInit => {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (withJson) h['Content-Type'] = 'application/json'
  return h
}

const handle = async <T,>(res: Response, fallback: string): Promise<T> => {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(String((err as any).detail || fallback))
  }
  return (await res.json()) as T
}

export const listProposals = async (token: string): Promise<{ items: KnowledgeEntryItem[]; total: number }> => {
  const res = await fetch('/api/librarian/proposals', { headers: authHeaders(token) })
  return handle(res, '待审批清单加载失败')
}

export const approveProposal = async (
  token: string,
  memoryId: string,
  editedContent?: string,
): Promise<{ approved: boolean; entry: KnowledgeEntryItem }> => {
  const res = await fetch(`/api/librarian/proposals/${encodeURIComponent(memoryId)}/approve`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify(editedContent != null ? { edited_content: editedContent } : {}),
  })
  return handle(res, '审批失败')
}

export const rejectProposal = async (
  token: string,
  memoryId: string,
  reason?: string,
): Promise<{ rejected: boolean; entry: KnowledgeEntryItem }> => {
  const res = await fetch(`/api/librarian/proposals/${encodeURIComponent(memoryId)}/reject`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify(reason ? { reason } : {}),
  })
  return handle(res, '驳回失败')
}

export const listEntries = async (
  token: string,
  opts: { scope?: string; status?: 'pending' | 'active' | 'archived' | 'rejected' | 'all' } = {},
): Promise<{ items: KnowledgeEntryItem[]; total: number }> => {
  const qs = new URLSearchParams()
  if (opts.scope) qs.set('scope', opts.scope)
  if (opts.status) qs.set('status', opts.status)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await fetch(`/api/librarian/entries${suffix}`, { headers: authHeaders(token) })
  return handle(res, '知识库加载失败')
}

export const readEntry = async (token: string, memoryId: string): Promise<KnowledgeEntryItem> => {
  const res = await fetch(`/api/librarian/entries/${encodeURIComponent(memoryId)}`, { headers: authHeaders(token) })
  return handle(res, '条目加载失败')
}

export const archiveEntry = async (
  token: string,
  memoryId: string,
): Promise<{ archived: boolean; entry: KnowledgeEntryItem }> => {
  const res = await fetch(`/api/librarian/entries/${encodeURIComponent(memoryId)}/archive`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({}),
  })
  return handle(res, '归档失败')
}
