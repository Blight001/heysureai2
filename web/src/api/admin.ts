/**
 * Admin panel API client — service monitoring + user management.
 *
 * Every endpoint is gated server-side to owner/admin; the UI additionally
 * hides the entry point for members. Thin wrappers over the shared http
 * client so error parsing / auth header injection stay centralised.
 */
import { del, get, patch, post } from './http'
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
