import * as fs from 'fs'
import * as path from 'path'

const IGNORED = new Set(['.git', '__pycache__', 'venv', 'node_modules', '.aider', 'dist'])

function safeResolve(root: string, rel?: string): string {
  const base = path.resolve(root)
  const full = rel ? path.resolve(base, rel) : base
  if (!full.startsWith(base)) throw new Error('Path traversal not allowed')
  return full
}

export function listFiles(workspaceRoot: string, args: any) {
  const target = safeResolve(workspaceRoot, args.path)
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter(e => !IGNORED.has(e.name))
    .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
  return { root: workspaceRoot, path: args.path || '.', entries }
}

export function readFile(workspaceRoot: string, args: any) {
  if (!args.path) throw new Error('path is required')
  const target = safeResolve(workspaceRoot, args.path)
  const maxBytes = Number(args.maxBytes || 200000)
  const stat = fs.statSync(target)
  const toRead = Math.min(stat.size, maxBytes)
  const buf = Buffer.alloc(toRead)
  const fd = fs.openSync(target, 'r')
  try { fs.readSync(fd, buf, 0, toRead, 0) } finally { fs.closeSync(fd) }
  return { path: args.path, bytes: stat.size, truncated: stat.size > maxBytes, content: buf.toString('utf8') }
}

export function writeFile(workspaceRoot: string, args: any) {
  if (!args.path) throw new Error('path is required')
  const target = safeResolve(workspaceRoot, args.path)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, args.content || '', 'utf8')
  return { path: args.path, bytes: (args.content || '').length, written: true }
}
