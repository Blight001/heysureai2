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
  onStatusChange: (cb: (status: string, reason?: string, aiConfigId?: number | null) => void) => {
    ipcRenderer.on('agent:status-changed', (_, status, reason, aiConfigId) => cb(status, reason, aiConfigId))
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
  onAuthExpired: (cb: (reason: string) => void) => {
    ipcRenderer.on('auth:expired', (_, reason) => cb(reason))
  },
  // Theme
  setTheme: (theme: 'dark' | 'light') => ipcRenderer.invoke('theme:set', theme),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  // Connection test
  testConnection: () => ipcRenderer.invoke('connection:test'),
  // Auth
  login: (params: { serverUrl: string; account: string; password: string }) =>
    ipcRenderer.invoke('auth:login', params),
  logout: () => ipcRenderer.invoke('auth:logout'),
  // AI Config
  listAiConfigs: () => ipcRenderer.invoke('ai-config:list'),
  getAiRuntimeStatus: () => ipcRenderer.invoke('ai-config:runtime-status'),
  selectAiConfig: (cfg: any) => ipcRenderer.invoke('ai-config:select', cfg),
  cloneAiConfig: (configId: number) => ipcRenderer.invoke('ai-config:clone', configId),
  // MCP tool page
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpSaveDesc: (payload: { tool: string; description?: string; parameters?: Record<string, string> }) =>
    ipcRenderer.invoke('mcp:save-desc', payload),
  mcpTest: (payload: { tool: string; args: Record<string, any> }) => ipcRenderer.invoke('mcp:test', payload),
  // Version
  version: process.env.npm_package_version || '1.0.0',
})
