"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
function cleanIpcError(err) {
    const message = String(err?.message || err || '');
    const cleaned = message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '');
    return new Error(cleaned || message || '请求失败');
}
electron_1.contextBridge.exposeInMainWorld('heysureAPI', {
    // Settings
    getSettings: () => electron_1.ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke('settings:save', settings),
    // Agent control
    connect: () => electron_1.ipcRenderer.invoke('agent:connect'),
    disconnect: () => electron_1.ipcRenderer.invoke('agent:disconnect'),
    getStatus: () => electron_1.ipcRenderer.invoke('agent:status'),
    // Events from main to renderer
    onStatusChange: (cb) => {
        electron_1.ipcRenderer.on('agent:status-changed', (_, status, reason, aiConfigId) => cb(status, reason, aiConfigId));
    },
    onActivityLog: (cb) => {
        electron_1.ipcRenderer.on('activity:log', (_, entry) => cb(entry));
    },
    onTaskStart: (cb) => {
        electron_1.ipcRenderer.on('task:start', (_, data) => cb(data));
    },
    onTaskResult: (cb) => {
        electron_1.ipcRenderer.on('task:result', (_, data) => cb(data));
    },
    onAuthExpired: (cb) => {
        electron_1.ipcRenderer.on('auth:expired', (_, reason) => cb(reason));
    },
    onAuthRefreshed: (cb) => {
        electron_1.ipcRenderer.on('auth:refreshed', () => cb());
    },
    onReconnecting: (cb) => {
        electron_1.ipcRenderer.on('agent:reconnecting', (_, active, reason) => cb(active, reason));
    },
    // Theme
    setTheme: (theme) => electron_1.ipcRenderer.invoke('theme:set', theme),
    minimizeWindow: () => electron_1.ipcRenderer.invoke('window:minimize'),
    toggleMaximizeWindow: () => electron_1.ipcRenderer.invoke('window:toggle-maximize'),
    closeWindow: () => electron_1.ipcRenderer.invoke('window:close'),
    isWindowMaximized: () => electron_1.ipcRenderer.invoke('window:is-maximized'),
    // Connection test
    testConnection: () => electron_1.ipcRenderer.invoke('connection:test'),
    // Auth
    login: (params) => electron_1.ipcRenderer.invoke('auth:login', params),
    logout: () => electron_1.ipcRenderer.invoke('auth:logout'),
    // AI Config
    listAiConfigs: () => electron_1.ipcRenderer.invoke('ai-config:list'),
    getAiRuntimeStatus: () => electron_1.ipcRenderer.invoke('ai-config:runtime-status'),
    selectAiConfig: (cfg) => electron_1.ipcRenderer.invoke('ai-config:select', cfg),
    cloneAiConfig: (configId) => electron_1.ipcRenderer.invoke('ai-config:clone', configId),
    // MCP tool page
    mcpList: () => electron_1.ipcRenderer.invoke('mcp:list'),
    mcpSaveDesc: (payload) => electron_1.ipcRenderer.invoke('mcp:save-desc', payload),
    mcpSetEnabled: (payload) => electron_1.ipcRenderer.invoke('mcp:set-enabled', payload),
    mcpTest: (payload) => electron_1.ipcRenderer.invoke('mcp:test', payload),
    // Local chat window (IPC names kept for compatibility with the existing bundle)
    openOfflineChat: () => electron_1.ipcRenderer.invoke('offline-chat:open'),
    getOfflineChatConfig: () => electron_1.ipcRenderer.invoke('offline-chat:get-config'),
    saveOfflinePrompt: (prompt) => electron_1.ipcRenderer.invoke('offline-chat:save-prompt', prompt),
    sendOfflineChat: (payload) => electron_1.ipcRenderer.invoke('offline-chat:send', payload).catch((err) => { throw cleanIpcError(err); }),
    cancelOfflineChat: (payload) => electron_1.ipcRenderer.invoke('offline-chat:cancel', payload),
    onOfflineChatProgress: (cb) => {
        const handler = (_, event) => cb(event);
        electron_1.ipcRenderer.on('offline-chat:progress', handler);
        return () => electron_1.ipcRenderer.removeListener('offline-chat:progress', handler);
    },
    // Version
    version: process.env.npm_package_version || '1.0.0',
});
