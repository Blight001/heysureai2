import * as fs from 'fs'
import * as path from 'path'
import { FS_READ_LIMIT_BYTES } from '../constants'

const IGNORED = new Set(['.git', 'node_modules', '__pycache__', 'venv', '.venv', '.aider', 'dist'])

function safeResolve(root: string, rel?: string): string {
  const base = path.resolve(root)
  const full = rel ? path.resolve(base, rel) : base
  // Prevent path traversal: resolved path must be inside the workspace root
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`Path traversal not allowed: ${rel}`)
  }
  return full
}

export function listFiles(workspaceRoot: string, args: any) {
  const target = safeResolve(workspaceRoot, args.path)
  if (!fs.existsSync(target)) throw new Error(`Path not found: ${args.path || '.'}`)
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter(e => !IGNORED.has(e.name))
    .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { root: workspaceRoot, path: args.path || '.', entries }
}

export function readFile(workspaceRoot: string, args: any) {
  if (!args.path) throw new Error('path is required')
  const target = safeResolve(workspaceRoot, args.path)
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error(`File not found: ${args.path}`)
  }
  const maxBytes = Number(args.maxBytes || FS_READ_LIMIT_BYTES)
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
  const content = args.content ?? ''
  fs.writeFileSync(target, content, 'utf8')
  return { path: args.path, bytes: Buffer.byteLength(content), written: true }
}
