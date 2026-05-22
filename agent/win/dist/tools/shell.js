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
exports.runCommand = runCommand;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const constants_1 = require("../constants");
function runCommand(workspaceRoot, args) {
    const cmd = String(args.command || '');
    if (!cmd)
        throw new Error('command is required');
    const cwd = args.cwd ? path.resolve(workspaceRoot, args.cwd) : workspaceRoot;
    const timeout = Number(args.timeoutMs || args.timeout_ms || constants_1.SHELL_TIMEOUT_MS);
    return new Promise(resolve => {
        const shellOpts = process.platform === 'win32' ? { shell: 'cmd.exe' } : {};
        (0, child_process_1.exec)(cmd, { cwd, timeout, maxBuffer: constants_1.SHELL_MAX_BUFFER_BYTES, ...shellOpts }, (err, stdout, stderr) => {
            const timedOut = !!err?.killed;
            const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
            resolve({
                command: cmd, cwd,
                exitCode,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                timedOut,
            });
        });
    });
}
