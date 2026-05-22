import { runCommand } from './shell'

const PS = 'powershell.exe -NonInteractive -NoProfile -Command'

function psStr(value: string): string {
  if (value.includes('"')) throw new Error('Value must not contain double-quote characters')
  return value.replace(/'/g, "''")
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
  const pid  = args.pid ? Number(args.pid) : null
  if (!name && !pid) throw new Error('name or pid is required for process.kill')

  let command: string
  if (pid) {
    command = `${PS} "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`
  } else {
    command = `${PS} "Stop-Process -Name '${psStr(name)}' -Force -ErrorAction SilentlyContinue"`
  }
  const result = await runCommand(workspaceRoot, { command })
  return { success: result.exitCode === 0, name: name || null, pid: pid || null }
}
