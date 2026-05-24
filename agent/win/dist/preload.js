"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
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
        electron_1.ipcRenderer.on('agent:status-changed', (_, status, reason) => cb(status, reason));
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
    // Theme
    setTheme: (theme) => electron_1.ipcRenderer.invoke('theme:set', theme),
    // Connection test
    testConnection: () => electron_1.ipcRenderer.invoke('connection:test'),
    // AI chat
    sendChat: (content) => electron_1.ipcRenderer.invoke('chat:send', content),
    getChatHistory: () => electron_1.ipcRenderer.invoke('chat:history'),
    // Auth
    login: (params) => electron_1.ipcRenderer.invoke('auth:login', params),
    logout: () => electron_1.ipcRenderer.invoke('auth:logout'),
    // AI Config
    listAiConfigs: () => electron_1.ipcRenderer.invoke('ai-config:list'),
    getAiRuntimeStatus: () => electron_1.ipcRenderer.invoke('ai-config:runtime-status'),
    selectAiConfig: (cfg) => electron_1.ipcRenderer.invoke('ai-config:select', cfg),
    cloneAiConfig: (configId) => electron_1.ipcRenderer.invoke('ai-config:clone', configId),
    listTasks: () => electron_1.ipcRenderer.invoke('task:list'),
    getTaskGenerations: (jobId) => electron_1.ipcRenderer.invoke('task:generations', jobId),
    triggerTask: (payload) => electron_1.ipcRenderer.invoke('task:trigger', payload),
    pauseTask: (jobId) => electron_1.ipcRenderer.invoke('task:pause', jobId),
    resumeTask: (jobId) => electron_1.ipcRenderer.invoke('task:resume', jobId),
    deleteTask: (jobId) => electron_1.ipcRenderer.invoke('task:delete', jobId),
    listWorkspaceFiles: () => electron_1.ipcRenderer.invoke('workspace:files'),
    // Version
    version: process.env.npm_package_version || '1.0.0',
});
