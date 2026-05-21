import fs from 'fs';
import path from 'path';

const IGNORED = new Set(['.git', 'node_modules', '__pycache__', '.aider', 'dist']);

function workspaceRoot(): string {
  return process.env.AGENT_WORKSPACE || process.cwd();
}

// Resolve a user-supplied path inside the workspace, preventing traversal.
function safeResolve(target: string): string {
  const root = path.resolve(workspaceRoot());
  const resolved = path.resolve(root, target || '.');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Access denied: path outside workspace (${target})`);
  }
  return resolved;
}

export function listFiles(args: { path?: string } = {}): any {
  const dir = safeResolve(args.path || '.');
  if (!fs.existsSync(dir)) {
    throw new Error(`Path not found: ${args.path || '.'}`);
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => !IGNORED.has(e.name))
    .map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { root: workspaceRoot(), path: args.path || '.', entries };
}

export function readFile(args: { path: string; maxBytes?: number }): any {
  if (!args.path) throw new Error('Missing path');
  const file = safeResolve(args.path);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new Error(`File not found: ${args.path}`);
  }
  const maxBytes = args.maxBytes || 200_000;
  const buf = fs.readFileSync(file);
  const truncated = buf.length > maxBytes;
  const content = buf.subarray(0, maxBytes).toString('utf-8');
  return { path: args.path, bytes: buf.length, truncated, content };
}

export function writeFile(args: { path: string; content?: string }): any {
  if (!args.path) throw new Error('Missing path');
  const file = safeResolve(args.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, args.content ?? '', 'utf-8');
  return { path: args.path, bytes: Buffer.byteLength(args.content ?? ''), written: true };
}
