"use strict";
// capture-bridge.ts - singleton bridge for screen capture IPC
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCaptureFn = registerCaptureFn;
exports.executeCapture = executeCapture;
let _captureFn = null;
function registerCaptureFn(fn) {
    _captureFn = fn;
}
async function executeCapture(args) {
    if (!_captureFn)
        throw new Error('Screen capture not initialized — capture bridge not registered');
    return _captureFn(args);
}
