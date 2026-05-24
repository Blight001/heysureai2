import { ipcMain } from 'electron'
import { store } from '../store'
import { resolveBaseUrl, serverFetch } from '../services/server-client'
import {
  getAgent, clearSelectedAiConfig,
} from '../services/agent-runtime'

export function registerAuthIpc(): void {
  ipcMain.handle('auth:login', async (_event, params: { serverUrl: string; account: string; password: string }) => {
    const { serverUrl, account, password } = params
    if (!serverUrl) throw new Error('服务器 URL 不能为空')

    let base: string
    try { base = resolveBaseUrl(serverUrl) } catch { throw new Error('服务器 URL 格式无效') }

    const data = await serverFetch<any>(base, '/api/auth/login', {
      method: 'POST',
      body: { account, password },
      failureMessage: '登录失败',
    })

    store.set('serverUrl', base)
    store.set('authToken', data.access_token)
    store.set('userAccount', account)
    store.set('userId', data.user?.id ?? null)
    clearSelectedAiConfig()
    getAgent()?.updateSettings(store.store)
    return { success: true, user: data.user }
  })

  ipcMain.handle('auth:logout', () => {
    getAgent()?.disconnect()
    store.set('authToken', '')
    store.set('userAccount', '')
    store.set('userId', null)
    clearSelectedAiConfig()
    return { success: true }
  })
}
