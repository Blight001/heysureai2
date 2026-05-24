// IPC registration entry point. Each module registers its own ipcMain
// handlers, keeping wire-protocol concerns close to the business logic.

import { registerSettingsIpc } from './settings'
import { registerAgentIpc } from './agent'
import { registerAuthIpc } from './auth'
import { registerAiConfigIpc } from './ai-config'
import { registerTaskIpc } from './task'
import { registerChatIpc } from './chat'
import { registerWorkspaceIpc } from './workspace'

export function registerAllIpc(): void {
  registerSettingsIpc()
  registerAgentIpc()
  registerAuthIpc()
  registerAiConfigIpc()
  registerTaskIpc()
  registerChatIpc()
  registerWorkspaceIpc()
}
