/**
 * Admin panel API client — service monitoring + user management.
 *
 * Every endpoint is gated server-side to owner/admin; the UI additionally
 * hides the entry point for members. Thin wrappers over the shared http
 * client so error parsing / auth header injection stay centralised.
 */
import { del, get, getAuthToken, patch, post, put } from './http'
import type { UserRole } from '@/types'

export type ServiceStatus = 'running' | 'degraded' | 'down' | 'local'

export interface ServiceInfo {
  key: string
  name: string
  status: ServiceStatus
  detail: Record<string, unknown>
  url: string
}

export interface LogLine {
  seq: number
  ts: number
  level: string
  logger: string
  msg: string
}

export interface AdminTask {
  run_id: string
  status: string
  stop_requested: boolean
  user_id: number
  user_name: string | null
  user_account: string | null
  ai_config_id: number | null
  ai_kind: string
  session_id: string
  session_name: string | null
  error_message: string | null
  started_at: number | null
  finished_at: number | null
  heartbeat_at: number | null
  created_at: number
  updated_at: number
}

export interface AdminUser {
  id: number
  name: string
  account: string
  avatar: string | null
  role: UserRole
  role_label: string
  created_at: number | null
}

export interface AuditEntry {
  id: number
  created_at: number
  actor_id: number | null
  actor_account: string
  action: string
  target_type: string
  target_id: string
  target_label: string
  detail: string
}

export interface NewUserPayload {
  name: string
  account: string
  password: string
  role: UserRole
  avatar?: string | null
}

export const listServices = () =>
  get<{ services: ServiceInfo[]; checked_at: number }>('/api/admin/services', {
    fallbackError: '获取服务状态失败',
  })

export const getServiceLogs = (key: string, limit = 200, level?: string) =>
  get<{ key: string; name: string; lines: LogLine[]; note?: string }>(`/api/admin/services/${key}/logs`, {
    query: { limit, level: level || undefined },
    fallbackError: '获取日志失败',
  })

export const listTasks = (limit = 50, status?: string) =>
  get<{ tasks: AdminTask[] }>('/api/admin/tasks', {
    query: { limit, status: status || undefined },
    fallbackError: '获取子任务失败',
  })

export const stopTask = (runId: string) =>
  post<{ ok: boolean; run_id: string; status: string }>(`/api/admin/tasks/${runId}/stop`, undefined, {
    fallbackError: '停止子任务失败',
  })

export const restartService = (key: string) =>
  post<{ ok: boolean; key: string; name: string; restarting: boolean; command?: string[] }>(
    `/api/admin/services/${key}/restart`,
    undefined,
    { fallbackError: '重启服务失败' },
  )

export const listUsers = () =>
  get<{ users: AdminUser[] }>('/api/admin/users', { fallbackError: '获取用户列表失败' })

export const createUser = (payload: NewUserPayload) =>
  post<{ ok: boolean; user: AdminUser }>('/api/admin/users', payload, {
    fallbackError: '创建用户失败',
  })

export const listAudit = (limit = 100) =>
  get<{ entries: AuditEntry[] }>('/api/admin/audit', {
    query: { limit },
    fallbackError: '获取审计日志失败',
  })

// ---- Data folder file manager ----

export type FileKind = 'dir' | 'image' | 'text' | 'binary'

export interface FileEntry {
  name: string
  path: string
  is_dir: boolean
  size: number
  modified: number
  kind: FileKind
}

export interface FileContent {
  path: string
  size: number
  binary: boolean
  too_large: boolean
  content: string
  kind?: FileKind
}

export const listFiles = (path = '') =>
  get<{ path: string; entries: FileEntry[] }>('/api/admin/files', {
    query: { path: path || undefined },
    fallbackError: '获取文件列表失败',
  })

export const readFile = (path: string) =>
  get<FileContent>('/api/admin/files/read', {
    query: { path },
    fallbackError: '读取文件失败',
  })

export const writeFile = (path: string, content: string) =>
  put<{ ok: boolean; path: string; created: boolean }>('/api/admin/files', { path, content }, {
    fallbackError: '保存文件失败',
  })

export const makeDir = (path: string) =>
  post<{ ok: boolean; path: string }>('/api/admin/files/mkdir', { path }, {
    fallbackError: '新建文件夹失败',
  })

