"use strict";
// Activity log dispatcher. Main process attaches `bindActivityLogTarget` once;
// every module can then call `sendActivityLog(...)` without holding a window
// reference. Falls back to a no-op when no window is bound (e.g. during boot).
Object.defineProperty(exports, "__esModule", { value: true });
exports.bindActivityLogTarget = bindActivityLogTarget;
exports.sendActivityLog = sendActivityLog;
let target = null;
function bindActivityLogTarget(win) {
    target = win;
}
function sendActivityLog(type, status, message, data) {
    const entry = {
        id: Math.random().toString(36).slice(2),
        type, status, message, data,
        timestamp: Date.now(),
    };
    target?.webContents.send('activity:log', entry);
}
