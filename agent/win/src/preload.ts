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
  sendChat: (content: string) => ipcRenderer.invoke('chat:send', content),
  getChatHistory: () => ipcRenderer.invoke('chat:history'),
  // Auth
  login: (params: { serverUrl: string; account: string; password: string }) =>
    ipcRenderer.invoke('auth:login', params),
  logout: () => ipcRenderer.invoke('auth:logout'),
  // AI Config
  listAiConfigs: () => ipcRenderer.invoke('ai-config:list'),
  getAiRuntimeStatus: () => ipcRenderer.invoke('ai-config:runtime-status'),
  selectAiConfig: (cfg: any) => ipcRenderer.invoke('ai-config:select', cfg),
  cloneAiConfig: (configId: number) => ipcRenderer.invoke('ai-config:clone', configId),
  listTasks: () => ipcRenderer.invoke('task:list'),
  getTaskGenerations: (jobId: string) => ipcRenderer.invoke('task:generations', jobId),
  triggerTask: (payload: any) => ipcRenderer.invoke('task:trigger', payload),
  pauseTask: (jobId: string) => ipcRenderer.invoke('task:pause', jobId),
  resumeTask: (jobId: string) => ipcRenderer.invoke('task:resume', jobId),
  deleteTask: (jobId: string) => ipcRenderer.invoke('task:delete', jobId),
  listWorkspaceFiles: () => ipcRenderer.invoke('workspace:files'),
  // Version
  version: process.env.npm_package_version || '1.0.0',
})
