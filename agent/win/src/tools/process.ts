import { runCommand } from './shell'

const PS = 'powershell.exe -NonInteractive -NoProfile -Command'

export async function processList(workspaceRoot: string, args: any = {}) {
  const filter = String(args.filter || args.name || '')
  let cmd = `${PS} "Get-Process | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}},@{N='cpu';E={[Math]::Round($_.CPU,2)}},@{N='mem_mb';E={[Math]::Round($_.WorkingSet/1MB,1)}}`
  if (filter) cmd += ` | Where-Object {$_.name -like '*${filter.replace(/'/g, "''")}*'}`
  cmd += ' | ConvertTo-Json -Compress"'

  const result = await runCommand(workspaceRoot, { command: cmd })
  let processes: any[] = []
  try {
    const parsed = JSON.parse(result.stdout || '[]')
    processes = Array.isArray(parsed) ? parsed : [parsed]
  } catch (_) {}
  return { success: true, count: processes.length, processes }
}

export async function processKill(workspaceRoot: string, args: any) {
  const name = String(args.name || '')
  const pid = args.pid ? Number(args.pid) : null
  if (!name && !pid) throw new Error('name or pid is required for process.kill')

  let command: string
  if (pid) {
    command = `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
  } else {
    const escaped = name.replace(/'/g, "''")
    command = `${PS} "Stop-Process -Name '${escaped}' -Force -ErrorAction SilentlyContinue"`
  }
  const result = await runCommand(workspaceRoot, { command })
  return { success: result.exitCode === 0, name: name || null, pid: pid || null }
}
