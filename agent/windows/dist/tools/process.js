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
        throw new Error('name or pid is required for process termination');
    const target = pid
        ? `Get-Process -Id ${pid} -ErrorAction SilentlyContinue`
        : `Get-Process -Name ${(0, powershell_1.quotePsSingle)(name)} -ErrorAction SilentlyContinue`;
    const script = `
$errors = New-Object System.Collections.Generic.List[string]
$methods = New-Object System.Collections.Generic.List[string]
$targets = @(${target})
$matched = @($targets | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}})
foreach ($p in $targets) {
  try {
    Stop-Process -Id $p.Id -Force -ErrorAction Stop
    $methods.Add("Stop-Process:$($p.Id)")
  } catch {
    $errors.Add("Stop-Process:$($p.Id): $($_.Exception.Message)")
  }
}
Start-Sleep -Milliseconds 400
$alive = @(${target})
foreach ($p in $alive) {
  try {
    $taskkill = & taskkill.exe /PID $p.Id /T /F 2>&1
    $methods.Add("taskkill:$($p.Id)")
    if ($LASTEXITCODE -ne 0) { $errors.Add("taskkill:$($p.Id): $taskkill") }
  } catch {
    $errors.Add("taskkill:$($p.Id): $($_.Exception.Message)")
  }
}
Start-Sleep -Milliseconds 400
$remaining = @(${target} | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}})
[PSCustomObject]@{
  success = ($matched.Count -gt 0 -and $remaining.Count -eq 0)
  matched = @($matched)
  methods = @($methods)
  remaining = @($remaining)
  errors = @($errors)
} | ConvertTo-Json -Compress
`;
    const result = await (0, powershell_1.runPowerShellScript)(script, { cwd: workspaceRoot });
    const parsed = (0, powershell_1.parsePsJson)(result.stdout, []);
    const payload = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
        success: result.exitCode === 0 && !!payload?.success,
        name: name || null,
        pid: pid || null,
        matched: payload?.matched || [],
        methods: payload?.methods || [],
        remaining: payload?.remaining || [],
        errors: payload?.errors || (result.stderr ? [result.stderr] : []),
    };
}
