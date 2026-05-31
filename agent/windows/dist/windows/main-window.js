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
exports.createMainWindow = createMainWindow;
exports.getMainWindow = getMainWindow;
exports.setMainWindowTheme = setMainWindowTheme;
exports.minimizeMainWindow = minimizeMainWindow;
exports.toggleMaximizeMainWindow = toggleMaximizeMainWindow;
exports.closeMainWindow = closeMainWindow;
exports.isMainWindowMaximized = isMainWindowMaximized;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const store_1 = require("../store");
const DEFAULT_BOUNDS = { width: 900, height: 660 };
const THEME_WINDOW_COLORS = {
    dark: '#0e0e1a',
    light: '#f0f0ff',
};
let mainWindow = null;
function createMainWindow() {
    const bounds = store_1.store.get('windowBounds') || DEFAULT_BOUNDS;
    const iconPath = path.join(__dirname, '../../assets/icon.ico');
    mainWindow = new electron_1.BrowserWindow({
        width: bounds.width || DEFAULT_BOUNDS.width,
        height: bounds.height || DEFAULT_BOUNDS.height,
        x: bounds.x,
        y: bounds.y,
        minWidth: 700,
        minHeight: 500,
        icon: iconPath,
        frame: false,
        autoHideMenuBar: true,
        title: 'HeySure Agent',
        backgroundColor: THEME_WINDOW_COLORS[store_1.store.get('theme') === 'light' ? 'light' : 'dark'],
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, '../preload.js'),
        },
    });
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    mainWindow.setMenuBarVisibility(false);
    mainWindow.on('close', (e) => {
        if (!electron_1.app.isQuitting) {
            e.preventDefault();
            mainWindow?.hide();
        }
    });
    const saveBounds = () => {
        if (!mainWindow)
            return;
        store_1.store.set('windowBounds', mainWindow.getBounds());
    };
    mainWindow.on('resize', saveBounds);
    mainWindow.on('move', saveBounds);
    return mainWindow;
}
function getMainWindow() {
    return mainWindow;
}
function setMainWindowTheme(theme) {
    mainWindow?.setBackgroundColor(THEME_WINDOW_COLORS[theme]);
}
function minimizeMainWindow() {
    mainWindow?.minimize();
}
function toggleMaximizeMainWindow() {
    if (!mainWindow)
        return false;
    if (mainWindow.isMaximized())
        mainWindow.unmaximize();
    else
        mainWindow.maximize();
    return mainWindow.isMaximized();
}
function closeMainWindow() {
    mainWindow?.close();
}
function isMainWindowMaximized() {
    return !!mainWindow?.isMaximized();
}
