import { exec } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { SHELL_TIMEOUT_MS, SHELL_MAX_BUFFER_BYTES } from '../constants'

export function runCommand(workspaceRoot: string, args: any): Promise<any> {
  const cmd = String(args.command || '')
  if (!cmd) throw new Error('command is required')
  const cwd = args.cwd ? path.resolve(workspaceRoot, args.cwd) : workspaceRoot
  const timeout = Number(args.timeoutMs || args.timeout_ms || SHELL_TIMEOUT_MS)

  return new Promise(resolve => {
    // Run through bash so the AI can use pipes, globs, &&, $() etc. Falls back
    // to the platform default shell on the rare host without /bin/bash.
    const shellOpts = fs.existsSync('/bin/bash') ? { shell: '/bin/bash' } : {}
    exec(cmd, { cwd, timeout, maxBuffer: SHELL_MAX_BUFFER_BYTES, ...shellOpts }, (err, stdout, stderr) => {
      const timedOut = !!(err as any)?.killed
      const exitCode = err ? (typeof err.code === 'number' ? err.code : 1) : 0
      resolve({
        command: cmd, cwd,
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut,
      })
    })
  })
}
