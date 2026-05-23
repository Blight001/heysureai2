export interface ValhallaEntry {
  id: number
  user_id: number
  ai_config_id: number
  ai_name: string
  job_id: string
  job_title: string
  generation: number
  kind: 'inherit' | 'complete' | 'aborted'
  session_id: string | null
  file_path: string
  summary_excerpt: string
  token_used: number
  token_limit: number
  artifacts_count: number
  unfinished_count: number
  reason: string | null
  created_at: number
}

export interface ValhallaEntryDetail {
  entry: ValhallaEntry
  content: string
  sidecars: {
    'unfinished.json'?: { items: string[] }
    'artifacts.json'?: { items: Array<{ tool: string; path: string; args_preview: string; message_id?: number; created_at?: number }> }
    'token_report.json'?: { token_used: number; token_limit: number; message_count: number }
  }
}

const authHeaders = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
})

const handle = async <T,>(res: Response, fallback: string): Promise<T> => {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(String((err as any).detail || fallback))
  }
  return (await res.json()) as T
}

export const listValhallaEntries = async (
  token: string,
  opts: { ai_config_id?: number; job_id?: string; limit?: number } = {},
): Promise<{ items: ValhallaEntry[]; total: number }> => {
  const qs = new URLSearchParams()
  if (opts.ai_config_id != null) qs.set('ai_config_id', String(opts.ai_config_id))
  if (opts.job_id) qs.set('job_id', opts.job_id)
  if (opts.limit != null) qs.set('limit', String(opts.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await fetch(`/api/valhalla/entries${suffix}`, { headers: authHeaders(token) })
  return handle<{ items: ValhallaEntry[]; total: number }>(res, '英灵殿条目加载失败')
}

export const readValhallaEntry = async (
  token: string,
  entryId: number,
): Promise<ValhallaEntryDetail> => {
  const res = await fetch(`/api/valhalla/entries/${entryId}`, { headers: authHeaders(token) })
  return handle<ValhallaEntryDetail>(res, '英灵殿遗言加载失败')
}
