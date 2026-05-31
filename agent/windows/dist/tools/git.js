"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gitDiff = gitDiff;
const shell_1 = require("./shell");
async function gitDiff(workspaceRoot, args) {
    const cwd = args.cwd || workspaceRoot;
    const [status, diff] = await Promise.all([
        (0, shell_1.runCommand)(workspaceRoot, { command: 'git status --porcelain', cwd }),
        (0, shell_1.runCommand)(workspaceRoot, { command: 'git diff', cwd }),
    ]);
    const changed = (status.stdout || '').split('\n').filter(Boolean).map((l) => l.trim());
    return { cwd, changed, diff: diff.stdout || '' };
}
