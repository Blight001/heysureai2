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
    sendChat: (messages) => electron_1.ipcRenderer.invoke('chat:send', messages),
    // Version
    version: process.env.npm_package_version || '1.0.0',
});
