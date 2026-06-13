import { exec } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { SHELL_TIMEOUT_MS, SHELL_MAX_BUFFER_BYTES } from '../constants'
import { encodePowerShellScript } from './shared/powershell'

function resolveCwd(workspaceRoot: string, raw?: any): string {
  if (!raw) return workspaceRoot
  const text = String(raw).trim()
  if (!text || text === '.') return workspaceRoot
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(workspaceRoot, text)
}

function resolveShellOptions(args: any): { command: string; shell?: string } {
  const command = String(args.command || '')
  const shell = String(args.shell || args.shell_type || '').trim().toLowerCase()
  if (process.platform !== 'win32') return { command }
  if (shell === 'powershell' || shell === 'ps') {
    return {
      command: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodePowerShellScript(command)}`,
      shell: 'cmd.exe',
    }
  }
  if (shell === 'pwsh') {
    return {
      command: `pwsh.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodePowerShellScript(command)}`,
      shell: 'cmd.exe',
    }
  }
  return { command, shell: 'cmd.exe' }
}

export function runCommand(workspaceRoot: string, args: any): Promise<any> {
  const cmd = String(args.command || '')
  if (!cmd) throw new Error('command is required')
  const cwd = resolveCwd(workspaceRoot, args.cwd)
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error(`cwd does not exist or is not a directory: ${cwd}`)
  }
  const timeout = Number(args.timeoutMs || args.timeout_ms || SHELL_TIMEOUT_MS)
  const shell = resolveShellOptions(args)

  return new Promise(resolve => {
    const shellOpts = shell.shell ? { shell: shell.shell } : {}
    exec(shell.command, { cwd, timeout, maxBuffer: SHELL_MAX_BUFFER_BYTES, ...shellOpts }, (err, stdout, stderr) => {
      const timedOut = !!(err as any)?.killed
      const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0
      resolve({
        command: cmd,
        cwd,
        shell: args.shell || (process.platform === 'win32' ? 'cmd' : 'default'),
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      })
    })
  })
}
