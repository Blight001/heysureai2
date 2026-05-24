import { del, get, post, put } from './http'

export interface ProjectRow {
  id: string
  name: string
  description?: string
  status?: string
  ai_member_ids?: number[]
}

export interface UpsertProjectPayload {
  name: string
  description: string
  status: 'running' | 'ended'
  ai_member_ids: number[]
}

export const listProjects = () =>
  get<ProjectRow[]>('/api/projects', { fallbackError: '项目列表加载失败' })

export const createProject = (payload: UpsertProjectPayload) =>
  post<ProjectRow>('/api/projects', payload, { fallbackError: '项目创建失败' })

export const updateProject = (projectId: string, payload: UpsertProjectPayload) =>
  put<ProjectRow>(`/api/projects/${projectId}`, payload, { fallbackError: '项目更新失败' })

export const deleteProject = (projectId: string) =>
  del<void>(`/api/projects/${projectId}`, { fallbackError: '项目删除失败' })
