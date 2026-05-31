import { store } from '../store'
import { clearSelectedAiConfig, getAgent, rebuildAgent } from './agent-runtime'
import { sendActivityLog } from './activity-log'
import { getMainWindow } from '../windows/main-window'

export function clearStoredAuthSession(reason = '登录已过期，请重新登录'): void {
  const hadAuth = !!store.get('authToken')

  getAgent()?.disconnect()
  store.set('authToken', '')
  store.set('userAccount', '')
  store.set('userName', '')
  store.set('userAvatar', '')
  store.set('userAvatarDataUrl', '')
  store.set('userId', null)
  clearSelectedAiConfig()
  rebuildAgent(store.store)

  if (hadAuth) {
    sendActivityLog('system', 'warn', reason)
    getMainWindow()?.webContents.send('auth:expired', reason)
  }
}
