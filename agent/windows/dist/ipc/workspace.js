"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkspaceIpc = registerWorkspaceIpc;
const electron_1 = require("electron");
const store_1 = require("../store");
const server_client_1 = require("../services/server-client");
function registerWorkspaceIpc() {
    electron_1.ipcMain.handle('workspace:files', async () => {
        const { base, token } = (0, server_client_1.requireAuth)(store_1.store.store);
        const data = await (0, server_client_1.serverFetch)(base, '/api/chat/files', {
            token, failureMessage: '工作区目录加载失败',
        });
        return Array.isArray(data) ? data : [];
    });
}
