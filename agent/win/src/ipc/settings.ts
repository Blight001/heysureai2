import { ipcMain } from 'electron'
import { store, AgentSettings } from '../store'
import { getAgent, clearAiSelectionIfLoggedOut } from '../services/agent-runtime'
import { sendActivityLog } from '../services/activity-log'
import { setMainWindowTheme } from '../windows/main-window'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => {
    clearAiSelectionIfLoggedOut()
    return store.store
  })

  ipcMain.handle('settings:save', (_event, newSettings: Partial<AgentSettings>) => {
    Object.entries(newSettings).forEach(([k, v]) => store.set(k as any, v as any))
    if (clearAiSelectionIfLoggedOut()) {
      sendActivityLog('system', 'warn', '未登录，已取消 AI 成员自动注册选择')
    }
    getAgent()?.updateSettings(store.store)
    return store.store
  })

  ipcMain.handle('theme:set', (_event, theme: 'dark' | 'light') => {
    store.set('theme', theme)
    setMainWindowTheme(theme)
    return true
  })
}
