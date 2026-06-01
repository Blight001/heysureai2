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
exports.OTHER_CAPABILITIES = exports.WINDOWS_CAPABILITIES = exports.IS_LINUX = exports.IS_MAC = exports.IS_WINDOWS = void 0;
exports.getCapabilities = getCapabilities;
exports.getPlatformInfo = getPlatformInfo;
const os = __importStar(require("os"));
exports.IS_WINDOWS = process.platform === 'win32';
exports.IS_MAC = process.platform === 'darwin';
exports.IS_LINUX = process.platform === 'linux';
exports.WINDOWS_CAPABILITIES = [
    'shell.run',
    'keyboard.type', 'keyboard.press',
    'mouse.move', 'mouse.click', 'mouse.double_click', 'mouse.right_click', 'mouse.scroll', 'mouse.drag',
    'clipboard.get', 'clipboard.set',
    'window.list', 'window.focus', 'window.close',
    'speech.speak',
    'vision.capture', 'vision.capture_mouse',
    'hands.start', 'hands.stop', 'hands.snapshot', 'hands.events', 'hands.mouse',
    'ear.start', 'ear.stop', 'ear.latest',
];
exports.OTHER_CAPABILITIES = [
    'shell.run',
];
function getCapabilities() {
    return exports.IS_WINDOWS ? exports.WINDOWS_CAPABILITIES : exports.OTHER_CAPABILITIES;
}
function getPlatformInfo() {
    return {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        hostname: os.hostname(),
        cpus: os.cpus().length,
        totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
    };
}
