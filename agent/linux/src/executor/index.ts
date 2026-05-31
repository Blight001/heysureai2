import './catalog' // side-effect: register built-in tools
import { getTool, listToolIds, listToolDefs, ToolDef } from './registry'
import { inferTool } from './infer'

export interface DispatchedTask {
  taskId: string
  userId?: string | number
  aiConfigId?: string | number
  sessionId?: string
  instruction?: string
  tool?: string
  args?: Record<string, any>
  allowedTools?: string[]
}

export interface TaskResult {
  success: boolean
  tool: string
  result: any
  summary: string
}

export async function executeTask(workspaceRoot: string, task: DispatchedTask): Promise<TaskResult> {
  const tool = task.tool || inferTool(task.instruction || '')
  const args = { ...(task.args || {}) }

  // For inferred shell.run, fall back to the raw instruction as the command
  if (!task.tool && task.instruction) {
    args.instruction = task.instruction
    if (!args.command && tool === 'shell.run') args.command = task.instruction
  }

  const def = getTool(tool)
  if (!def) {
    return {
      success: false,
      tool,
      result: null,
      summary: `Unknown tool: ${tool}. Use one of: ${getAvailableTools().join(', ')}`,
    }
  }

  try {
    const result = await def.handler({ workspaceRoot, args })
    return { success: true, tool, result, summary: `${tool} completed successfully` }
  } catch (err: any) {
    return { success: false, tool, result: null, summary: err?.message || String(err) }
  }
}

export function getAvailableTools(): string[] {
  return listToolIds()
}

export function getToolDefs(): ToolDef[] {
  return listToolDefs()
}
