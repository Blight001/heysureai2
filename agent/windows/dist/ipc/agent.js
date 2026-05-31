"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAgentIpc = registerAgentIpc;
const electron_1 = require("electron");
const store_1 = require("../store");
const agent_runtime_1 = require("../services/agent-runtime");
const activity_log_1 = require("../services/activity-log");
const server_client_1 = require("../services/server-client");
function registerAgentIpc() {
    electron_1.ipcMain.handle('agent:connect', () => {
        if (!store_1.store.get('authToken')) {
            if ((0, agent_runtime_1.clearAiSelectionIfLoggedOut)()) {
                (0, agent_runtime_1.getAgent)()?.updateSettings(store_1.store.store);
            }
            (0, activity_log_1.sendActivityLog)('system', 'warn', '请先登录并选择 AI 成员后再连接软件端 Agent');
            return false;
        }
        (0, agent_runtime_1.getAgent)()?.connect();
        return true;
    });
    electron_1.ipcMain.handle('agent:disconnect', () => {
        (0, agent_runtime_1.getAgent)()?.disconnect();
        return true;
    });
    electron_1.ipcMain.handle('agent:status', () => (0, agent_runtime_1.getAgent)()?.status || 'disconnected');
    electron_1.ipcMain.handle('connection:test', async () => {
        const raw = String(store_1.store.get('serverUrl') || '');
        return (0, server_client_1.pingServer)(raw);
    });
}
