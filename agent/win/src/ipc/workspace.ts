import { ipcMain } from 'electron'
import { store } from '../store'
import { requireAuth, serverFetch } from '../services/server-client'

export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:files', async () => {
    const { base, token } = requireAuth(store.store)
    const data = await serverFetch<any>(base, '/api/chat/files', {
      token, failureMessage: '工作区目录加载失败',
    })
    return Array.isArray(data) ? data : []
  })
}
