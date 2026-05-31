"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAiConfigIpc = registerAiConfigIpc;
const electron_1 = require("electron");
const store_1 = require("../store");
const server_client_1 = require("../services/server-client");
const agent_runtime_1 = require("../services/agent-runtime");
function registerAiConfigIpc() {
    electron_1.ipcMain.handle('ai-config:list', async () => {
        const { base, token } = (0, server_client_1.requireAuth)(store_1.store.store);
        return (0, server_client_1.serverFetch)(base, '/api/ai/configs', { token, failureMessage: '获取 AI 列表失败' });
    });
    electron_1.ipcMain.handle('ai-config:runtime-status', async () => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            return [];
        try {
            const { base, token } = (0, server_client_1.requireAuth)(s);
            return await (0, server_client_1.serverFetch)(base, '/api/ai/runtime-status', { token, failureMessage: '运行状态查询失败' });
        }
        catch {
            return [];
        }
    });
    electron_1.ipcMain.handle('ai-config:select', async (_event, cfg) => {
        if (!store_1.store.get('authToken')) {
            (0, agent_runtime_1.clearSelectedAiConfig)();
            (0, agent_runtime_1.getAgent)()?.updateSettings(store_1.store.store);
            throw new Error('请先登录后再选择 AI 成员');
        }
        if (!cfg?.id)
            throw new Error('AI 成员无效');
        store_1.store.set('selectedAiConfigId', cfg.id);
        store_1.store.set('selectedAiConfigName', cfg.name);
        store_1.store.set('selectedAiConfigRole', cfg.digital_member_role || 'member');
        store_1.store.set('selectedAiConfigLifecycle', cfg.lifecycle_status || 'working');
        store_1.store.set('selectedAiConfigProject', cfg.project_name || '');
        store_1.store.set('agentToken', store_1.store.get('authToken'));
        store_1.store.set('agentId', `win-desktop-${cfg.id}`);
        store_1.store.set('agentName', 'Windows Agent');
        store_1.store.set('agentGroup', cfg.project_name || '');
        const agent = (0, agent_runtime_1.rebuildAgent)(store_1.store.store);
        agent.connect();
        return { success: true };
    });
    electron_1.ipcMain.handle('ai-config:clone', async (_event, configId) => {
        const { base, token } = (0, server_client_1.requireAuth)(store_1.store.store);
        return (0, server_client_1.serverFetch)(base, `/api/ai/configs/${configId}/clone`, {
            method: 'POST', token, failureMessage: '克隆失败',
        });
    });
}
