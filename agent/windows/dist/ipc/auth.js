"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthIpc = registerAuthIpc;
const electron_1 = require("electron");
const store_1 = require("../store");
const server_client_1 = require("../services/server-client");
const avatar_cache_1 = require("../services/avatar-cache");
const agent_runtime_1 = require("../services/agent-runtime");
function registerAuthIpc() {
    electron_1.ipcMain.handle('auth:login', async (_event, params) => {
        const { serverUrl, account, password, remember } = params;
        if (!serverUrl)
            throw new Error('服务器 URL 不能为空');
        let base;
        try {
            base = (0, server_client_1.resolveBaseUrl)(serverUrl);
        }
        catch {
            throw new Error('服务器 URL 格式无效');
        }
        const data = await (0, server_client_1.serverFetch)(base, '/api/auth/login', {
            method: 'POST',
            body: { account, password },
            failureMessage: '登录失败',
        });
        store_1.store.set('serverUrl', base);
        store_1.store.set('authToken', data.access_token);
        store_1.store.set('userAccount', remember ? account : '');
        store_1.store.set('userPassword', remember ? password : '');
        store_1.store.set('rememberLogin', !!remember);
        store_1.store.set('userName', String(data.user?.name || data.user?.nickname || account));
        store_1.store.set('userAvatar', String(data.user?.avatar || ''));
        store_1.store.set('userId', data.user?.id ?? null);
        await (0, avatar_cache_1.cacheUserAvatar)(base, String(data.user?.avatar || ''));
        (0, agent_runtime_1.clearSelectedAiConfig)();
        (0, agent_runtime_1.getAgent)()?.updateSettings(store_1.store.store);
        return { success: true, user: data.user };
    });
    electron_1.ipcMain.handle('auth:logout', () => {
        // Disconnect any live socket first so the server sees us leaving.
        (0, agent_runtime_1.getAgent)()?.disconnect();
        store_1.store.set('authToken', '');
        if (store_1.store.get('rememberLogin')) {
            store_1.store.set('userAccount', store_1.store.get('userAccount') || '');
            store_1.store.set('userPassword', store_1.store.get('userPassword') || '');
        }
        else {
            store_1.store.set('userAccount', '');
            store_1.store.set('userPassword', '');
        }
        store_1.store.set('rememberLogin', !!store_1.store.get('rememberLogin'));
        store_1.store.set('userName', '');
        store_1.store.set('userAvatar', '');
        store_1.store.set('userAvatarDataUrl', '');
        store_1.store.set('userId', null);
        (0, agent_runtime_1.clearSelectedAiConfig)();
        // Rebuild the agent so its in-memory `settings` snapshot (which still
        // holds the old authToken) is replaced with the cleared store. Without
        // this, a subsequent connect() would reuse the stale token.
        (0, agent_runtime_1.rebuildAgent)(store_1.store.store);
        return { success: true };
    });
}
