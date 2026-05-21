import { runCommand } from './shell'

const PS = 'powershell.exe -NonInteractive -NoProfile -Command'

export async function windowList(workspaceRoot: string, args: any = {}) {
  const result = await runCommand(workspaceRoot, {
    command: `${PS} "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}},@{N='title';E={$_.MainWindowTitle}} | ConvertTo-Json -Compress"`,
  })
  let windows: any[] = []
  try {
    const parsed = JSON.parse(result.stdout || '[]')
    windows = Array.isArray(parsed) ? parsed : [parsed]
  } catch (_) {}
  return { success: true, count: windows.length, windows }
}

export async function windowFocus(workspaceRoot: string, args: any) {
  const title = String(args.title || '')
  if (!title) throw new Error('title is required for window.focus')
  const escaped = title.replace(/'/g, "''")
  const result = await runCommand(workspaceRoot, {
    command: `${PS} "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('${escaped}')"`,
  })
  return { success: result.exitCode === 0, title, stderr: result.stderr || '' }
}

export async function windowClose(workspaceRoot: string, args: any) {
  const title = String(args.title || '')
  const pid = args.pid ? Number(args.pid) : null
  if (!title && !pid) throw new Error('title or pid is required for window.close')

  let command: string
  if (pid) {
    command = `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
  } else {
    const escaped = title.replace(/'/g, "''")
    command = `${PS} "(Get-Process | Where-Object {$_.MainWindowTitle -eq '${escaped}'}) | Stop-Process -Force -ErrorAction SilentlyContinue"`
  }
  const result = await runCommand(workspaceRoot, { command })
  return { success: result.exitCode === 0, title, pid }
}
