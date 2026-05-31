"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearStoredAuthSession = clearStoredAuthSession;
const store_1 = require("../store");
const agent_runtime_1 = require("./agent-runtime");
const activity_log_1 = require("./activity-log");
const main_window_1 = require("../windows/main-window");
function clearStoredAuthSession(reason = '登录已过期，请重新登录') {
    const hadAuth = !!store_1.store.get('authToken');
    (0, agent_runtime_1.getAgent)()?.disconnect();
    store_1.store.set('authToken', '');
    store_1.store.set('userAccount', '');
    store_1.store.set('userName', '');
    store_1.store.set('userAvatar', '');
    store_1.store.set('userAvatarDataUrl', '');
    store_1.store.set('userId', null);
    (0, agent_runtime_1.clearSelectedAiConfig)();
    (0, agent_runtime_1.rebuildAgent)(store_1.store.store);
    if (hadAuth) {
        (0, activity_log_1.sendActivityLog)('system', 'warn', reason);
        (0, main_window_1.getMainWindow)()?.webContents.send('auth:expired', reason);
    }
}
