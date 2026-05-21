import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('heysureAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  // Agent control
  connect: () => ipcRenderer.invoke('agent:connect'),
  disconnect: () => ipcRenderer.invoke('agent:disconnect'),
  getStatus: () => ipcRenderer.invoke('agent:status'),
  // Events from main to renderer
  onStatusChange: (cb: (status: string, reason?: string) => void) => {
    ipcRenderer.on('agent:status-changed', (_, status, reason) => cb(status, reason))
  },
  onActivityLog: (cb: (entry: any) => void) => {
    ipcRenderer.on('activity:log', (_, entry) => cb(entry))
  },
  onTaskStart: (cb: (data: any) => void) => {
    ipcRenderer.on('task:start', (_, data) => cb(data))
  },
  onTaskResult: (cb: (data: any) => void) => {
    ipcRenderer.on('task:result', (_, data) => cb(data))
  },
  // Theme
  setTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('theme:set', theme),
  // Connection test
  testConnection: () => ipcRenderer.invoke('connection:test'),
  // AI chat
  sendChat: (messages: any[]) => ipcRenderer.invoke('chat:send', messages),
  // Version
  version: process.env.npm_package_version || '1.0.0',
})
