import { ipcMain } from 'electron'
import { store } from '../store'
import {
  getAgent, clearAiSelectionIfLoggedOut,
} from '../services/agent-runtime'
import { sendActivityLog } from '../services/activity-log'
import { pingServer } from '../services/server-client'

export function registerAgentIpc(): void {
  ipcMain.handle('agent:connect', () => {
    if (!store.get('authToken')) {
      if (clearAiSelectionIfLoggedOut()) {
        getAgent()?.updateSettings(store.store)
      }
      sendActivityLog('system', 'warn', '请先登录并选择 AI 成员后再连接软件端 Agent')
      return false
    }
    getAgent()?.connect()
    return true
  })

  ipcMain.handle('agent:disconnect', () => {
    getAgent()?.disconnect()
    return true
  })

  ipcMain.handle('agent:status', () => getAgent()?.status || 'disconnected')

  ipcMain.handle('connection:test', async () => {
    const raw = String(store.get('serverUrl') || '')
    return pingServer(raw)
  })
}
