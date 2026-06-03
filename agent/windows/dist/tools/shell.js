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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const constants_1 = require("../constants");
const powershell_1 = require("./shared/powershell");
function resolveCwd(workspaceRoot, raw) {
    if (!raw)
        return workspaceRoot;
    const text = String(raw).trim();
    if (!text || text === '.')
        return workspaceRoot;
    return path.isAbsolute(text) ? path.resolve(text) : path.resolve(workspaceRoot, text);
}
function resolveShellOptions(args) {
    const command = String(args.command || '');
    const shell = String(args.shell || args.shell_type || '').trim().toLowerCase();
    if (process.platform !== 'win32')
        return { command };
    if (shell === 'powershell' || shell === 'ps') {
        return {
            command: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${(0, powershell_1.encodePowerShellScript)(command)}`,
            shell: 'cmd.exe',
        };
    }
    if (shell === 'pwsh') {
        return {
            command: `pwsh.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${(0, powershell_1.encodePowerShellScript)(command)}`,
            shell: 'cmd.exe',
        };
    }
    return { command, shell: 'cmd.exe' };
}
function runCommand(workspaceRoot, args) {
    const cmd = String(args.command || '');
    if (!cmd)
        throw new Error('command is required');
    const cwd = resolveCwd(workspaceRoot, args.cwd);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        throw new Error(`cwd does not exist or is not a directory: ${cwd}`);
    }
    const timeout = Number(args.timeoutMs || args.timeout_ms || constants_1.SHELL_TIMEOUT_MS);
    const shell = resolveShellOptions(args);
    return new Promise(resolve => {
        const shellOpts = shell.shell ? { shell: shell.shell } : {};
        (0, child_process_1.exec)(shell.command, { cwd, timeout, maxBuffer: constants_1.SHELL_MAX_BUFFER_BYTES, ...shellOpts }, (err, stdout, stderr) => {
            const timedOut = !!err?.killed;
            const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
            resolve({
                command: cmd,
                cwd,
                shell: args.shell || (process.platform === 'win32' ? 'cmd' : 'default'),
                exitCode,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                timedOut,
            });
        });
    });
}
