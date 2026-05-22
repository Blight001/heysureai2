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
exports.screenCapture = screenCapture;
exports.screenCaptureRegion = screenCaptureRegion;
exports.screenInfo = screenInfo;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const capture_bridge_1 = require("../capture-bridge");
async function screenCapture(args = {}) {
    const displayIndex = Number(args.display || args.screen || 0);
    const buf = await (0, capture_bridge_1.executeCapture)({ displayIndex });
    const savePath = String(args.path || path.join(os.tmpdir(), `hs_screen_${Date.now()}.png`));
    fs.writeFileSync(savePath, buf);
    const size = { width: 0, height: 0 };
    // Parse PNG dimensions from buffer (bytes 16-23 of IHDR chunk)
    if (buf.length > 24) {
        size.width = buf.readUInt32BE(16);
        size.height = buf.readUInt32BE(20);
    }
    return {
        success: true,
        path: savePath,
        width: size.width,
        height: size.height,
        bytes: buf.length,
        display: displayIndex,
    };
}
async function screenCaptureRegion(args) {
    const { x = 0, y = 0, width, height } = args;
    if (!width || !height)
        throw new Error('width and height are required for screen.capture_region');
    // Full screen capture first, then crop via nativeImage (done in main process IPC handler)
    const buf = await (0, capture_bridge_1.executeCapture)({ cropRegion: { x, y, width, height } });
    const savePath = String(args.path || path.join(os.tmpdir(), `hs_region_${Date.now()}.png`));
    fs.writeFileSync(savePath, buf);
    return { success: true, path: savePath, x, y, width, height, bytes: buf.length };
}
async function screenInfo(args = {}) {
    // This is called from executor which has access to the electron screen module via IPC
    // We return a placeholder and let executor enrich it
    let robot = null;
    try {
        robot = require('robotjs');
    }
    catch (_) { }
    const screenSize = robot ? robot.getScreenSize() : { width: 1920, height: 1080 };
    const mousePos = robot ? robot.getMousePos() : { x: 0, y: 0 };
    return {
        success: true,
        screen: { width: screenSize.width, height: screenSize.height },
        cursor: { x: mousePos.x, y: mousePos.y },
    };
}
