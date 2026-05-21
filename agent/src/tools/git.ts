import { runCommand } from './shell';

export async function gitDiff(args: { cwd?: string } = {}): Promise<any> {
  const status = await runCommand({ command: 'git status --porcelain', cwd: args.cwd });
  const diff = await runCommand({ command: 'git diff', cwd: args.cwd });
  return {
    cwd: status.cwd,
    changed: String(status.stdout || '').trim().split('\n').filter(Boolean),
    diff: String(diff.stdout || ''),
  };
}
