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
electron_1.app.setName('HeySure Agent');
if (process.platform === 'win32') {
    electron_1.app.setAppUserModelId('com.heysure.agent.win');
}
let mainWindow = null;
let captureWindow = null;
let tray = null;
let agent = null;
// ── Icon generation ─────────────────────────────────────────────────────────
function makeColorIcon(r, g, b, size = 16) {
    const buf = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
        const o = i * 4;
        buf[o + 0] = b; // BGRA order
        buf[o + 1] = g;
        buf[o + 2] = r;
        buf[o + 3] = 255;
    }
    return electron_1.nativeImage.createFromBitmap(buf, { width: size, height: size });
}
const ICONS = {
    disconnected: makeColorIcon(120, 120, 120, 16),
    connecting: makeColorIcon(251, 191, 36, 16),
    connected: makeColorIcon(99, 102, 241, 16),
    registered: makeColorIcon(34, 197, 94, 16),
    error: makeColorIcon(239, 68, 68, 16),
};
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
        frame: true,
        title: 'HeySure Agent',
        backgroundColor: store_1.store.get('theme') === 'light' ? '#f0f0ff' : '#0e0e1a',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
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
    tray = new electron_1.Tray(ICONS.disconnected);
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
    tray.setImage(ICONS[status] || ICONS.disconnected);
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
// ── IPC handlers ──────────────────────────────────────────────────────────────
function registerIpc() {
    electron_1.ipcMain.handle('settings:get', () => store_1.store.store);
    electron_1.ipcMain.handle('settings:save', (_event, newSettings) => {
        Object.entries(newSettings).forEach(([k, v]) => store_1.store.set(k, v));
        agent?.updateSettings(store_1.store.store);
        return store_1.store.store;
    });
    electron_1.ipcMain.handle('agent:connect', () => {
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
        let url;
        try {
            url = new URL(raw);
        }
        catch {
            return { success: false, error: '服务器 URL 格式无效' };
        }
        const base = url.href.replace(/\/$/, '');
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
    electron_1.ipcMain.handle('chat:send', async (_event, messages) => {
        const s = store_1.store.store;
        if (!s.aiKey)
            throw new Error('未配置 AI Key');
        return callAiApi(s.aiBaseUrl || 'https://api.anthropic.com', s.aiKey, s.aiModel || 'claude-sonnet-4-5', messages);
    });
    electron_1.ipcMain.handle('auth:login', async (_event, params) => {
        const { serverUrl, account, password } = params;
        if (!serverUrl)
            throw new Error('服务器 URL 不能为空');
        let url;
        try { url = new URL(serverUrl); }
        catch { throw new Error('服务器 URL 格式无效'); }
        const base = url.href.replace(/\/$/, '');
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
        if (data.user?.id)
            store_1.store.set('userId', data.user.id);
        return { success: true, user: data.user };
    });
    electron_1.ipcMain.handle('auth:logout', () => {
        agent?.disconnect();
        store_1.store.set('authToken', '');
        store_1.store.set('userAccount', '');
        store_1.store.set('userId', null);
        store_1.store.set('selectedAiConfigId', null);
        store_1.store.set('selectedAiConfigName', '');
        store_1.store.set('selectedAiConfigRole', 'member');
        store_1.store.set('selectedAiConfigLifecycle', 'working');
        store_1.store.set('selectedAiConfigProject', '');
        store_1.store.set('agentToken', '');
        store_1.store.set('agentId', '');
        store_1.store.set('agentName', 'Windows Agent');
        return { success: true };
    });
    electron_1.ipcMain.handle('ai-config:list', async () => {
        const s = store_1.store.store;
        if (!s.serverUrl || !s.authToken)
            throw new Error('未登录');
        const base = s.serverUrl.replace(/\/$/, '');
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
        const base = s.serverUrl.replace(/\/$/, '');
        try {
            const res = await electron_1.net.fetch(`${base}/api/ai/runtime-status`, {
                headers: { 'Authorization': `Bearer ${s.authToken}` },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return [];
            return await res.json();
        }
        catch { return []; }
    });
    electron_1.ipcMain.handle('ai-config:select', async (_event, cfg) => {
        store_1.store.set('selectedAiConfigId', cfg.id);
        store_1.store.set('selectedAiConfigName', cfg.name);
        store_1.store.set('selectedAiConfigRole', cfg.digital_member_role || 'member');
        store_1.store.set('selectedAiConfigLifecycle', cfg.lifecycle_status || 'working');
        store_1.store.set('selectedAiConfigProject', cfg.project_name || '');
        store_1.store.set('agentToken', store_1.store.get('authToken'));
        store_1.store.set('agentId', `win-desktop-${cfg.id}`);
        store_1.store.set('agentName', cfg.name);
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
        const base = s.serverUrl.replace(/\/$/, '');
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
}
// ── AI API helper ─────────────────────────────────────────────────────────────
async function callAiApi(baseUrl, apiKey, model, messages) {
    const isAnthropic = baseUrl.includes('anthropic.com');
    const endpoint = isAnthropic
        ? `${baseUrl.replace(/\/$/, '')}/v1/messages`
        : `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (isAnthropic) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
    }
    else {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const body = JSON.stringify({ model, max_tokens: 4096, messages });
    const res = await electron_1.net.fetch(endpoint, { method: 'POST', headers, body });
    const data = await res.json();
    if (!res.ok) {
        throw new Error(data?.error?.message || `API error ${res.status}`);
    }
    if (isAnthropic) {
        return data.content?.[0]?.text || '';
    }
    else {
        return data.choices?.[0]?.message?.content || '';
    }
}
// ── App lifecycle ─────────────────────────────────────────────────────────────
electron_1.app.whenReady().then(async () => {
    await setupCaptureWindow();
    const settings = store_1.store.store;
    agent = createAgent(settings);
    registerIpc();
    createMainWindow();
    createTray();
    // Auto-connect only if already logged in with AI selected
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
