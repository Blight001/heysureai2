import { runCommand } from './shell'
import { PS, psStr, parsePsJson } from './shared/powershell'

export async function windowList(workspaceRoot: string, _args: any = {}) {
  const result = await runCommand(workspaceRoot, {
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
  const pid = args.pid ? Number(args.pid) : null
  if (!title && !pid) throw new Error('title or pid is required for window.close')

  const command = pid
    ? `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
    : `${PS} "(Get-Process | Where-Object {$_.MainWindowTitle -eq '${psStr(title)}'}) | Stop-Process -Force -ErrorAction SilentlyContinue"`

  const result = await runCommand(workspaceRoot, { command })
  return { success: result.exitCode === 0, title, pid }
}
