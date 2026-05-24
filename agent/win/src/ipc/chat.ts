import { ipcMain } from 'electron'
import { store } from '../store'
import { getChatHistory, sendChatMessage } from '../services/chat-session'

export function registerChatIpc(): void {
  ipcMain.handle('chat:history', async () => getChatHistory(store.store))
  ipcMain.handle('chat:send', async (_event, content: string) =>
    sendChatMessage(store.store, String(content || '')),
  )
}
