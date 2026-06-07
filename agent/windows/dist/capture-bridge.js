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
exports.getCaptureDisplayGeometry = getCaptureDisplayGeometry;
exports.initCapture = initCapture;
const electron_1 = require("electron");
const constants_1 = require("./constants");
function robotScreenSize() {
    try {
        const robot = require('robotjs');
        const size = robot.getScreenSize?.();
        const width = Math.round(Number(size?.width));
        const height = Math.round(Number(size?.height));
        if (width > 0 && height > 0)
            return { width, height };
    }
    catch {
        // robotjs may be unavailable in non-desktop test environments.
    }
    return null;
}
function defaultCaptureSize(display, displayCount) {
    const robotSize = robotScreenSize();
    if (robotSize && displayCount <= 1)
        return robotSize;
    return {
        width: Math.round(display.bounds.width),
        height: Math.round(display.bounds.height),
    };
}
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
    // Keep screenshots in the same coordinate space used by robotjs mouse APIs.
    // This avoids DPI scaling mismatches where native screenshots are larger than
    // the coordinates accepted by mouse.click.
    const defaultSize = defaultCaptureSize(display, displays.length);
    const w = opts.width ?? defaultSize.width;
    const h = opts.height ?? defaultSize.height;
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
function getCaptureDisplayGeometry(displayIndex = 0) {
    const displays = electron_1.screen.getAllDisplays();
    const idx = displays.length > 0
        ? Math.min(Math.max(displayIndex, 0), displays.length - 1)
        : 0;
    const display = displays[idx] || electron_1.screen.getPrimaryDisplay();
    return {
        id: display.id,
        scaleFactor: display.scaleFactor,
        bounds: {
            x: display.bounds.x,
            y: display.bounds.y,
            width: display.bounds.width,
            height: display.bounds.height,
        },
        size: {
            width: display.size.width,
            height: display.size.height,
        },
    };
}
function initCapture() {
    if (!electron_1.screen || typeof electron_1.screen.getPrimaryDisplay !== 'function') {
        throw new Error('Electron screen module unavailable in main process');
    }
    if (!electron_1.desktopCapturer || typeof electron_1.desktopCapturer.getSources !== 'function') {
        throw new Error('Electron desktopCapturer unavailable in main process');
    }
}
