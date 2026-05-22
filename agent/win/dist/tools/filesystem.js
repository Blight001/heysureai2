"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFiles = listFiles;
exports.readFile = readFile;
exports.writeFile = writeFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const constants_1 = require("../constants");
const IGNORED = new Set(['.git', 'node_modules', '__pycache__', 'venv', '.venv', '.aider', 'dist']);
function safeResolve(root, rel) {
    const base = path.resolve(root);
    const full = rel ? path.resolve(base, rel) : base;
    // Prevent path traversal: resolved path must be inside the workspace root
    if (full !== base && !full.startsWith(base + path.sep)) {
        throw new Error(`Path traversal not allowed: ${rel}`);
    }
    return full;
}
function listFiles(workspaceRoot, args) {
    const target = safeResolve(workspaceRoot, args.path);
    if (!fs.existsSync(target))
        throw new Error(`Path not found: ${args.path || '.'}`);
    const entries = fs.readdirSync(target, { withFileTypes: true })
        .filter(e => !IGNORED.has(e.name))
        .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { root: workspaceRoot, path: args.path || '.', entries };
}
function readFile(workspaceRoot, args) {
    if (!args.path)
        throw new Error('path is required');
    const target = safeResolve(workspaceRoot, args.path);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`File not found: ${args.path}`);
    }
    const maxBytes = Number(args.maxBytes || constants_1.FS_READ_LIMIT_BYTES);
    const stat = fs.statSync(target);
    const toRead = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(toRead);
    const fd = fs.openSync(target, 'r');
    try {
        fs.readSync(fd, buf, 0, toRead, 0);
    }
    finally {
        fs.closeSync(fd);
    }
    return { path: args.path, bytes: stat.size, truncated: stat.size > maxBytes, content: buf.toString('utf8') };
}
function writeFile(workspaceRoot, args) {
    if (!args.path)
        throw new Error('path is required');
    const target = safeResolve(workspaceRoot, args.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const content = args.content ?? '';
    fs.writeFileSync(target, content, 'utf8');
    return { path: args.path, bytes: Buffer.byteLength(content), written: true };
}
