// Helpers for invoking PowerShell from Node and parsing its JSON output.
// The encoded-command helpers are used for long-running background workers
// and scripts that contain arbitrary text payloads.

import { spawn, type SpawnOptionsWithoutStdio } from 'child_process'
import { existsSync } from 'fs'

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
  const prelude = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
  ].join('\n')
  return Buffer.from(`${prelude}\n${script}`, 'utf16le').toString('base64')
}

export function quotePsSingle(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

function powerShellCandidates(): string[] {
  const root = process.env.SystemRoot || 'C:\\Windows'
  return [
    `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    `${root}\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe`,
    'powershell.exe',
    'pwsh.exe',
  ]
}

function getPowerShellCommand(): string {
  return powerShellCandidates().find(cmd => cmd.includes('\\') && existsSync(cmd)) || 'powershell.exe'
}

export const PS = `"${getPowerShellCommand()}" -NonInteractive -NoProfile -Command`

export function runPowerShellScript(
  script: string,
  options: SpawnOptionsWithoutStdio = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellScript(script)]
  const commands = powerShellCandidates()
  let index = 0

  return new Promise(resolve => {
    const runNext = (lastError = '') => {
      const command = commands[index++]
      if (!command) {
        resolve({ exitCode: 1, stdout: '', stderr: lastError || 'PowerShell is not available' })
        return
      }

      if (command.includes('\\') && !existsSync(command)) {
        runNext(lastError)
        return
      }

      const child = spawn(
        command,
        args,
        { windowsHide: true, ...options },
      )
      let stdout = ''
      let stderr = ''
      let spawnFailed = false
      child.stdout.on('data', chunk => { stdout += chunk.toString() })
      child.stderr.on('data', chunk => { stderr += chunk.toString() })
      child.on('error', err => {
        spawnFailed = true
        runNext([stderr, err.message].filter(Boolean).join('\n').trim())
      })
      child.on('close', code => {
        if (spawnFailed) return
        resolve({
          exitCode: typeof code === 'number' ? code : 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      })
    }

    runNext()
  })
}

export function spawnPowerShellScript(
  script: string,
  options: SpawnOptionsWithoutStdio = {},
) {
  return spawn(
    getPowerShellCommand(),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellScript(script)],
    { windowsHide: true, ...options },
  )
}
