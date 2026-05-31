"use strict";
// Helpers for invoking PowerShell from Node and parsing its JSON output.
// The encoded-command helpers are used for long-running background workers
// and scripts that contain arbitrary text payloads.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PS = void 0;
exports.psStr = psStr;
exports.parsePsJson = parsePsJson;
exports.encodePowerShellScript = encodePowerShellScript;
exports.quotePsSingle = quotePsSingle;
exports.runPowerShellScript = runPowerShellScript;
exports.spawnPowerShellScript = spawnPowerShellScript;
const child_process_1 = require("child_process");
exports.PS = 'powershell.exe -NonInteractive -NoProfile -Command';
// Escape a value for safe embedding in a PowerShell single-quoted string
// that is itself wrapped in cmd.exe double quotes. Reject values containing
// double quotes since they would break the outer cmd quoting layer.
function psStr(value) {
    if (value.includes('"')) {
        throw new Error('Value must not contain double-quote characters');
    }
    return value.replace(/'/g, "''");
}
// Parse output produced by ConvertTo-Json. PowerShell emits a bare object
// when there is exactly one result and an array otherwise — normalize to array.
function parsePsJson(stdout, fallback) {
    if (!stdout)
        return fallback;
    try {
        const parsed = JSON.parse(stdout);
        return Array.isArray(parsed) ? parsed : [parsed];
    }
    catch {
        return fallback;
    }
}
function encodePowerShellScript(script) {
    return Buffer.from(script, 'utf16le').toString('base64');
}
function quotePsSingle(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}
function runPowerShellScript(script, options = {}) {
    return new Promise(resolve => {
        const child = (0, child_process_1.spawn)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellScript(script)], { windowsHide: true, ...options });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', err => {
            stderr += err.message;
            resolve({ exitCode: 1, stdout: stdout.trim(), stderr: stderr.trim() });
        });
        child.on('close', code => {
            resolve({
                exitCode: typeof code === 'number' ? code : 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
            });
        });
    });
}
function spawnPowerShellScript(script, options = {}) {
    return (0, child_process_1.spawn)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellScript(script)], { windowsHide: true, ...options });
}
