"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTaskIpc = registerTaskIpc;
const electron_1 = require("electron");
const store_1 = require("../store");
const server_client_1 = require("../services/server-client");
async function taskJobAction(jobId, action, fallback) {
    if (!jobId)
        throw new Error('任务 ID 不能为空');
    const { base, token, aiConfigId } = (0, server_client_1.requireAuthWithAi)(store_1.store.store);
    return (0, server_client_1.serverFetch)(base, `/api/ai/configs/${aiConfigId}/task-jobs/${encodeURIComponent(jobId)}/${action}`, { method: 'POST', token, failureMessage: fallback });
}
function registerTaskIpc() {
    electron_1.ipcMain.handle('task:list', async () => {
        const { base, token, aiConfigId } = (0, server_client_1.requireAuthWithAi)(store_1.store.store);
        const [taskData, jobData] = await Promise.all([
            (0, server_client_1.serverFetch)(base, `/api/ai/configs/${aiConfigId}/task-list`, {
                token, failureMessage: '任务列表加载失败',
            }),
            (0, server_client_1.serverFetch)(base, `/api/ai/configs/${aiConfigId}/task-jobs`, {
                token, failureMessage: '任务执行记录加载失败',
            }),
        ]);
        return {
            tasks: Array.isArray(taskData?.tasks) ? taskData.tasks : [],
            jobs: Array.isArray(jobData?.jobs) ? jobData.jobs : [],
        };
    });
    electron_1.ipcMain.handle('task:generations', async (_event, jobId) => {
        if (!jobId)
            throw new Error('任务 ID 不能为空');
        const { base, token, aiConfigId } = (0, server_client_1.requireAuthWithAi)(store_1.store.store);
        const data = await (0, server_client_1.serverFetch)(base, `/api/ai/configs/${aiConfigId}/task-jobs/${encodeURIComponent(jobId)}/generations`, { token, failureMessage: '任务详情加载失败' });
        return Array.isArray(data?.generations) ? data.generations : [];
    });
    electron_1.ipcMain.handle('task:trigger', async (_event, payload) => {
        const { base, token, aiConfigId } = (0, server_client_1.requireAuthWithAi)(store_1.store.store);
        return (0, server_client_1.serverFetch)(base, `/api/ai/configs/${aiConfigId}/task-trigger`, {
            method: 'POST', token, body: payload || {}, failureMessage: '创建任务失败',
        });
    });
    electron_1.ipcMain.handle('task:pause', async (_event, jobId) => taskJobAction(jobId, 'pause', '暂停任务失败'));
    electron_1.ipcMain.handle('task:resume', async (_event, jobId) => taskJobAction(jobId, 'resume', '恢复任务失败'));
    electron_1.ipcMain.handle('task:delete', async (_event, jobId) => {
        if (!jobId)
            throw new Error('任务 ID 不能为空');
        const { base, token, aiConfigId } = (0, server_client_1.requireAuthWithAi)(store_1.store.store);
        await (0, server_client_1.serverFetch)(base, `/api/ai/configs/${aiConfigId}/task-jobs/${encodeURIComponent(jobId)}`, {
            method: 'DELETE', token, failureMessage: '删除任务失败',
        });
        return { success: true };
    });
}
