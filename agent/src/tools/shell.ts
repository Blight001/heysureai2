import { exec } from 'child_process';

function workspaceRoot(): string {
  return process.env.AGENT_WORKSPACE || process.cwd();
}

export function runCommand(args: { command: string; cwd?: string; timeoutMs?: number }): Promise<any> {
  const command = (args.command || '').trim();
  if (!command) return Promise.reject(new Error('Missing command'));

  const cwd = args.cwd || workspaceRoot();
  const timeout = args.timeoutMs || 60_000;

  return new Promise((resolve) => {
    exec(command, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        command,
        cwd,
        exitCode: error ? (error.code ?? 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        timedOut: Boolean(error && (error as any).killed),
      });
    });
  });
}
