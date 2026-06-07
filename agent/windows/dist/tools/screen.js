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
const url_1 = require("url");
const pngjs_1 = require("pngjs");
const capture_bridge_1 = require("../capture-bridge");
const coordinates_1 = require("./shared/coordinates");
const VISION_MAX_WIDTH = 1920;
const VISION_MAX_HEIGHT = 1080;
function pngDataUrl(buf) {
    return `data:image/png;base64,${buf.toString('base64')}`;
}
function resizePngToFit(buf, maxWidth = VISION_MAX_WIDTH, maxHeight = VISION_MAX_HEIGHT) {
    const src = pngjs_1.PNG.sync.read(buf);
    const originalWidth = src.width;
    const originalHeight = src.height;
    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
        return {
            buffer: buf,
            width: originalWidth,
            height: originalHeight,
            originalWidth,
            originalHeight,
            scaleX: 1,
            scaleY: 1,
            resized: false,
        };
    }
    const scale = Math.min(maxWidth / originalWidth, maxHeight / originalHeight);
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const out = new pngjs_1.PNG({ width, height });
    for (let y = 0; y < height; y++) {
        const srcY = Math.min(originalHeight - 1, Math.max(0, (y + 0.5) / height * originalHeight - 0.5));
        const y0 = Math.floor(srcY);
        const y1 = Math.min(originalHeight - 1, y0 + 1);
        const wy = srcY - y0;
        for (let x = 0; x < width; x++) {
            const srcX = Math.min(originalWidth - 1, Math.max(0, (x + 0.5) / width * originalWidth - 0.5));
            const x0 = Math.floor(srcX);
            const x1 = Math.min(originalWidth - 1, x0 + 1);
            const wx = srcX - x0;
            const outIdx = (width * y + x) << 2;
            const i00 = (originalWidth * y0 + x0) << 2;
            const i10 = (originalWidth * y0 + x1) << 2;
            const i01 = (originalWidth * y1 + x0) << 2;
            const i11 = (originalWidth * y1 + x1) << 2;
            for (let c = 0; c < 4; c++) {
                const top = src.data[i00 + c] * (1 - wx) + src.data[i10 + c] * wx;
                const bottom = src.data[i01 + c] * (1 - wx) + src.data[i11 + c] * wx;
                out.data[outIdx + c] = Math.round(top * (1 - wy) + bottom * wy);
            }
        }
    }
    return {
        buffer: pngjs_1.PNG.sync.write(out),
        width,
        height,
        originalWidth,
        originalHeight,
        scaleX: width / originalWidth,
        scaleY: height / originalHeight,
        resized: true,
    };
}
function wantsServerSave(args) {
    // send_to_user implies the capture must be persisted server-side so the bot
    // has a path/URL to deliver to the user.
    return args?.save_to_server === true || args?.upload_to_server === true || wantsSendToUser(args);
}
function wantsSendToUser(args) {
    const values = [args?.send_to_user, args?.bot_send_to_user, args?.deliver_to_user]
        .filter((value) => value !== undefined);
    if (values.some((value) => value === true))
        return true;
    if (values.some((value) => value === false))
        return false;
    return true;
}
function wantsLocalSave(args) {
    return !!args?.path || args?.save_local === true || args?.save_to_file === true;
}
function saveLocalPng(args, prefix, buf) {
    if (!wantsLocalSave(args))
        return {};
    const savePath = String(args.path || path.join(os.tmpdir(), `${prefix}_${Date.now()}.png`));
    fs.writeFileSync(savePath, buf);
    return { path: savePath, image_url: (0, url_1.pathToFileURL)(savePath).href };
}
async function screenCapture(args = {}) {
    const displayIndex = Number(args.display || args.screen || 0);
    const buf = await (0, capture_bridge_1.executeCapture)({ displayIndex });
    const scaled = resizePngToFit(buf);
    const outBuf = scaled.buffer;
    const { width, height } = scaled;
    const displayGeometry = (0, capture_bridge_1.getCaptureDisplayGeometry)(displayIndex);
    (0, coordinates_1.rememberCaptureGeometry)({ capture: { width, height }, display: displayGeometry });
    return {
        success: true,
        ...saveLocalPng(args, 'hs_screen', outBuf),
        save_to_server: wantsServerSave(args),
        send_to_user: wantsSendToUser(args),
        dataUrl: pngDataUrl(outBuf),
        width,
        height,
        original_width: scaled.originalWidth,
        original_height: scaled.originalHeight,
        vision_resize: {
            resized: scaled.resized,
            max_width: VISION_MAX_WIDTH,
            max_height: VISION_MAX_HEIGHT,
            scale_x: scaled.scaleX,
            scale_y: scaled.scaleY,
            note: scaled.resized
                ? '截图内容已缩放到 1920x1080 以内发送给 AI；mouse.* 输入该缩放截图坐标时会自动换算到真实屏幕坐标。'
                : '截图内容未缩放；mouse.* 输入截图坐标时会按当前屏幕标定换算。',
        },
        bytes: outBuf.length,
        original_bytes: buf.length,
        display: displayIndex,
        calibration: {
            display: displayGeometry,
            scale_x: width > 0 ? displayGeometry.bounds.width / width : 1,
            scale_y: height > 0 ? displayGeometry.bounds.height / height : 1,
        },
    };
}
async function screenCaptureRegion(args) {
    const { x = 0, y = 0, width, height } = args;
    if (!width || !height)
        throw new Error('width and height are required for region capture');
    const buf = await (0, capture_bridge_1.executeCapture)({ cropRegion: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) } });
    const scaled = resizePngToFit(buf);
    const outBuf = scaled.buffer;
    return {
        success: true,
        ...saveLocalPng(args, 'hs_region', outBuf),
        save_to_server: wantsServerSave(args),
        send_to_user: wantsSendToUser(args),
        dataUrl: pngDataUrl(outBuf),
        x,
        y,
        width: scaled.width,
        height: scaled.height,
        original_width: scaled.originalWidth,
        original_height: scaled.originalHeight,
        vision_resize: {
            resized: scaled.resized,
            max_width: VISION_MAX_WIDTH,
            max_height: VISION_MAX_HEIGHT,
            scale_x: scaled.scaleX,
            scale_y: scaled.scaleY,
            note: scaled.resized
                ? '局部截图内容已缩放到 1920x1080 以内发送给 AI。'
                : '局部截图内容未缩放。',
        },
        bytes: outBuf.length,
        original_bytes: buf.length,
    };
}
async function screenInfo(_args = {}) {
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
        calibration: (0, coordinates_1.getCoordinateCalibration)(),
    };
}
