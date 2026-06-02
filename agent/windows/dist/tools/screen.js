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
const capture_bridge_1 = require("../capture-bridge");
const coordinates_1 = require("./shared/coordinates");
function pngSize(buf) {
    if (buf.length <= 24)
        return { width: 0, height: 0 };
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
async function screenCapture(args = {}) {
    const displayIndex = Number(args.display || args.screen || 0);
    const buf = await (0, capture_bridge_1.executeCapture)({ displayIndex });
    const savePath = String(args.path || path.join(os.tmpdir(), `hs_screen_${Date.now()}.png`));
    fs.writeFileSync(savePath, buf);
    const { width, height } = pngSize(buf);
    const displayGeometry = (0, capture_bridge_1.getCaptureDisplayGeometry)(displayIndex);
    (0, coordinates_1.rememberCaptureGeometry)({ capture: { width, height }, display: displayGeometry });
    const image_url = (0, url_1.pathToFileURL)(savePath).href;
    return {
        success: true,
        path: savePath,
        image_url,
        width,
        height,
        bytes: buf.length,
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
    const savePath = String(args.path || path.join(os.tmpdir(), `hs_region_${Date.now()}.png`));
    fs.writeFileSync(savePath, buf);
    const image_url = (0, url_1.pathToFileURL)(savePath).href;
    return { success: true, path: savePath, image_url, x, y, width, height, bytes: buf.length };
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
