import { del, get } from './http'

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

export const listValhallaEntries = (
  token: string,
  opts: { ai_config_id?: number; job_id?: string; limit?: number } = {},
) =>
  get<{ items: ValhallaEntry[]; total: number }>('/api/valhalla/entries', {
    token,
    query: opts,
    fallbackError: '英灵殿条目加载失败',
  })

export const readValhallaEntry = (token: string, entryId: number) =>
  get<ValhallaEntryDetail>(`/api/valhalla/entries/${entryId}`, {
    token,
    fallbackError: '英灵殿遗言加载失败',
  })

export const deleteValhallaEntries = (token: string, entryIds: number[]) =>
  del<{ deleted: number; missing: number[]; deleted_ids: number[] }>('/api/valhalla/entries', {
    token,
    query: { entry_ids: entryIds.join(',') },
    fallbackError: '英灵殿条目删除失败',
  })
