"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.windowList = windowList;
exports.windowFocus = windowFocus;
exports.windowClose = windowClose;
const shell_1 = require("./shell");
const PS = 'powershell.exe -NonInteractive -NoProfile -Command';
// Validate and escape a value for use in a PowerShell single-quoted string passed
// through cmd.exe. Rejects values with double-quote characters that would break the
// outer cmd.exe quoting layer.
function psStr(value) {
    if (value.includes('"'))
        throw new Error('Value must not contain double-quote characters');
    return value.replace(/'/g, "''"); // escape PS single-quote inside single-quoted PS string
}
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
async function windowList(_workspaceRoot, args = {}) {
    const result = await (0, shell_1.runCommand)(_workspaceRoot, {
        command: `${PS} "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}},@{N='title';E={$_.MainWindowTitle}} | ConvertTo-Json -Compress"`,
    });
    const windows = parsePsJson(result.stdout, []);
    return { success: true, count: windows.length, windows };
}
async function windowFocus(workspaceRoot, args) {
    const title = String(args.title || '');
    if (!title)
        throw new Error('title is required for window.focus');
    const esc = psStr(title);
    const result = await (0, shell_1.runCommand)(workspaceRoot, {
        command: `${PS} "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('${esc}')"`,
    });
    return { success: result.exitCode === 0, title, stderr: result.stderr || '' };
}
async function windowClose(workspaceRoot, args) {
    const title = String(args.title || '');
    const pid = args.pid ? Number(args.pid) : null;
    if (!title && !pid)
        throw new Error('title or pid is required for window.close');
    let command;
    if (pid) {
        command = `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`;
    }
    else {
        const esc = psStr(title);
        command = `${PS} "(Get-Process | Where-Object {$_.MainWindowTitle -eq '${esc}'}) | Stop-Process -Force -ErrorAction SilentlyContinue"`;
    }
    const result = await (0, shell_1.runCommand)(workspaceRoot, { command });
    return { success: result.exitCode === 0, title, pid };
}
