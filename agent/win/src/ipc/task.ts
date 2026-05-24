import { ipcMain } from 'electron'
import { store } from '../store'
import {
  requireAuthWithAi, serverFetch,
} from '../services/server-client'

async function taskJobAction(jobId: string, action: 'pause' | 'resume', fallback: string) {
  if (!jobId) throw new Error('任务 ID 不能为空')
  const { base, token, aiConfigId } = requireAuthWithAi(store.store)
  return serverFetch(
    base,
    `/api/ai/configs/${aiConfigId}/task-jobs/${encodeURIComponent(jobId)}/${action}`,
    { method: 'POST', token, failureMessage: fallback },
  )
}

export function registerTaskIpc(): void {
  ipcMain.handle('task:list', async () => {
    const { base, token, aiConfigId } = requireAuthWithAi(store.store)
    const [taskData, jobData] = await Promise.all([
      serverFetch<any>(base, `/api/ai/configs/${aiConfigId}/task-list`, {
        token, failureMessage: '任务列表加载失败',
      }),
      serverFetch<any>(base, `/api/ai/configs/${aiConfigId}/task-jobs`, {
        token, failureMessage: '任务执行记录加载失败',
      }),
    ])
    return {
      tasks: Array.isArray(taskData?.tasks) ? taskData.tasks : [],
      jobs: Array.isArray(jobData?.jobs) ? jobData.jobs : [],
    }
  })

  ipcMain.handle('task:generations', async (_event, jobId: string) => {
    if (!jobId) throw new Error('任务 ID 不能为空')
    const { base, token, aiConfigId } = requireAuthWithAi(store.store)
    const data = await serverFetch<any>(
      base,
      `/api/ai/configs/${aiConfigId}/task-jobs/${encodeURIComponent(jobId)}/generations`,
      { token, failureMessage: '任务详情加载失败' },
    )
    return Array.isArray(data?.generations) ? data.generations : []
  })

  ipcMain.handle('task:trigger', async (_event, payload: any) => {
    const { base, token, aiConfigId } = requireAuthWithAi(store.store)
    return serverFetch(base, `/api/ai/configs/${aiConfigId}/task-trigger`, {
      method: 'POST', token, body: payload || {}, failureMessage: '创建任务失败',
    })
  })

  ipcMain.handle('task:pause',  async (_event, jobId: string) => taskJobAction(jobId, 'pause', '暂停任务失败'))
  ipcMain.handle('task:resume', async (_event, jobId: string) => taskJobAction(jobId, 'resume', '恢复任务失败'))

  ipcMain.handle('task:delete', async (_event, jobId: string) => {
    if (!jobId) throw new Error('任务 ID 不能为空')
    const { base, token, aiConfigId } = requireAuthWithAi(store.store)
    await serverFetch(base, `/api/ai/configs/${aiConfigId}/task-jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE', token, failureMessage: '删除任务失败',
    })
    return { success: true }
  })
}
