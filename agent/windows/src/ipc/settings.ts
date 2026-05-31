import { ipcMain } from 'electron'
import { store, AgentSettings } from '../store'
import { getAgent, clearAiSelectionIfLoggedOut } from '../services/agent-runtime'
import { sendActivityLog } from '../services/activity-log'
import {
  setMainWindowTheme,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  closeMainWindow,
  isMainWindowMaximized,
} from '../windows/main-window'
import { resolveBaseUrl, serverFetch, ServerError } from '../services/server-client'
import { cacheUserAvatar } from '../services/avatar-cache'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', async () => {
    clearAiSelectionIfLoggedOut()
    const s = store.store
    if (s.serverUrl && s.authToken) {
      try {
        const base = resolveBaseUrl(s.serverUrl)
        const me = await serverFetch<any>(base, '/api/auth/me', {
          token: s.authToken,
          failureMessage: '登录状态校验失败',
          timeoutMs: 5000,
        })
        // Keep the cached avatar in sync if it changed server-side (mirrors the
        // browser extension's getMe refresh); re-fetch the image only as needed.
        const freshAvatar = me && typeof me === 'object' ? String(me.avatar || '') : s.userAvatar
        if (freshAvatar !== s.userAvatar) {
          store.set('userAvatar', freshAvatar)
          await cacheUserAvatar(base, freshAvatar)
        } else if (s.userAvatar && !s.userAvatarDataUrl) {
          await cacheUserAvatar(base, s.userAvatar)
        }
      } catch (err) {
        if (!(err instanceof ServerError && err.status === 401)) {
          // Network/server errors should not log the user out. They are handled
          // by the feature call that needs the server connection.
        }
      }
    }
    return store.store
  })

  ipcMain.handle('settings:save', (_event, newSettings: Partial<AgentSettings>) => {
    Object.entries(newSettings).forEach(([k, v]) => store.set(k as any, v as any))
    if (clearAiSelectionIfLoggedOut()) {
      sendActivityLog('system', 'warn', '未登录，已取消 AI 成员自动注册选择')
    }
    getAgent()?.updateSettings(store.store)
    if (store.get('offlineMode')) getAgent()?.disconnect()
    return store.store
  })

  ipcMain.handle('theme:set', (_event, theme: 'dark' | 'light') => {
    store.set('theme', theme)
    setMainWindowTheme(theme)
    return true
  })

  ipcMain.handle('window:minimize', () => {
    minimizeMainWindow()
    return true
  })

  ipcMain.handle('window:toggle-maximize', () => {
    return toggleMaximizeMainWindow()
  })

  ipcMain.handle('window:close', () => {
    closeMainWindow()
    return true
  })

  ipcMain.handle('window:is-maximized', () => {
    return isMainWindowMaximized()
  })
}
