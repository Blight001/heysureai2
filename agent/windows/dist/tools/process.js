"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processList = processList;
exports.processKill = processKill;
const shell_1 = require("./shell");
const powershell_1 = require("./shared/powershell");
async function processList(workspaceRoot, args = {}) {
    const filter = String(args.filter || args.name || '');
    let cmd = `${powershell_1.PS} "Get-Process | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}},@{N='cpu';E={[Math]::Round($_.CPU,2)}},@{N='mem_mb';E={[Math]::Round($_.WorkingSet/1MB,1)}}`;
    if (filter)
        cmd += ` | Where-Object {$_.name -like '*${(0, powershell_1.psStr)(filter)}*'}`;
    cmd += ' | ConvertTo-Json -Compress"';
    const result = await (0, shell_1.runCommand)(workspaceRoot, { command: cmd });
    const processes = (0, powershell_1.parsePsJson)(result.stdout, []);
    return { success: true, count: processes.length, processes };
}
async function processKill(workspaceRoot, args) {
    const name = String(args.name || '');
    const pid = args.pid ? Number(args.pid) : null;
    if (!name && !pid)
        throw new Error('name or pid is required for process.kill');
    const command = pid
        ? `${powershell_1.PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
        : `${powershell_1.PS} "Stop-Process -Name '${(0, powershell_1.psStr)(name)}' -Force -ErrorAction SilentlyContinue"`;
    const result = await (0, shell_1.runCommand)(workspaceRoot, { command });
    return { success: result.exitCode === 0, name: name || null, pid: pid || null };
}
