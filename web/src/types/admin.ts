import type { UserRole } from './user'

export type AdminModalTab =
  | 'services'
  | 'users'
  | 'auth'
  | 'files'
  | 'database'
  | 'audit'
  | 'diagnostics'
  | 'update'

export interface AdminStatusMeta {
  label: string
  cls: string
}

export interface AdminRoleOption {
  value: UserRole
  label: string
}

export interface AdminMcpParamRow {
  name: string
  type: string
  required: boolean
  description: string
}
