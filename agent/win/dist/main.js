"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const store_1 = require("./store");
const constants_1 = require("./constants");
const agent_1 = require("./agent");
const capture_bridge_1 = require("./capture-bridge");
const server_url_1 = require("./server-url");
electron_1.app.setName('HeySure Agent');
if (process.platform === 'win32') {
    electron_1.app.setAppUserModelId('com.heysure.agent.win');
}
let mainWindow = null;
let captureWindow = null;
let tray = null;
let agent = null;
const APP_ICON_PATH = path.join(__dirname, '../assets/icon.ico');
const TRAY_ICON_PATHS = {
    disconnected: path.join(__dirname, '../assets/desktop.png'),
    connecting: path.join(__dirname, '../assets/desktop_yellow.png'),
    connected: path.join(__dirname, '../assets/desktop_green.png'),
    registered: path.join(__dirname, '../assets/desktop_green.png'),
    error: path.join(__dirname, '../assets/desktop_red.png'),
};
// ── Tray icons ───────────────────────────────────────────────────────────────
function loadTrayIcon(status) {
    const iconPath = TRAY_ICON_PATHS[status] || TRAY_ICON_PATHS.disconnected;
    const image = electron_1.nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
        return electron_1.nativeImage.createFromPath(APP_ICON_PATH);
    }
    return image.resize({ width: 16, height: 16 });
}
const STATUS_LABELS = {
    disconnected: '未连接',
    connecting: '连接中...',
    connected: '已连接',
    registered: '已注册',
    error: '连接错误',
};
// ── Capture window (hidden) for desktopCapturer ──────────────────────────────
async function setupCaptureWindow() {
    captureWindow = new electron_1.BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    const captureHtml = `<!DOCTYPE html>
<html><body><script>
const { ipcRenderer, desktopCapturer, screen } = require('electron')

ipcRenderer.on('do-capture', async (event, opts) => {
  try {
    const d = screen.getPrimaryDisplay()
    const w = opts.width || d.size.width
    const h = opts.height || d.size.height
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: w, height: h }
    })
    const idx = Math.min(opts.displayIndex || 0, sources.length - 1)
    let img = sources[idx].thumbnail
    if (opts.cropRegion) {
      img = img.crop(opts.cropRegion)
    }
    const buf = img.toPNG()
    ipcRenderer.send('capture-done', Array.from(buf))
  } catch (e) {
    ipcRenderer.send('capture-error', e.message)
  }
})
</script></body></html>`;
    const tmpHtml = path.join(electron_1.app.getPath('temp'), 'hs-capture.html');
    fs.writeFileSync(tmpHtml, captureHtml, 'utf8');
    await captureWindow.loadFile(tmpHtml);
    // Queue of pending capture promises
    const pending = [];
    captureWindow.webContents.on('ipc-message', (_event, channel, ...args) => {
        if (channel === 'capture-done' && pending.length > 0) {
            const { resolve } = pending.shift();
            resolve(Buffer.from(args[0]));
        }
        else if (channel === 'capture-error' && pending.length > 0) {
            const { reject } = pending.shift();
            reject(new Error(args[0]));
        }
    });
    // Register the capture function in the bridge so screen.ts can call it
    (0, capture_bridge_1.registerCaptureFn)((opts) => new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        captureWindow?.webContents.send('do-capture', opts);
        setTimeout(() => {
            const idx = pending.findIndex(p => p.reject === reject);
            if (idx !== -1) {
                pending.splice(idx, 1);
                reject(new Error(`Screenshot timed out after ${constants_1.SCREENSHOT_TIMEOUT_MS / 1000}s`));
            }
        }, constants_1.SCREENSHOT_TIMEOUT_MS);
    }));
}
// ── Main window ───────────────────────────────────────────────────────────────
function createMainWindow() {
    const bounds = store_1.store.get('windowBounds') || { width: 900, height: 660 };
    mainWindow = new electron_1.BrowserWindow({
        width: bounds.width || 900,
        height: bounds.height || 660,
        x: bounds.x,
        y: bounds.y,
        minWidth: 700,
        minHeight: 500,
        icon: APP_ICON_PATH,
        frame: true,
        autoHideMenuBar: true,
        title: 'HeySure Agent',
        backgroundColor: store_1.store.get('theme') === 'light' ? '#f0f0ff' : '#0e0e1a',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
    mainWindow.setMenuBarVisibility(false);
    mainWindow.on('close', (e) => {
        if (!electron_1.app.isQuitting) {
            e.preventDefault();
            mainWindow?.hide();
        }
    });
    mainWindow.on('resize', saveBounds);
    mainWindow.on('move', saveBounds);
}
function saveBounds() {
    if (!mainWindow)
        return;
    store_1.store.set('windowBounds', mainWindow.getBounds());
}
// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
    tray = new electron_1.Tray(loadTrayIcon('disconnected'));
    tray.setToolTip('HeySure Agent — 未连接');
    updateTrayMenu('disconnected');
    tray.on('click', () => {
        if (mainWindow?.isVisible()) {
            mainWindow.hide();
        }
        else {
            mainWindow?.show();
            mainWindow?.focus();
        }
    });
}
function updateTrayMenu(status) {
    if (!tray)
        return;
    tray.setImage(loadTrayIcon(status));
    tray.setToolTip(`HeySure Agent — ${STATUS_LABELS[status]}`);
    const isActive = status === 'registered' || status === 'connected';
    const menu = electron_1.Menu.buildFromTemplate([
        { label: `状态: ${STATUS_LABELS[status]}`, enabled: false },
        { type: 'separator' },
        {
            label: isActive ? '断开连接' : '连接服务器',
            click: () => {
                if (isActive) {
                    agent?.disconnect();
                }
                else {
                    agent?.connect();
                }
            },
        },
        {
            label: '打开面板',
            click: () => { mainWindow?.show(); mainWindow?.focus(); },
        },
        { type: 'separator' },
        {
            label: '退出',
            click: () => { electron_1.app.isQuitting = true; electron_1.app.quit(); },
        },
    ]);
    tray.setContextMenu(menu);
}
// ── Agent ─────────────────────────────────────────────────────────────────────
function createAgent(settings) {
    return new agent_1.HeySureAgent(settings, {
        onStatusChange: (status, reason) => {
            updateTrayMenu(status);
            mainWindow?.webContents.send('agent:status-changed', status, reason);
            sendActivityLog('system', status === 'registered' ? 'success' : status === 'error' ? 'error' : 'info', `状态变更: ${STATUS_LABELS[status]}${reason ? ` (${reason})` : ''}`);
        },
        onLog: (level, message, data) => {
            sendActivityLog(level, 'info', message, data);
        },
        onTaskStart: (taskId, tool, args) => {
            mainWindow?.webContents.send('task:start', { taskId, tool, args, timestamp: Date.now() });
            sendActivityLog('task', 'running', `[工具] ${tool}`, args);
        },
        onTaskResult: (taskId, tool, result, success) => {
            mainWindow?.webContents.send('task:result', { taskId, tool, result, success, timestamp: Date.now() });
            sendActivityLog('task', success ? 'success' : 'error', `${success ? '✓' : '✗'} ${tool}`, success ? (result?.summary || result) : result);
        },
    });
}
function sendActivityLog(type, status, message, data) {
    mainWindow?.webContents.send('activity:log', {
        id: Math.random().toString(36).slice(2),
        type,
        status,
        message,
        data,
        timestamp: Date.now(),
    });
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
// ── IPC handlers ──────────────────────────────────────────────────────────────
function registerIpc() {
    electron_1.ipcMain.handle('settings:get', () => {
        clearAiSelectionIfLoggedOut();
        return store_1.store.store;
    });
    electron_1.ipcMain.handle('settings:save', (_event, newSettings) => {
        Object.entries(newSettings).forEach(([k, v]) => store_1.store.set(k, v));
        if (clearAiSelectionIfLoggedOut()) {
            sendActivityLog('system', 'warn', '未登录，已取消 AI 成员自动注册选择');
        }
        agent?.updateSettings(store_1.store.store);
        return store_1.store.store;
    });
    electron_1.ipcMain.handle('agent:connect', () => {
        if (!store_1.store.get('authToken')) {
            if (clearAiSelectionIfLoggedOut()) {
                agent?.updateSettings(store_1.store.store);
            }
            sendActivityLog('system', 'warn', '请先登录并选择 AI 成员后再连接软件端 Agent');
            return false;
        }
        agent?.connect();
        return true;
    });
    electron_1.ipcMain.handle('agent:disconnect', () => {
        agent?.disconnect();
        return true;
    });
    electron_1.ipcMain.handle('agent:status', () => agent?.status || 'disconnected');
    electron_1.ipcMain.handle('theme:set', (_event, theme) => {
        store_1.store.set('theme', theme);
        mainWindow?.setBackgroundColor(theme === 'light' ? '#f0f0ff' : '#0e0e1a');
        return true;
    });
    electron_1.ipcMain.handle('connection:test', async () => {
        const raw = String(store_1.store.get('serverUrl') || '').trim();
        if (!raw)
            return { success: false, error: '未配置服务器 URL' };
        let base;
        try {
            base = (0, server_url_1.normalizeServerUrl)(raw);
        }
        catch {
            return { success: false, error: '服务器 URL 格式无效' };
        }
        try {
            const start = Date.now();
            const res = await electron_1.net.fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
                .catch(() => electron_1.net.fetch(base, { signal: AbortSignal.timeout(5000) }));
            const ms = Date.now() - start;
            return { success: true, status: res.status, ms };
        }
        catch (err) {
            return { success: false, error: err.message || String(err) };
        }
    });
    electron_1.ipcMain.handle('chat:history', async () => {
        const s = store_1.store.store;
        return getServerChatHistory(s);
    });
    electron_1.ipcMain.handle('chat:send', async (_event, content) => {
        const s = store_1.store.store;
        return callServerChat(s, String(content || ''));
    });
    electron_1.ipcMain.handle('auth:login', async (_event, params) => {
        const { serverUrl, account, password } = params;
        if (!serverUrl)
            throw new Error('服务器 URL 不能为空');
        let base;
        try {
            base = (0, server_url_1.normalizeServerUrl)(serverUrl);
        }
        catch {
            throw new Error('服务器 URL 格式无效');
        }
        const res = await electron_1.net.fetch(`${base}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, password }),
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data?.detail || `登录失败 (${res.status})`);
        store_1.store.set('serverUrl', base);
        store_1.store.set('authToken', data.access_token);
        store_1.store.set('userAccount', account);
        store_1.store.set('userId', data.user?.id ?? null);
        clearSelectedAiConfig();
        agent?.updateSettings(store_1.store.store);
        return { success: true, user: data.user };
    });
    electron_1.ipcMain.handle('auth:logout', () => {
        agent?.disconnect();
        store_1.store.set('authToken', '');
        store_1.store.set('userAccount', '');
        store_1.store.set('userId', null);
        clearSelectedAiConfig();
        return { success: true };
    });
    electron_1.ipcMain.handle('ai-config:list', async () => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            throw new Error('未登录');
        const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
        const res = await electron_1.net.fetch(`${base}/api/ai/configs`, {
            headers: { 'Authorization': `Bearer ${s.authToken}` },
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data?.detail || `获取 AI 列表失败 (${res.status})`);
        return data;
    });
    electron_1.ipcMain.handle('ai-config:runtime-status', async () => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            return [];
        const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
        try {
            const res = await electron_1.net.fetch(`${base}/api/ai/runtime-status`, {
                headers: { 'Authorization': `Bearer ${s.authToken}` },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return [];
            return await res.json();
        }
        catch {
            return [];
        }
    });
    electron_1.ipcMain.handle('ai-config:select', async (_event, cfg) => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken) {
            clearSelectedAiConfig();
            agent?.updateSettings(store_1.store.store);
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
        agent?.disconnect();
        agent = createAgent(store_1.store.store);
        agent.connect();
        return { success: true };
    });
    electron_1.ipcMain.handle('ai-config:clone', async (_event, configId) => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            throw new Error('未登录');
        const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
        const res = await electron_1.net.fetch(`${base}/api/ai/configs/${configId}/clone`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${s.authToken}`,
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data?.detail || `克隆失败 (${res.status})`);
        return data;
    });
    electron_1.ipcMain.handle('task:list', async () => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            throw new Error('未登录');
        if (!s.selectedAiConfigId)
            throw new Error('未选择 AI 成员');
        const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
        const headers = { 'Authorization': `Bearer ${s.authToken}` };
        const [taskRes, jobRes] = await Promise.all([
            electron_1.net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-list`, {
                headers,
                signal: AbortSignal.timeout(10000),
            }),
            electron_1.net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-jobs`, {
                headers,
                signal: AbortSignal.timeout(10000),
            }),
        ]);
        const taskData = await taskRes.json();
        const jobData = await jobRes.json();
        if (!taskRes.ok)
            throw new Error(taskData?.detail || `任务列表加载失败 (${taskRes.status})`);
        if (!jobRes.ok)
            throw new Error(jobData?.detail || `任务执行记录加载失败 (${jobRes.status})`);
        return {
            tasks: Array.isArray(taskData?.tasks) ? taskData.tasks : [],
            jobs: Array.isArray(jobData?.jobs) ? jobData.jobs : [],
        };
    });
    electron_1.ipcMain.handle('task:generations', async (_event, jobId) => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            throw new Error('未登录');
        if (!s.selectedAiConfigId)
            throw new Error('未选择 AI 成员');
        if (!jobId)
            throw new Error('任务 ID 不能为空');
        const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
        const res = await electron_1.net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-jobs/${encodeURIComponent(jobId)}/generations`, {
            headers: { 'Authorization': `Bearer ${s.authToken}` },
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data?.detail || `任务详情加载失败 (${res.status})`);
        return Array.isArray(data?.generations) ? data.generations : [];
    });
    electron_1.ipcMain.handle('task:trigger', async (_event, payload) => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            throw new Error('未登录');
        if (!s.selectedAiConfigId)
            throw new Error('未选择 AI 成员');
        const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
        const res = await electron_1.net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-trigger`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${s.authToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload || {}),
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data?.detail || `创建任务失败 (${res.status})`);
        return data;
    });
    electron_1.ipcMain.handle('task:pause', async (_event, jobId) => callTaskJobAction(jobId, 'pause', '暂停任务失败'));
    electron_1.ipcMain.handle('task:resume', async (_event, jobId) => callTaskJobAction(jobId, 'resume', '恢复任务失败'));
    electron_1.ipcMain.handle('task:delete', async (_event, jobId) => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            throw new Error('未登录');
        if (!s.selectedAiConfigId)
            throw new Error('未选择 AI 成员');
        if (!jobId)
            throw new Error('任务 ID 不能为空');
        const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
        const res = await electron_1.net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-jobs/${encodeURIComponent(jobId)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${s.authToken}` },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data?.detail || `删除任务失败 (${res.status})`);
        }
        return { success: true };
    });
    electron_1.ipcMain.handle('workspace:files', async () => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            throw new Error('未登录');
        const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
        const res = await electron_1.net.fetch(`${base}/api/chat/files`, {
            headers: { 'Authorization': `Bearer ${s.authToken}` },
            signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data?.detail || `工作区目录加载失败 (${res.status})`);
        return Array.isArray(data) ? data : [];
    });
}
async function callTaskJobAction(jobId, action, fallback) {
    const s = store_1.store.store;
    if (!s.serverUrl || !s.authToken)
        throw new Error('未登录');
    if (!s.selectedAiConfigId)
        throw new Error('未选择 AI 成员');
    if (!jobId)
        throw new Error('任务 ID 不能为空');
    const base = (0, server_url_1.normalizeServerUrl)(s.serverUrl);
    const res = await electron_1.net.fetch(`${base}/api/ai/configs/${s.selectedAiConfigId}/task-jobs/${encodeURIComponent(jobId)}/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${s.authToken}` },
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || `${fallback} (${res.status})`);
    }
    return { success: true };
}
// ── Server-backed AI chat helper ──────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function requireChatSettings(settings) {
    if (!settings.serverUrl || !settings.authToken)
        throw new Error('请先登录服务器');
    if (!settings.selectedAiConfigId)
        throw new Error('请先选择 AI 成员');
    return {
        base: (0, server_url_1.normalizeServerUrl)(settings.serverUrl),
        token: settings.authToken,
        aiConfigId: Number(settings.selectedAiConfigId),
    };
}
async function readJsonResponse(res, fallback) {
    const text = await res.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        }
        catch {
            data = { detail: text };
        }
    }
    if (!res.ok)
        throw new Error(data?.detail || data?.error || `${fallback} (${res.status})`);
    return data;
}
async function ensureDesktopChatSession(settings) {
    const { base, token, aiConfigId } = requireChatSettings(settings);
    const query = new URLSearchParams({ ai_kind: 'assistant', ai_config_id: String(aiConfigId) }).toString();
    const listRes = await electron_1.net.fetch(`${base}/api/chat/sessions?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
    });
    const sessions = await readJsonResponse(listRes, '会话列表加载失败');
    if (Array.isArray(sessions) && sessions.length > 0) {
        const preferred = sessions.find((s) => /^软件端对话|^Windows Agent/.test(String(s?.name || ''))) || sessions[0];
        return { id: String(preferred.id), name: String(preferred.name || '软件端对话') };
    }
    const createRes = await electron_1.net.fetch(`${base}/api/chat/sessions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: '软件端对话',
            ai_config_id: aiConfigId,
            ai_kind: 'assistant',
        }),
        signal: AbortSignal.timeout(10000),
    });
    const created = await readJsonResponse(createRes, '会话创建失败');
    return { id: String(created?.id || ''), name: String(created?.name || '软件端对话') };
}
async function getServerChatHistory(settings) {
    const { base, token, aiConfigId } = requireChatSettings(settings);
    const session = await ensureDesktopChatSession(settings);
    const query = new URLSearchParams({
        ai_kind: 'assistant',
        ai_config_id: String(aiConfigId),
        session_id: session.id,
    }).toString();
    const res = await electron_1.net.fetch(`${base}/api/chat/history?${query}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
    });
    const rows = await readJsonResponse(res, '会话历史加载失败');
    return Array.isArray(rows) ? rows : [];
}
async function callServerChat(settings, content) {
    const text = String(content || '').trim();
    if (!text)
        throw new Error('消息内容不能为空');
    const { base, token, aiConfigId } = requireChatSettings(settings);
    const session = await ensureDesktopChatSession(settings);
    const startRes = await electron_1.net.fetch(`${base}/api/chat/run/start`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            visible_content: text,
            model_content: text,
            session_id: session.id,
            session_name: session.name,
            ai_config_id: aiConfigId,
            ai_kind: 'assistant',
        }),
        signal: AbortSignal.timeout(15000),
    });
    const started = await readJsonResponse(startRes, '发起对话失败');
    const runId = String(started?.run_id || '');
    if (!runId)
        throw new Error('服务器未返回运行 ID');
    let lastText = '';
    const MAX_POLLS = 600;
    for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(800);
        const statusRes = await electron_1.net.fetch(`${base}/api/chat/run/status/${encodeURIComponent(runId)}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(10000),
        });
        const st = await readJsonResponse(statusRes, '运行状态查询失败');
        lastText = String(st?.live_text || lastText || '');
        const status = String(st?.status || '');
        if (status === 'completed')
            return { text: lastText || '完成', sessionId: session.id };
        if (status === 'stopped')
            return { text: lastText || '（已停止）', sessionId: session.id };
        if (status === 'error')
            throw new Error(st?.error_message || 'AI 对话执行失败');
    }
    return { text: lastText || '（超时，未收到完整回复）', sessionId: session.id };
}
// ── App lifecycle ─────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(async () => {
    await setupCaptureWindow();
    clearAiSelectionIfLoggedOut();
    const settings = store_1.store.store;
    agent = createAgent(settings);
    registerIpc();
    electron_1.Menu.setApplicationMenu(null);
    createMainWindow();
    createTray();
    // Auto-connect only if a user has already logged in and selected an AI
    if (store_1.store.get('authToken') && store_1.store.get('selectedAiConfigId')) {
        agent.connect();
    }
});
// Keep running in tray even when all windows are closed
electron_1.app.on('window-all-closed', (e) => {
    e.preventDefault();
});
electron_1.app.on('before-quit', () => {
    ;
    electron_1.app.isQuitting = true;
    agent?.disconnect();
});
electron_1.app.on('activate', () => {
    mainWindow?.show();
});
