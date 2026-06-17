// shell.run — thin built-in over the controlled shell runner.
//
// The interpreter selection (cmd / powershell / pwsh on Windows, bash elsewhere)
// and all of timeout / kill / concurrency / output-truncation now live in
// runtime/shell-runner + process-guard, so this file is platform-neutral and
// shared by both desktop shells.

import { runShell, type ShellRunResult } from '../runtime/shell-runner'

export function runCommand(workspaceRoot: string, args: any): Promise<ShellRunResult> {
  return runShell(workspaceRoot, {
    command: String(args.command || ''),
    cwd: args.cwd,
    shell: args.shell || args.shell_type,
    timeoutMs: Number(args.timeoutMs || args.timeout_ms) || undefined,
  })
}
