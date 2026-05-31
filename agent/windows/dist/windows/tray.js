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
exports.STATUS_LABELS = void 0;
exports.createTray = createTray;
exports.updateTray = updateTray;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const ASSET_DIR = path.join(__dirname, '../../assets');
const APP_ICON_PATH = path.join(ASSET_DIR, 'icon.ico');
const TRAY_ICON_PATHS = {
    disconnected: path.join(ASSET_DIR, 'desktop.png'),
    connecting: path.join(ASSET_DIR, 'desktop_yellow.png'),
    connected: path.join(ASSET_DIR, 'desktop_green.png'),
    registered: path.join(ASSET_DIR, 'desktop_green.png'),
    error: path.join(ASSET_DIR, 'desktop_red.png'),
};
exports.STATUS_LABELS = {
    disconnected: '未连接',
    connecting: '连接中...',
    connected: '已连接',
    registered: '已注册',
    error: '连接错误',
};
function loadTrayIcon(status) {
    const iconPath = TRAY_ICON_PATHS[status] || TRAY_ICON_PATHS.disconnected;
    const image = electron_1.nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
        return electron_1.nativeImage.createFromPath(APP_ICON_PATH);
    }
    return image.resize({ width: 16, height: 16 });
}
let tray = null;
let callbacks = null;
function createTray(cb) {
    callbacks = cb;
    tray = new electron_1.Tray(loadTrayIcon('disconnected'));
    tray.setToolTip('HeySure Agent — 未连接');
    updateTray('disconnected');
    tray.on('click', cb.onShowPanel);
    return tray;
}
function updateTray(status) {
    if (!tray || !callbacks)
        return;
    tray.setImage(loadTrayIcon(status));
    tray.setToolTip(`HeySure Agent — ${exports.STATUS_LABELS[status]}`);
    const active = callbacks.isActive();
    const menu = electron_1.Menu.buildFromTemplate([
        { label: `状态: ${exports.STATUS_LABELS[status]}`, enabled: false },
        { type: 'separator' },
        { label: active ? '断开连接' : '连接服务器', click: callbacks.onToggleConnection },
        { label: '打开面板', click: callbacks.onShowPanel },
        { type: 'separator' },
        {
            label: '退出',
            click: () => { electron_1.app.isQuitting = true; electron_1.app.quit(); },
        },
    ]);
    tray.setContextMenu(menu);
}
