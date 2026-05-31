// Helpers for invoking Linux CLI utilities from Node and parsing their output.
// These back the window / process / speech / hands / ear tools, which drive
// standard tools (wmctrl, xdotool, ps, espeak-ng / spd-say) instead of the
// PowerShell layer used by the Windows build.

import { spawn, spawnSync, type SpawnOptionsWithoutStdio } from 'child_process'

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

// Run a command (no shell — argv array) and resolve with its captured output.
// Never rejects: a missing binary or non-zero exit is reported via exitCode /
// stderr so callers can surface a friendly message.
export function runCmd(
  cmd: string,
  args: string[] = [],
  options: SpawnOptionsWithoutStdio = {},
): Promise<RunResult> {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(cmd, args, options)
    } catch (err: any) {
      resolve({ exitCode: 127, stdout: '', stderr: err?.message || String(err) })
      return
    }
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', err => {
      resolve({ exitCode: 127, stdout: stdout.trim(), stderr: (stderr + err.message).trim() })
    })
    child.on('close', code => {
      resolve({ exitCode: typeof code === 'number' ? code : 0, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

// Long-running streaming child (used by hands/ear monitors). Caller wires up
// stdout/stderr listeners and kill().
export function spawnCmd(
  cmd: string,
  args: string[] = [],
  options: SpawnOptionsWithoutStdio = {},
) {
  return spawn(cmd, args, options)
}

const _whichCache = new Map<string, string | null>()

// Resolve an executable on PATH. Cached because callers probe the same few
// tools (wmctrl, xdotool, …) repeatedly. Returns the absolute path or null.
export function which(bin: string): string | null {
  if (_whichCache.has(bin)) return _whichCache.get(bin) as string | null
  let resolved: string | null = null
  try {
    const r = spawnSync('which', [bin], { encoding: 'utf8' })
    const out = (r.stdout || '').trim()
    if (r.status === 0 && out) resolved = out.split('\n')[0].trim()
  } catch { resolved = null }
  _whichCache.set(bin, resolved)
  return resolved
}

// Return the first available binary from a preference list, or null.
export function firstAvailable(bins: string[]): string | null {
  for (const bin of bins) {
    if (which(bin)) return bin
  }
  return null
}

// Tools that depend on an external CLI throw this so the failure is explicit
// and actionable rather than a cryptic ENOENT.
export function requireBin(bin: string, hint?: string): string {
  const resolved = which(bin)
  if (!resolved) {
    throw new Error(`需要命令行工具 "${bin}"，但未在 PATH 中找到。${hint || `请先安装：sudo apt install ${bin}`}`)
  }
  return resolved
}
