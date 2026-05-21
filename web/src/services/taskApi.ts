import type {
  AITaskGenerationItem,
  AITaskJobItem,
  AITaskListItem,
} from '../utils/taskSystem'

const authHeaders = (token: string, withJson: boolean = false) => {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

const parseApiError = async (res: Response, fallback: string) => {
  const err = await res.json().catch(() => ({}))
  return String((err as any).detail || fallback)
}

async function requestJson<T>(
  url: string,
  token: string,
  init: RequestInit = {},
  fallbackError: string = '请求失败',
): Promise<T> {
  const headers = {
    ...authHeaders(token),
    ...(init.headers || {}),
  }
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) {
    throw new Error(await parseApiError(res, fallbackError))
  }
  return await res.json() as T
}

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
    requestJson<{ tasks?: AITaskListItem[] }>(
      `/api/ai/configs/${configId}/task-list`,
      token,
      {},
      '任务列表加载失败',
    ),
    requestJson<{ jobs?: AITaskJobItem[] }>(
      `/api/ai/configs/${configId}/task-jobs`,
      token,
      {},
      '任务执行记录加载失败',
    ),
  ])
  return {
    tasks: Array.isArray(taskData.tasks) ? taskData.tasks : [],
    jobs: Array.isArray(jobsData.jobs) ? jobsData.jobs : [],
  }
}

export const fetchTaskGenerationItems = async (configId: number, jobId: string, token: string) => {
  const data = await requestJson<{ generations?: AITaskGenerationItem[] }>(
    `/api/ai/configs/${configId}/task-jobs/${jobId}/generations`,
    token,
    {},
    '任务代际详情加载失败',
  )
  return Array.isArray(data.generations) ? data.generations : []
}

export const triggerTaskForAgent = async (configId: number, payload: TriggerTaskPayload, token: string) => {
  return await requestJson<{ job_id?: string; title?: string }>(
    `/api/ai/configs/${configId}/task-trigger`,
    token,
    {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify(payload),
    },
    '创建任务失败',
  )
}

export const pauseTaskJobById = async (configId: number, jobId: string, token: string) => {
  await requestJson(
    `/api/ai/configs/${configId}/task-jobs/${jobId}/pause`,
    token,
    { method: 'POST' },
    '暂停任务失败',
  )
}

export const resumeTaskJobById = async (configId: number, jobId: string, token: string) => {
  await requestJson(
    `/api/ai/configs/${configId}/task-jobs/${jobId}/resume`,
    token,
    { method: 'POST' },
    '开始任务失败',
  )
}

export const deleteTaskJobById = async (configId: number, jobId: string, token: string) => {
  await requestJson(
    `/api/ai/configs/${configId}/task-jobs/${jobId}`,
    token,
    { method: 'DELETE' },
    '删除任务失败',
  )
}

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
