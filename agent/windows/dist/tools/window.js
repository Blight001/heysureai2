"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.windowList = windowList;
exports.windowFocus = windowFocus;
exports.windowClose = windowClose;
const shell_1 = require("./shell");
const powershell_1 = require("./shared/powershell");
// `Get-Process | Where MainWindowTitle -ne ''` was unreliable — many top-level
// windows (browsers, Electron apps, Office) leave MainWindowTitle empty when
// queried from a foreign session. EnumWindows + GetWindowText is what
// shell.run/PowerShell users already verified works, so we use that directly
// via P/Invoke from a temp .ps1 file.
const ENUM_WINDOWS_SCRIPT = `Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class HSWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$results = New-Object System.Collections.Generic.List[Object]
$callback = [HSWin+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if ([HSWin]::IsWindowVisible($hWnd)) {
    $len = [HSWin]::GetWindowTextLength($hWnd)
    if ($len -gt 0) {
      $sb = New-Object System.Text.StringBuilder ($len + 1)
      [void][HSWin]::GetWindowText($hWnd, $sb, $sb.Capacity)
      $processId = 0
      [void][HSWin]::GetWindowThreadProcessId($hWnd, [ref]$processId)
      $procName = ''
      try { $procName = (Get-Process -Id $processId -ErrorAction Stop).Name } catch {}
      $results.Add([PSCustomObject]@{
        hwnd  = $hWnd.ToInt64()
        pid   = [int]$processId
        title = $sb.ToString()
        name  = $procName
      })
    }
  }
  return $true
}
[void][HSWin]::EnumWindows($callback, [IntPtr]::Zero)
$results | ConvertTo-Json -Compress
`;
async function windowList(workspaceRoot, _args = {}) {
    const result = await (0, powershell_1.runPowerShellScript)(ENUM_WINDOWS_SCRIPT, { cwd: workspaceRoot });
    if (result.exitCode !== 0) {
        return { success: false, count: 0, windows: [], stderr: result.stderr || 'window listing failed' };
    }
    const windows = (0, powershell_1.parsePsJson)(result.stdout, []);
    return { success: true, count: windows.length, windows };
}
async function windowFocus(workspaceRoot, args) {
    const title = String(args.title || '');
    if (!title)
        throw new Error('title is required for window.focus');
    const esc = (0, powershell_1.psStr)(title);
    const result = await (0, shell_1.runCommand)(workspaceRoot, {
        command: `${powershell_1.PS} "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('${esc}')"`,
    });
    return { success: result.exitCode === 0, title, stderr: result.stderr || '' };
}
async function windowClose(workspaceRoot, args) {
    const title = String(args.title || '');
    const hwnd = args.hwnd ? Number(args.hwnd) : null;
    const pid = args.pid ? Number(args.pid) : null;
    if (!title && !pid && !hwnd)
        throw new Error('title, hwnd, or pid is required for window.close');
    const script = `Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class HSCloseWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@
$WM_CLOSE = 0x0010
$titleNeedle = ${(0, powershell_1.quotePsSingle)(title)}
$pidNeedle = ${pid || 0}
$hwndNeedle = ${hwnd || 0}
$matches = New-Object System.Collections.Generic.List[Object]
$errors = New-Object System.Collections.Generic.List[string]
$methods = New-Object System.Collections.Generic.List[string]
$callback = [HSCloseWin+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  if ([HSCloseWin]::IsWindowVisible($hWnd)) {
    $len = [HSCloseWin]::GetWindowTextLength($hWnd)
    $sb = New-Object System.Text.StringBuilder ([Math]::Max($len + 1, 256))
    [void][HSCloseWin]::GetWindowText($hWnd, $sb, $sb.Capacity)
    $processId = 0
    [void][HSCloseWin]::GetWindowThreadProcessId($hWnd, [ref]$processId)
    $windowTitle = $sb.ToString()
    $isMatch = $false
    if ($hwndNeedle -gt 0 -and $hWnd.ToInt64() -eq $hwndNeedle) { $isMatch = $true }
    if ($pidNeedle -gt 0 -and [int]$processId -eq $pidNeedle) { $isMatch = $true }
    if ($titleNeedle -and $windowTitle.IndexOf($titleNeedle, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $isMatch = $true }
    if ($isMatch) {
      $matches.Add([PSCustomObject]@{ hwnd = $hWnd.ToInt64(); pid = [int]$processId; title = $windowTitle })
    }
  }
  return $true
}
[void][HSCloseWin]::EnumWindows($callback, [IntPtr]::Zero)
foreach ($w in $matches) {
  try {
    [void][HSCloseWin]::PostMessage([IntPtr]$w.hwnd, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
    $methods.Add("WM_CLOSE:$($w.hwnd)")
  } catch {
    $errors.Add("WM_CLOSE:$($w.hwnd): $($_.Exception.Message)")
  }
}
Start-Sleep -Milliseconds 800
$remainingPids = @($matches | ForEach-Object { $_.pid } | Sort-Object -Unique)
foreach ($targetPid in $remainingPids) {
  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($p) {
    try {
      if ($p.CloseMainWindow()) { $methods.Add("CloseMainWindow:$targetPid") }
    } catch {
      $errors.Add("CloseMainWindow:\${targetPid}: $($_.Exception.Message)")
    }
  }
}
Start-Sleep -Milliseconds 800
foreach ($targetPid in $remainingPids) {
  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($p) {
    try {
      Stop-Process -Id $targetPid -Force -ErrorAction Stop
      $methods.Add("Stop-Process:$targetPid")
    } catch {
      $errors.Add("Stop-Process:\${targetPid}: $($_.Exception.Message)")
    }
  }
}
Start-Sleep -Milliseconds 400
foreach ($targetPid in $remainingPids) {
  $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
  if ($p) {
    try {
      $taskkill = & taskkill.exe /PID $targetPid /T /F 2>&1
      $methods.Add("taskkill:$targetPid")
      if ($LASTEXITCODE -ne 0) { $errors.Add("taskkill:\${targetPid}: $taskkill") }
    } catch {
      $errors.Add("taskkill:\${targetPid}: $($_.Exception.Message)")
    }
  }
}
Start-Sleep -Milliseconds 400
$remaining = @($remainingPids | ForEach-Object {
  $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
  if ($p) { [PSCustomObject]@{ pid = $p.Id; name = $p.Name } }
})
$matchedOut = @($matches | ForEach-Object { $_ })
$methodsOut = @($methods | ForEach-Object { $_ })
$errorsOut = @($errors | ForEach-Object { $_ })
[PSCustomObject]@{
  success = ($matchedOut.Count -gt 0 -and $remaining.Count -eq 0)
  matched = $matchedOut
  methods = $methodsOut
  remaining = @($remaining)
  errors = $errorsOut
} | ConvertTo-Json -Compress
`;
    const result = await (0, powershell_1.runPowerShellScript)(script, { cwd: workspaceRoot });
    const parsed = (0, powershell_1.parsePsJson)(result.stdout, []);
    const payload = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
        success: result.exitCode === 0 && !!payload?.success,
        title: title || null,
        hwnd: hwnd || null,
        pid: pid || null,
        matched: payload?.matched || [],
        methods: payload?.methods || [],
        remaining: payload?.remaining || [],
        errors: payload?.errors || (result.stderr ? [result.stderr] : []),
    };
}
