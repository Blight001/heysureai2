import { runCommand } from './shell'

export async function gitDiff(workspaceRoot: string, args: any) {
  const cwd = args.cwd || workspaceRoot
  const [status, diff] = await Promise.all([
    runCommand(workspaceRoot, { command: 'git status --porcelain', cwd }),
    runCommand(workspaceRoot, { command: 'git diff', cwd }),
  ])
  const changed = (status.stdout || '').split('\n').filter(Boolean).map((l: string) => l.trim())
  return { cwd, changed, diff: diff.stdout || '' }
}
