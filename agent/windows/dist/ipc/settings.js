"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSettingsIpc = registerSettingsIpc;
const electron_1 = require("electron");
const store_1 = require("../store");
const capture_bridge_1 = require("../capture-bridge");
const agent_runtime_1 = require("../services/agent-runtime");
const activity_log_1 = require("../services/activity-log");
const coordinates_1 = require("../tools/shared/coordinates");
const robot_1 = require("../tools/shared/robot");
const main_window_1 = require("../windows/main-window");
const server_client_1 = require("../services/server-client");
const avatar_cache_1 = require("../services/avatar-cache");
function pngSize(buf) {
    if (buf.length <= 24)
        return { width: 0, height: 0 };
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function roundScale(value) {
    return Math.round(value * 10000) / 10000;
}
function registerSettingsIpc() {
    electron_1.ipcMain.handle('settings:get', async () => {
        (0, agent_runtime_1.clearAiSelectionIfLoggedOut)();
        const s = store_1.store.store;
        if (s.serverUrl && s.authToken) {
            try {
                const base = (0, server_client_1.resolveBaseUrl)(s.serverUrl);
                const me = await (0, server_client_1.serverFetch)(base, '/api/auth/me', {
                    token: s.authToken,
                    failureMessage: '登录状态校验失败',
                    timeoutMs: 5000,
                });
                // Keep the cached avatar in sync if it changed server-side (mirrors the
                // browser extension's getMe refresh); re-fetch the image only as needed.
                const freshAvatar = me && typeof me === 'object' ? String(me.avatar || '') : s.userAvatar;
                if (freshAvatar !== s.userAvatar) {
                    store_1.store.set('userAvatar', freshAvatar);
                    await (0, avatar_cache_1.cacheUserAvatar)(base, freshAvatar);
                }
                else if (s.userAvatar && !s.userAvatarDataUrl) {
                    await (0, avatar_cache_1.cacheUserAvatar)(base, s.userAvatar);
                }
            }
            catch (err) {
                if (!(err instanceof server_client_1.ServerError && err.status === 401)) {
                    // Network/server errors should not log the user out. They are handled
                    // by the feature call that needs the server connection.
                }
            }
        }
        return store_1.store.store;
    });
    electron_1.ipcMain.handle('settings:save', (_event, newSettings) => {
        const agentAffectingKeys = new Set([
            'serverUrl',
            'agentToken',
            'agentId',
            'agentName',
            'agentGroup',
            'workspaceRoot',
            'authToken',
            'userId',
            'userName',
        ]);
        const shouldRefreshAgent = Object.keys(newSettings || {}).some(k => agentAffectingKeys.has(k));
        Object.entries(newSettings).forEach(([k, v]) => store_1.store.set(k, v));
        if ((0, agent_runtime_1.clearAiSelectionIfLoggedOut)()) {
            (0, activity_log_1.sendActivityLog)('system', 'warn', '未登录，已取消 AI 成员自动注册选择');
        }
        if (shouldRefreshAgent)
            (0, agent_runtime_1.getAgent)()?.updateSettings(store_1.store.store);
        return store_1.store.store;
    });
    electron_1.ipcMain.handle('settings:auto-calibrate-mouse', async () => {
        const displayIndex = 0;
        const buf = await (0, capture_bridge_1.executeCapture)({ displayIndex });
        const capture = pngSize(buf);
        if (!capture.width || !capture.height)
            throw new Error('无法读取截图尺寸');
        (0, coordinates_1.rememberCaptureGeometry)({ capture, display: (0, capture_bridge_1.getCaptureDisplayGeometry)(displayIndex) });
        const calibration = (0, coordinates_1.getCoordinateCalibration)();
        const frame = calibration.frame;
        if (!frame || !frame.width || !frame.height)
            throw new Error('无法获取屏幕校准几何信息');
        const robot = (0, robot_1.getRobot)();
        const targetCapture = {
            x: Math.max(1, capture.width - 1),
            y: Math.max(1, capture.height - 1),
        };
        const targetRobot = {
            x: Math.round(Number(frame.x || 0) + Number(frame.width) - 1),
            y: Math.round(Number(frame.y || 0) + Number(frame.height) - 1),
        };
        robot.moveMouse(targetRobot.x, targetRobot.y);
        await (0, robot_1.sleep)(40);
        robot.mouseClick('left');
        await (0, robot_1.sleep)(80);
        const cursor = robot.getMousePos();
        const autoScaleX = Number(frame.width) / Number(capture.width);
        const autoScaleY = Number(frame.height) / Number(capture.height);
        const scaleX = (Number(cursor.x) - Number(frame.x || 0)) / (targetCapture.x * autoScaleX);
        const scaleY = (Number(cursor.y) - Number(frame.y || 0)) / (targetCapture.y * autoScaleY);
        if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
            throw new Error('自动校准计算失败');
        }
        const nextScaleX = roundScale(scaleX);
        const nextScaleY = roundScale(scaleY);
        store_1.store.set('mouseCoordinateScaleX', nextScaleX);
        store_1.store.set('mouseCoordinateScaleY', nextScaleY);
        store_1.store.set('mouseCoordinateOffsetX', 0);
        store_1.store.set('mouseCoordinateOffsetY', 0);
        return {
            success: true,
            mouseCoordinateScaleX: nextScaleX,
            mouseCoordinateScaleY: nextScaleY,
            mouseCoordinateOffsetX: 0,
            mouseCoordinateOffsetY: 0,
            capture,
            frame,
            targetRobot,
            cursor: { x: Number(cursor.x), y: Number(cursor.y) },
        };
    });
    electron_1.ipcMain.handle('theme:set', (_event, theme) => {
        store_1.store.set('theme', theme);
        (0, main_window_1.setMainWindowTheme)(theme);
        return true;
    });
    electron_1.ipcMain.handle('window:minimize', () => {
        (0, main_window_1.minimizeMainWindow)();
        return true;
    });
    electron_1.ipcMain.handle('window:toggle-maximize', () => {
        return (0, main_window_1.toggleMaximizeMainWindow)();
    });
    electron_1.ipcMain.handle('window:close', () => {
        (0, main_window_1.closeMainWindow)();
        return true;
    });
    electron_1.ipcMain.handle('window:is-maximized', () => {
        return (0, main_window_1.isMainWindowMaximized)();
    });
}
