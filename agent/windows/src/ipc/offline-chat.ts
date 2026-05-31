import { ipcMain } from 'electron'
import { store } from '../store'
import { showOfflineChatWindow } from '../windows/offline-chat-window'
import { runOfflineChat, OfflineChatMessage } from '../services/offline-ai'

export function registerOfflineChatIpc(): void {
  ipcMain.handle('offline-chat:open', () => {
    showOfflineChatWindow()
    return true
  })

  ipcMain.handle('offline-chat:get-config', () => ({
    offlineMode: !!store.get('offlineMode'),
    prompt: store.get('offlinePrompt') || '',
    aiBaseUrl: store.get('aiBaseUrl') || '',
    aiModel: store.get('aiModel') || '',
    hasAiKey: !!store.get('aiKey'),
  }))

  ipcMain.handle('offline-chat:save-prompt', (_e, prompt: string) => {
    store.set('offlinePrompt', String(prompt || '').trim())
    return true
  })

  ipcMain.handle('offline-chat:send', async (event, payload: { requestId?: string; messages: OfflineChatMessage[]; prompt?: string; allowedTools?: string[] }) => {
    if (!store.get('offlineMode')) throw new Error('离线模式未启用')
    const messages = Array.isArray(payload?.messages) ? payload.messages : []
    const allowedTools = Array.isArray(payload?.allowedTools) ? payload.allowedTools : undefined
    const requestId = String(payload?.requestId || '')
    return runOfflineChat(messages, payload?.prompt, allowedTools, progress => {
      event.sender.send('offline-chat:progress', { requestId, ...progress })
    })
  })
}
