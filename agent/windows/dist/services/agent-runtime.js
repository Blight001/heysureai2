"use strict";
// Glue around the HeySureAgent socket client. Owns the singleton instance,
// re-wires renderer events on construction, and exposes a small API the IPC
// layer + tray menu can call.
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAgent = initAgent;
exports.getAgent = getAgent;
exports.rebuildAgent = rebuildAgent;
exports.isAgentActive = isAgentActive;
exports.clearSelectedAiConfig = clearSelectedAiConfig;
exports.clearAiSelectionIfLoggedOut = clearAiSelectionIfLoggedOut;
const agent_1 = require("../agent");
const store_1 = require("../store");
const main_window_1 = require("../windows/main-window");
const activity_log_1 = require("./activity-log");
const auth_state_1 = require("./auth-state");
const tray_1 = require("../windows/tray");
let agent = null;
function buildAgent(settings) {
    return new agent_1.HeySureAgent(settings, {
        onStatusChange: (status, reason, aiConfigId) => {
            (0, tray_1.updateTray)(status);
            (0, main_window_1.getMainWindow)()?.webContents.send('agent:status-changed', status, reason, aiConfigId ?? null);
            (0, activity_log_1.sendActivityLog)('system', status === 'registered' ? 'success' : status === 'error' ? 'error' : 'info', `状态变更: ${tray_1.STATUS_LABELS[status]}${reason ? ` (${reason})` : ''}`);
        },
        onLog: (level, message, data) => (0, activity_log_1.sendActivityLog)(level, 'info', message, data),
        onAuthFailure: (reason) => {
            void (0, auth_state_1.recoverAuthSession)(`登录已过期（${reason}），请重新登录`);
        },
        onReconnecting: (active, reason) => {
            // Just drive the orange UI prompt; the retry loop fires every couple of
            // seconds, so logging each attempt here would spam the activity log.
            (0, main_window_1.getMainWindow)()?.webContents.send('agent:reconnecting', active, reason ?? null);
        },
        onTaskStart: (taskId, tool, args) => {
            (0, main_window_1.getMainWindow)()?.webContents.send('task:start', {
                taskId, tool, args, timestamp: Date.now(),
            });
            (0, activity_log_1.sendActivityLog)('task', 'running', `[工具] ${tool}`, args);
        },
        onTaskResult: (taskId, tool, result, success) => {
            (0, main_window_1.getMainWindow)()?.webContents.send('task:result', {
                taskId, tool, result, success, timestamp: Date.now(),
            });
            (0, activity_log_1.sendActivityLog)('task', success ? 'success' : 'error', `${success ? '✓' : '✗'} ${tool}`, success ? (result?.summary || result) : result);
        },
    });
}
function initAgent(settings) {
    agent = buildAgent(settings);
    return agent;
}
function getAgent() {
    return agent;
}
function rebuildAgent(settings) {
    agent?.disconnect();
    agent = buildAgent(settings);
    return agent;
}
function isAgentActive() {
    const s = agent?.status;
    return s === 'connected' || s === 'registered';
}
function clearSelectedAiConfig() {
    store_1.store.set('selectedAiConfigId', null);
    store_1.store.set('selectedAiConfigName', '');
    store_1.store.set('selectedAiConfigRole', 'member');
    store_1.store.set('selectedAiConfigLifecycle', 'working');
    store_1.store.set('selectedAiConfigProject', '');
    store_1.store.set('agentToken', '');
    store_1.store.set('agentId', '');
    store_1.store.set('agentName', 'Windows Agent');
    store_1.store.set('agentGroup', '');
}
function clearAiSelectionIfLoggedOut() {
    if (store_1.store.get('authToken'))
        return false;
    if (!store_1.store.get('selectedAiConfigId'))
        return false;
    clearSelectedAiConfig();
    return true;
}
