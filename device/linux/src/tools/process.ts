// Process listing / termination on Linux via the standard `ps` and `kill`
// utilities (always present), with `pkill` used for name-based kills.

import { runCmd, which } from './shared/command'

interface ProcInfo {
  pid: number
  name: string
  cpu: number
  mem_mb: number
}

// Parse `ps -eo pid=,comm=,%cpu=,rss=` output (rss is in KiB).
function parsePs(stdout: string, filter: string): ProcInfo[] {
  const needle = filter.toLowerCase()
  const out: ProcInfo[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(\d+)\s+(.+?)\s+([\d.]+)\s+(\d+)$/)
    if (!m) continue
    const name = m[2].trim()
    if (needle && !name.toLowerCase().includes(needle)) continue
    out.push({
      pid: parseInt(m[1], 10),
      name,
      cpu: Number(parseFloat(m[3]).toFixed(2)),
      mem_mb: Number((parseInt(m[4], 10) / 1024).toFixed(1)),
    })
  }
  return out
}

export async function processList(_workspaceRoot: string, args: any = {}) {
  const filter = String(args.filter || args.name || '')
  const result = await runCmd('ps', ['-eo', 'pid=,comm=,%cpu=,rss='])
  if (result.exitCode !== 0) throw new Error(result.stderr || 'ps failed')
  const processes = parsePs(result.stdout, filter)
    .sort((a, b) => b.cpu - a.cpu)
  return { success: true, count: processes.length, processes }
}

export async function processKill(_workspaceRoot: string, args: any) {
  const name = String(args.name || '')
  const pid = args.pid ? Number(args.pid) : null
  if (!name && !pid) throw new Error('name or pid is required for process.kill')

  if (pid) {
    const result = await runCmd('kill', ['-9', String(pid)])
    return { success: result.exitCode === 0, name: null, pid, stderr: result.stderr || '' }
  }

  // Name-based: prefer pkill, fall back to killall.
  if (which('pkill')) {
    const result = await runCmd('pkill', ['-9', '-f', name])
    // pkill exits 1 when nothing matched — treat as "no such process" rather
    // than a hard failure so the AI gets a clear answer.
    return { success: result.exitCode === 0, name, pid: null, matched: result.exitCode === 0 }
  }
  const result = await runCmd('killall', ['-9', name])
  return { success: result.exitCode === 0, name, pid: null, stderr: result.stderr || '' }
}
