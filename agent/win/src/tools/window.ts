import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runCommand } from './shell'
import { PS, psStr, parsePsJson } from './shared/powershell'

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
        hwnd  = [int64]$hWnd
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
`

let cachedScriptPath: string | null = null

function ensureScriptOnDisk(): string {
  if (cachedScriptPath && fs.existsSync(cachedScriptPath)) return cachedScriptPath
  const scriptPath = path.join(os.tmpdir(), 'heysure-window-list.ps1')
  fs.writeFileSync(scriptPath, ENUM_WINDOWS_SCRIPT, 'utf8')
  cachedScriptPath = scriptPath
  return scriptPath
}

export async function windowList(workspaceRoot: string, _args: any = {}) {
  const scriptPath = ensureScriptOnDisk()
  const result = await runCommand(workspaceRoot, {
    command: `powershell.exe -NonInteractive -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
  })
  const windows: any[] = parsePsJson(result.stdout, [])
  return { success: true, count: windows.length, windows }
}

export async function windowFocus(workspaceRoot: string, args: any) {
  const title = String(args.title || '')
  if (!title) throw new Error('title is required for window.focus')
  const esc = psStr(title)
  const result = await runCommand(workspaceRoot, {
    command: `${PS} "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('${esc}')"`,
  })
  return { success: result.exitCode === 0, title, stderr: result.stderr || '' }
}

export async function windowClose(workspaceRoot: string, args: any) {
  const title = String(args.title || '')
  const pid = args.pid ? Number(args.pid) : null
  if (!title && !pid) throw new Error('title or pid is required for window.close')

  const command = pid
    ? `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
    : `${PS} "(Get-Process | Where-Object {$_.MainWindowTitle -eq '${psStr(title)}'}) | Stop-Process -Force -ErrorAction SilentlyContinue"`

  const result = await runCommand(workspaceRoot, { command })
  return { success: result.exitCode === 0, title, pid }
}
