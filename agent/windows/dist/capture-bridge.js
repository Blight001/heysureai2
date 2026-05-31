"use strict";
// Screen capture using Electron's main-process desktopCapturer + screen modules.
//
// The previous implementation hosted a hidden BrowserWindow and called
// `require('electron').screen` from the renderer. In Electron 17+ both
// `screen` and `desktopCapturer` are main-process-only, so the renderer
// approach failed at runtime with "screen.getPrimaryDisplay is not a
// function". Running directly in main removes the IPC hop entirely.
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCapture = executeCapture;
exports.initCapture = initCapture;
const electron_1 = require("electron");
const constants_1 = require("./constants");
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
        promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
}
async function executeCapture(opts = {}) {
    const displays = electron_1.screen.getAllDisplays();
    const requested = opts.displayIndex ?? 0;
    const idx = displays.length > 0
        ? Math.min(Math.max(requested, 0), displays.length - 1)
        : 0;
    const display = displays[idx] || electron_1.screen.getPrimaryDisplay();
    // Default to native pixel resolution so screenshots aren't downscaled.
    const w = opts.width ?? Math.round(display.size.width * display.scaleFactor);
    const h = opts.height ?? Math.round(display.size.height * display.scaleFactor);
    const sources = await withTimeout(electron_1.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: w, height: h },
    }), constants_1.SCREENSHOT_TIMEOUT_MS, 'Screenshot');
    if (sources.length === 0)
        throw new Error('No screen sources available');
    // Prefer the source whose display_id matches the requested display; fall
    // back to positional index, then to the first source.
    const source = sources.find(s => s.display_id === String(display.id))
        || sources[idx]
        || sources[0];
    let img = source.thumbnail;
    if (opts.cropRegion)
        img = img.crop(opts.cropRegion);
    return img.toPNG();
}
function initCapture() {
    if (!electron_1.screen || typeof electron_1.screen.getPrimaryDisplay !== 'function') {
        throw new Error('Electron screen module unavailable in main process');
    }
    if (!electron_1.desktopCapturer || typeof electron_1.desktopCapturer.getSources !== 'function') {
        throw new Error('Electron desktopCapturer unavailable in main process');
    }
}
