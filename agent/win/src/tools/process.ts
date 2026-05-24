import { runCommand } from './shell'
import { PS, psStr, parsePsJson } from './shared/powershell'

export async function processList(workspaceRoot: string, args: any = {}) {
  const filter = String(args.filter || args.name || '')
  let cmd = `${PS} "Get-Process | Select-Object @{N='pid';E={$_.Id}},@{N='name';E={$_.Name}},@{N='cpu';E={[Math]::Round($_.CPU,2)}},@{N='mem_mb';E={[Math]::Round($_.WorkingSet/1MB,1)}}`
  if (filter) cmd += ` | Where-Object {$_.name -like '*${psStr(filter)}*'}`
  cmd += ' | ConvertTo-Json -Compress"'

  const result = await runCommand(workspaceRoot, { command: cmd })
  const processes: any[] = parsePsJson(result.stdout, [])
  return { success: true, count: processes.length, processes }
}

export async function processKill(workspaceRoot: string, args: any) {
  const name = String(args.name || '')
  const pid = args.pid ? Number(args.pid) : null
  if (!name && !pid) throw new Error('name or pid is required for process.kill')

  const command = pid
    ? `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
    : `${PS} "Stop-Process -Name '${psStr(name)}' -Force -ErrorAction SilentlyContinue"`

  const result = await runCommand(workspaceRoot, { command })
  return { success: result.exitCode === 0, name: name || null, pid: pid || null }
}
