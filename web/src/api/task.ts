import { del, get, patch, post } from './http'
import type {
  AITaskGenerationItem,
  AITaskJobItem,
  AITaskListItem,
} from '@/utils/taskSystem'

export interface TriggerTaskPayload {
  title: string
  instruction: string
  priority: number
  schedule_enabled: boolean
  schedule_loop_enabled: boolean
  schedule_run_immediately: boolean
  schedule_duration_minutes: number
  schedule_at: number | string | null
  override_token_limit_enabled: boolean
  token_limit_override: number
  override_mcp_tools_enabled: boolean
  mcp_tools_override: string[]
  override_workspace_root_enabled: boolean
  workspace_root_override: string
}

export const fetchTaskListAndJobs = async (configId: number, token: string) => {
  const [taskData, jobsData] = await Promise.all([
    get<{ tasks?: AITaskListItem[] }>(`/api/ai/configs/${configId}/task-list`, {
      token,
      fallbackError: '任务列表加载失败',
    }),
    get<{ jobs?: AITaskJobItem[] }>(`/api/ai/configs/${configId}/task-jobs`, {
      token,
      fallbackError: '任务执行记录加载失败',
    }),
  ])
  return {
    tasks: Array.isArray(taskData.tasks) ? taskData.tasks : [],
    jobs: Array.isArray(jobsData.jobs) ? jobsData.jobs : [],
  }
}

export const fetchTaskGenerationItems = async (configId: number, jobId: string, token: string) => {
  const data = await get<{ generations?: AITaskGenerationItem[] }>(
    `/api/ai/configs/${configId}/task-jobs/${jobId}/generations`,
    { token, fallbackError: '任务代际详情加载失败' },
  )
  return Array.isArray(data.generations) ? data.generations : []
}

export const triggerTaskForAgent = (configId: number, payload: TriggerTaskPayload, token: string) =>
  post<{ job_id?: string; title?: string }>(
    `/api/ai/configs/${configId}/task-trigger`,
    payload,
    { token, fallbackError: '创建任务失败' },
  )

export type UpdateTaskJobPayload = Partial<Pick<
  TriggerTaskPayload,
  'title' | 'instruction' | 'priority' | 'schedule_enabled' | 'schedule_loop_enabled' | 'schedule_run_immediately' | 'schedule_duration_minutes' | 'schedule_at'
>> & {
  status?: 'queued' | 'paused'
  mode?: 'immediate' | 'scheduled' | 'recurring'
}

export const updateTaskJobById = (configId: number, jobId: string, payload: UpdateTaskJobPayload, token: string) =>
  patch(`/api/ai/configs/${configId}/task-jobs/${jobId}`, payload, {
    token,
    fallbackError: '编辑任务失败',
  })

export const pauseTaskJobById = (configId: number, jobId: string, token: string) =>
  post(`/api/ai/configs/${configId}/task-jobs/${jobId}/pause`, undefined, {
    token,
    fallbackError: '暂停任务失败',
  })

export const resumeTaskJobById = (configId: number, jobId: string, token: string) =>
  post(`/api/ai/configs/${configId}/task-jobs/${jobId}/resume`, undefined, {
    token,
    fallbackError: '开始任务失败',
  })

export const deleteTaskJobById = (configId: number, jobId: string, token: string) =>
  del(`/api/ai/configs/${configId}/task-jobs/${jobId}`, {
    token,
    fallbackError: '删除任务失败',
  })

export const batchDeleteTaskJobsById = async (configId: number, jobIds: string[], token: string) => {
  let successCount = 0
  let failCount = 0
  for (const jobId of jobIds) {
    try {
      await deleteTaskJobById(configId, jobId, token)
      successCount += 1
    } catch {
      failCount += 1
    }
  }
  return { successCount, failCount }
}
