import { exec } from 'child_process'
import * as path from 'path'

export function runCommand(workspaceRoot: string, args: any): Promise<any> {
  const cmd = String(args.command || '')
  if (!cmd) throw new Error('command is required')
  const cwd = args.cwd ? path.resolve(workspaceRoot, args.cwd) : workspaceRoot
  const timeout = Number(args.timeoutMs || args.timeout_ms || 60000)

  return new Promise(resolve => {
    const shellOpts = process.platform === 'win32' ? { shell: 'cmd.exe' } : {}
    exec(cmd, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, ...shellOpts }, (err, stdout, stderr) => {
      resolve({
        command: cmd, cwd,
        exitCode: err?.code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        timedOut: (err as any)?.killed === true,
      })
    })
  })
}
