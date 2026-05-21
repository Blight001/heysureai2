import { listFiles, readFile, writeFile } from './tools/filesystem';
import { runCommand } from './tools/shell';
import { gitDiff } from './tools/git';

export interface DispatchedTask {
  taskId: string;
  userId?: number;
  aiConfigId?: number | null;
  sessionId?: string;
  instruction?: string;
  tool?: string;
  args?: Record<string, any>;
  allowedTools?: string[];
}

export interface TaskCallbacks {
  onProgress: (message: string) => void;
}

export const AGENT_CAPABILITIES = ['fs.list', 'fs.read', 'fs.write', 'shell.run', 'git.diff'];

// Lightweight keyword routing for instruction-only dispatches (no explicit tool).
function inferTool(instruction: string): string {
  const text = (instruction || '').toLowerCase();
  if (/list|列出|目录|文件列表|ls\b/.test(text)) return 'fs.list';
  if (/git\s*diff|改动|变更|diff/.test(text)) return 'git.diff';
  return '';
}

export class TaskExecutor {
  private task: DispatchedTask;
  private callbacks: TaskCallbacks;

  constructor(task: DispatchedTask, callbacks: TaskCallbacks) {
    this.task = task;
    this.callbacks = callbacks;
  }

  async run(): Promise<{ success: boolean; tool: string; result: any; summary: string }> {
    const explicitTool = (this.task.tool || '').trim();
    const tool = explicitTool || inferTool(this.task.instruction || '');

    if (!tool) {
      return {
        success: true,
        tool: '',
        result: { capabilities: AGENT_CAPABILITIES },
        summary:
          'No tool specified and instruction could not be auto-routed. ' +
          `Available local tools: ${AGENT_CAPABILITIES.join(', ')}.`,
      };
    }

    this.callbacks.onProgress(`Executing ${tool}...`);
    const args = this.task.args || {};

    switch (tool) {
      case 'fs.list': {
        const result = listFiles(args);
        return { success: true, tool, result, summary: `Listed ${result.entries.length} entries in ${result.path}` };
      }
      case 'fs.read': {
        const result = readFile(args as any);
        return { success: true, tool, result, summary: `Read ${result.bytes} bytes from ${result.path}` };
      }
      case 'fs.write': {
        const result = writeFile(args as any);
        return { success: true, tool, result, summary: `Wrote ${result.bytes} bytes to ${result.path}` };
      }
      case 'shell.run': {
        const result = await runCommand(args as any);
        return {
          success: result.exitCode === 0,
          tool,
          result,
          summary: `Command exited with code ${result.exitCode}`,
        };
      }
      case 'git.diff': {
        const result = await gitDiff(args);
        return { success: true, tool, result, summary: `${result.changed.length} files changed` };
      }
      default:
        throw new Error(`Unsupported tool: ${tool}`);
    }
  }
}
