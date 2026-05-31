"use strict";
// Hidden BrowserWindow that performs `desktopCapturer` calls.
// The Electron main process can't use desktopCapturer directly with full
// fidelity, so we host a 1x1 invisible renderer that does the work and
// streams PNG bytes back over ipc-message.
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
exports.setupCaptureWindow = setupCaptureWindow;
const electron_1 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const constants_1 = require("../constants");
const capture_bridge_1 = require("../capture-bridge");
const CAPTURE_HTML = `<!DOCTYPE html>
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
let captureWindow = null;
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
    const tmpHtml = path.join(electron_1.app.getPath('temp'), 'hs-capture.html');
    fs.writeFileSync(tmpHtml, CAPTURE_HTML, 'utf8');
    await captureWindow.loadFile(tmpHtml);
    const pending = [];
    captureWindow.webContents.on('ipc-message', (_event, channel, ...args) => {
        if (channel === 'capture-done' && pending.length > 0) {
            pending.shift().resolve(Buffer.from(args[0]));
        }
        else if (channel === 'capture-error' && pending.length > 0) {
            pending.shift().reject(new Error(args[0]));
        }
    });
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
    return captureWindow;
}
