// Application entry point. Owns the Electron lifecycle and stitches together
// the smaller modules (windows, tray, agent runtime, IPC). Keep this file
// short — each piece of real logic lives in its own module.

import { app, Menu } from 'electron'
import { store } from './store'
import { initCapture } from './capture-bridge'
import { createMainWindow, getMainWindow } from './windows/main-window'
import { createTray, updateTray } from './windows/tray'
import { showOfflineChatWindow } from './windows/offline-chat-window'
import {
  initAgent, getAgent, clearAiSelectionIfLoggedOut, isAgentActive,
} from './services/agent-runtime'
import { bindActivityLogTarget } from './services/activity-log'
import { registerAllIpc } from './ipc'

app.setName('HeySure Agent')
if (process.platform === 'win32') {
  app.setAppUserModelId('com.heysure.agent.win')
  app.commandLine.appendSwitch('force-renderer-accessibility', 'complete')
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  ;(app as any).isQuitting = true
  app.quit()
}

app.on('second-instance', () => {
  const w = getMainWindow()
  if (!w) return
  if (w.isMinimized()) w.restore()
  w.show()
  w.focus()
})

async function bootstrap(): Promise<void> {
  if (process.platform === 'win32') {
    app.setAccessibilitySupportEnabled(true)
  }

  initCapture()

  clearAiSelectionIfLoggedOut()
  initAgent(store.store)

  registerAllIpc()
  Menu.setApplicationMenu(null)

  const mainWindow = createMainWindow()
  bindActivityLogTarget(mainWindow)

  createTray({
    onToggleConnection: () => {
      const agent = getAgent()
      if (isAgentActive()) agent?.disconnect()
      else agent?.connect()
    },
    onShowPanel: () => {
      const w = getMainWindow()
      if (w?.isVisible()) w.hide()
      else { w?.show(); w?.focus() }
    },
    isActive: isAgentActive,
  })
  updateTray(getAgent()?.status || 'disconnected')

  // Auto-connect as soon as the user is logged in. The AI assignment is now
  // controlled server-side (Workshop panel), so we no longer gate on a locally
  // selected AI member.
  if (store.get('offlineMode')) {
    showOfflineChatWindow()
  } else if (store.get('authToken')) {
    getAgent()?.connect()
  }
}

if (hasSingleInstanceLock) {
  app.whenReady().then(bootstrap)
}

// Keep running in tray when all windows are closed
app.on('window-all-closed', (e: Event) => { e.preventDefault() })

app.on('before-quit', () => {
  ;(app as any).isQuitting = true
  getAgent()?.disconnect()
})

app.on('activate', () => { getMainWindow()?.show() })
