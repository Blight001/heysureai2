"use strict";
// Application entry point. Owns the Electron lifecycle and stitches together
// the smaller modules (windows, tray, agent runtime, IPC). Keep this file
// short — each piece of real logic lives in its own module.
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const store_1 = require("./store");
const capture_bridge_1 = require("./capture-bridge");
const main_window_1 = require("./windows/main-window");
const tray_1 = require("./windows/tray");
const agent_runtime_1 = require("./services/agent-runtime");
const activity_log_1 = require("./services/activity-log");
const ipc_1 = require("./ipc");
electron_1.app.setName('HeySure Agent');
if (process.platform === 'win32') {
    electron_1.app.setAppUserModelId('com.heysure.agent.win');
    electron_1.app.commandLine.appendSwitch('force-renderer-accessibility', 'complete');
}
const hasSingleInstanceLock = electron_1.app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    ;
    electron_1.app.isQuitting = true;
    electron_1.app.quit();
}
electron_1.app.on('second-instance', () => {
    const w = (0, main_window_1.getMainWindow)();
    if (!w)
        return;
    if (w.isMinimized())
        w.restore();
    w.show();
    w.focus();
});
async function bootstrap() {
    if (process.platform === 'win32') {
        electron_1.app.setAccessibilitySupportEnabled(true);
    }
    (0, capture_bridge_1.initCapture)();
    (0, agent_runtime_1.clearAiSelectionIfLoggedOut)();
    (0, agent_runtime_1.initAgent)(store_1.store.store);
    (0, ipc_1.registerAllIpc)();
    electron_1.Menu.setApplicationMenu(null);
    const mainWindow = (0, main_window_1.createMainWindow)();
    (0, activity_log_1.bindActivityLogTarget)(mainWindow);
    (0, tray_1.createTray)({
        onToggleConnection: () => {
            const agent = (0, agent_runtime_1.getAgent)();
            if ((0, agent_runtime_1.isAgentActive)())
                agent?.disconnect();
            else
                agent?.connect();
        },
        onShowPanel: () => {
            const w = (0, main_window_1.getMainWindow)();
            if (w?.isVisible())
                w.hide();
            else {
                w?.show();
                w?.focus();
            }
        },
        isActive: agent_runtime_1.isAgentActive,
    });
    (0, tray_1.updateTray)((0, agent_runtime_1.getAgent)()?.status || 'disconnected');
    // Auto-connect as soon as the user is logged in. The AI assignment is now
    // controlled server-side (Workshop panel), so we no longer gate on a locally
    // selected AI member.
    if (store_1.store.get('authToken')) {
        (0, agent_runtime_1.getAgent)()?.connect();
    }
}
if (hasSingleInstanceLock) {
    electron_1.app.whenReady().then(bootstrap);
}
// Keep running in tray when all windows are closed
electron_1.app.on('window-all-closed', (e) => { e.preventDefault(); });
electron_1.app.on('before-quit', () => {
    ;
    electron_1.app.isQuitting = true;
    (0, agent_runtime_1.getAgent)()?.disconnect();
});
electron_1.app.on('activate', () => { (0, main_window_1.getMainWindow)()?.show(); });
