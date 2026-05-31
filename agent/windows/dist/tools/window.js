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
exports.windowList = windowList;
exports.windowFocus = windowFocus;
exports.windowClose = windowClose;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
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
`;
let cachedScriptPath = null;
function ensureScriptOnDisk() {
    if (cachedScriptPath && fs.existsSync(cachedScriptPath))
        return cachedScriptPath;
    const scriptPath = path.join(os.tmpdir(), 'heysure-window-list.ps1');
    fs.writeFileSync(scriptPath, ENUM_WINDOWS_SCRIPT, 'utf8');
    cachedScriptPath = scriptPath;
    return scriptPath;
}
async function windowList(workspaceRoot, _args = {}) {
    const scriptPath = ensureScriptOnDisk();
    const result = await (0, shell_1.runCommand)(workspaceRoot, {
        command: `powershell.exe -NonInteractive -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
    });
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
    const pid = args.pid ? Number(args.pid) : null;
    if (!title && !pid)
        throw new Error('title or pid is required for window.close');
    const command = pid
        ? `${powershell_1.PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
        : `${powershell_1.PS} "(Get-Process | Where-Object {$_.MainWindowTitle -eq '${(0, powershell_1.psStr)(title)}'}) | Stop-Process -Force -ErrorAction SilentlyContinue"`;
    const result = await (0, shell_1.runCommand)(workspaceRoot, { command });
    return { success: result.exitCode === 0, title, pid };
}
