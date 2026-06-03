"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearStoredAuthSession = clearStoredAuthSession;
exports.recoverAuthSession = recoverAuthSession;
const store_1 = require("../store");
const agent_runtime_1 = require("./agent-runtime");
const activity_log_1 = require("./activity-log");
const main_window_1 = require("../windows/main-window");
const reauth_1 = require("./reauth");
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
// Throttle so a server that keeps rejecting us can't spin the auto-login in a
// tight loop. After a few attempts in a short window we give up and fall back
// to asking the user to log in by hand.
const REAUTH_WINDOW_MS = 60000;
const REAUTH_MAX_IN_WINDOW = 3;
let reauthTimestamps = [];
let recovering = null;
// Called when the server reports our session is no longer valid — an HTTP 401
// or a socket-level register rejection. First we try to silently re-login with
// the saved credentials and bring the agent back online; only if that fails do
// we clear the session and prompt the user. Concurrent callers share a single
// recovery attempt. Returns true if the session was recovered.
function recoverAuthSession(reason = '登录已过期，请重新登录') {
    if (recovering)
        return recovering;
    recovering = (async () => {
        const now = Date.now();
        reauthTimestamps = reauthTimestamps.filter(t => now - t < REAUTH_WINDOW_MS);
        if (reauthTimestamps.length >= REAUTH_MAX_IN_WINDOW) {
            (0, activity_log_1.sendActivityLog)('system', 'warn', '自动重新登录尝试过于频繁，已停止并要求手动登录');
            clearStoredAuthSession(reason);
            return false;
        }
        reauthTimestamps.push(now);
        (0, activity_log_1.sendActivityLog)('system', 'info', `检测到登录失效（${reason}），正在用保存的账号自动重新登录…`);
        const ok = await (0, reauth_1.reauthenticate)();
        if (ok) {
            // Fresh token in the store — rebuild the agent so it picks up the new
            // token, then reconnect. rebuildAgent tears down the old (possibly still
            // transport-connected) socket first.
            (0, activity_log_1.sendActivityLog)('system', 'success', '自动重新登录成功，正在重新连接服务器');
            (0, agent_runtime_1.rebuildAgent)(store_1.store.store);
            (0, agent_runtime_1.getAgent)()?.connect();
            (0, main_window_1.getMainWindow)()?.webContents.send('auth:refreshed');
            return true;
        }
        clearStoredAuthSession(reason);
        return false;
    })();
    // Release the lock once this attempt settles so a later, genuinely new
    // failure can try again.
    recovering.finally(() => { recovering = null; });
    return recovering;
}
