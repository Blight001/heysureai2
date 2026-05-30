// Helpers for invoking PowerShell from Node and parsing its JSON output.
// The encoded-command helpers are used for long-running background workers
// and scripts that contain arbitrary text payloads.

import { spawn, type SpawnOptionsWithoutStdio } from 'child_process'

export const PS = 'powershell.exe -NonInteractive -NoProfile -Command'

// Escape a value for safe embedding in a PowerShell single-quoted string
// that is itself wrapped in cmd.exe double quotes. Reject values containing
// double quotes since they would break the outer cmd quoting layer.
export function psStr(value: string): string {
  if (value.includes('"')) {
    throw new Error('Value must not contain double-quote characters')
  }
  return value.replace(/'/g, "''")
}

// Parse output produced by ConvertTo-Json. PowerShell emits a bare object
// when there is exactly one result and an array otherwise — normalize to array.
export function parsePsJson<T>(stdout: string, fallback: T): T {
  if (!stdout) return fallback
  try {
    const parsed = JSON.parse(stdout)
    return Array.isArray(parsed) ? (parsed as T) : ([parsed] as T)
  } catch {
    return fallback
  }
}

export function encodePowerShellScript(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

export function quotePsSingle(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

export function runPowerShellScript(
  script: string,
  options: SpawnOptionsWithoutStdio = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellScript(script)],
      { windowsHide: true, ...options },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', err => {
      stderr += err.message
      resolve({ exitCode: 1, stdout: stdout.trim(), stderr: stderr.trim() })
    })
    child.on('close', code => {
      resolve({
        exitCode: typeof code === 'number' ? code : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })
  })
}

export function spawnPowerShellScript(
  script: string,
  options: SpawnOptionsWithoutStdio = {},
) {
  return spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellScript(script)],
    { windowsHide: true, ...options },
  )
}