export const renameFile = (path: string, newPath: string) =>
  post<{ ok: boolean; path: string }>('/api/admin/files/rename', { path, new_path: newPath }, {
    fallbackError: '重命名失败',
  })

export const deleteFile = (path: string) =>
  del<{ ok: boolean; path: string }>('/api/admin/files', {
    query: { path },
    fallbackError: '删除失败',
  })

export const batchDeleteFiles = (paths: string[]) =>
  post<{ ok: boolean; deleted: string[]; errors: { path: string; error: string }[] }>(
    '/api/admin/files/batch-delete',
    { paths },
    { fallbackError: '批量删除失败' },
  )

/** Raw bytes of a file — authenticated fetch returning a Blob (for image
 *  previews and downloads). Can't use a bare <img src> because the endpoint
 *  needs the Bearer token. */
export const fetchFileBlob = async (path: string): Promise<Blob> => {
  const url = `/api/admin/files/raw?path=${encodeURIComponent(path)}`
  const token = getAuthToken()
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
  if (!res.ok) throw new Error('加载文件失败')
  return res.blob()
}

// ---- Database browser ----

export interface DbColumn {
  name: string
  type: string
  py_type: string
  nullable: boolean
  primary_key: boolean
}

export interface DbTableMeta {
  name: string
  row_count: number
  columns: DbColumn[]
  primary_key: string[]
}

export type DbValue = string | number | boolean | null

export interface DbRowsResult {
  name: string
  rows: Record<string, DbValue>[]
  total: number
  limit: number
  offset: number
  columns: DbColumn[]
  primary_key: string[]
}

export const listDbTables = () =>
  get<{ tables: DbTableMeta[] }>('/api/admin/db/tables', { fallbackError: '获取数据表失败' })

export const listDbRows = (name: string, limit = 50, offset = 0, search = '') =>
  get<DbRowsResult>(`/api/admin/db/tables/${encodeURIComponent(name)}/rows`, {
    query: { limit, offset, search: search || undefined },
    fallbackError: '获取表数据失败',
  })

export const insertDbRow = (name: string, values: Record<string, DbValue>) =>
  post<{ ok: boolean; primary_key: Record<string, DbValue> }>(
    `/api/admin/db/tables/${encodeURIComponent(name)}/rows`,
    { values },
    { fallbackError: '插入失败' },
  )

export const updateDbRow = (name: string, pk: Record<string, DbValue>, values: Record<string, DbValue>) =>
  patch<{ ok: boolean; updated: number }>(
    `/api/admin/db/tables/${encodeURIComponent(name)}/rows`,
    { pk, values },
    { fallbackError: '更新失败' },
  )

export const deleteDbRow = (name: string, pk: Record<string, DbValue>) =>
  post<{ ok: boolean; deleted: number }>(
    `/api/admin/db/tables/${encodeURIComponent(name)}/rows/delete`,
    { pk },
    { fallbackError: '删除失败' },
  )

// ---- Database cleanup (destructive maintenance) ----

/** Category keys understood by the cleanup endpoint (see admin router). */
export type DbCleanupCategory =
  | 'conversations'
  | 'tasks'
  | 'ai_messages'
  | 'knowledge'
  | 'projects'
  | 'valhalla'

export interface DbCleanupPayload {
  account: string
  password: string
  categories: DbCleanupCategory[]
  drop_unused_tables: boolean
}

export interface DbCleanupResult {
  ok: boolean
  cleared: Record<string, number>
  dropped_tables: string[]
  total_deleted: number
}

export const cleanupDatabase = (payload: DbCleanupPayload) =>
  post<DbCleanupResult>('/api/admin/db/cleanup', payload, {
    fallbackError: '清理数据库失败',
  })

export const setUserRole = (userId: number, role: UserRole) =>
  patch<{ ok: boolean; user: AdminUser }>(`/api/admin/users/${userId}/role`, { role }, {
    fallbackError: '设置权限失败',
  })

export const resetUserPassword = (userId: number, newPassword: string) =>
  post<{ ok: boolean; user_id: number }>(`/api/admin/users/${userId}/reset-password`, {
    new_password: newPassword,
  }, { fallbackError: '重置密码失败' })

export const deleteUser = (userId: number) =>
  del<{ ok: boolean; user_id: number }>(`/api/admin/users/${userId}`, {
    fallbackError: '删除用户失败',
  })
