"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processList = processList;
exports.processKill = processKill;
const shell_1 = require("./shell");
const PS = 'powershell.exe -NonInteractive -NoProfile -Command';
function psStr(value) {
    if (value.includes('"'))
        throw new Error('Value must not contain double-quote characters');
    return value.replace(/'/g, "''");
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
async function processList(workspaceRoot, args = {}) {
    const filter = String(args.filter || args.name || '');
    let cmd = `${PS} "Get-Process | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}},@{N='cpu';E={[Math]::Round($_.CPU,2)}},@{N='mem_mb';E={[Math]::Round($_.WorkingSet/1MB,1)}}`;
    if (filter)
        cmd += ` | Where-Object {$_.name -like '*${psStr(filter)}*'}`;
    cmd += ' | ConvertTo-Json -Compress"';
    const result = await (0, shell_1.runCommand)(workspaceRoot, { command: cmd });
    const processes = parsePsJson(result.stdout, []);
    return { success: true, count: processes.length, processes };
}
async function processKill(workspaceRoot, args) {
    const name = String(args.name || '');
    const pid = args.pid ? Number(args.pid) : null;
    if (!name && !pid)
        throw new Error('name or pid is required for process.kill');
    let command;
    if (pid) {
        command = `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`;
    }
    else {
        command = `${PS} "Stop-Process -Name '${psStr(name)}' -Force -ErrorAction SilentlyContinue"`;
    }
    const result = await (0, shell_1.runCommand)(workspaceRoot, { command });
    return { success: result.exitCode === 0, name: name || null, pid: pid || null };
}
