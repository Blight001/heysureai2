import { runCommand } from './shell'

const PS = 'powershell.exe -NonInteractive -NoProfile -Command'

// Validate and escape a value for use in a PowerShell single-quoted string passed
// through cmd.exe. Rejects values with double-quote characters that would break the
// outer cmd.exe quoting layer.
function psStr(value: string): string {
  if (value.includes('"')) throw new Error('Value must not contain double-quote characters')
  return value.replace(/'/g, "''") // escape PS single-quote inside single-quoted PS string
}

function parsePsJson<T>(stdout: string, fallback: T): T {
  if (!stdout) return fallback
  try {
    const parsed = JSON.parse(stdout)
    return Array.isArray(parsed) ? parsed as T : ([parsed] as T)
  } catch {
    return fallback
  }
}

export async function windowList(_workspaceRoot: string, args: any = {}) {
  const result = await runCommand(_workspaceRoot, {
    command: `${PS} "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}},@{N='title';E={$_.MainWindowTitle}} | ConvertTo-Json -Compress"`,
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
  const pid   = args.pid ? Number(args.pid) : null
  if (!title && !pid) throw new Error('title or pid is required for window.close')

  let command: string
  if (pid) {
    command = `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
  } else {
    const esc = psStr(title)
    command = `${PS} "(Get-Process | Where-Object {$_.MainWindowTitle -eq '${esc}'}) | Stop-Process -Force -ErrorAction SilentlyContinue"`
  }
  const result = await runCommand(workspaceRoot, { command })
  return { success: result.exitCode === 0, title, pid }
}
