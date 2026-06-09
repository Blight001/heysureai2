// Tool registry — single source of truth for what the agent can execute.
// Each tool is one entry mapping a stable id (e.g. "screen.capture") to:
//   - handler: async function that performs the work
//   - platform: which platforms the tool is available on
//
// Adding a new capability means appending one entry — no switch statement
// to touch and no parallel arrays to keep in sync.

import { IS_LINUX } from '../platform'

export type ToolPlatform = 'all' | 'linux'

export interface ToolHandlerArgs {
  workspaceRoot: string
  args: Record<string, any>
}

export type ToolHandler = (ctx: ToolHandlerArgs) => any | Promise<any>

export interface ToolDefinition {
  id: string
  platform: ToolPlatform
  handler: ToolHandler
  // Self-described MCP schema shipped to the server at register time. The
  // server stores these and surfaces them in mcp.list_tools / describe_tool
  // instead of hardcoding desktop tool schemas. Optional for back-compat.
  description?: string
  inputSchema?: Record<string, any>
}

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, any>
}

const registry = new Map<string, ToolDefinition>()

export function registerTool(def: ToolDefinition): void {
  registry.set(def.id, def)
}

export function registerTools(defs: ToolDefinition[]): void {
  for (const def of defs) registerTool(def)
}

export function getTool(id: string): ToolDefinition | undefined {
  return registry.get(id)
}

export function listToolIds(): string[] {
  return Array.from(registry.values())
    .filter(t => t.platform === 'all' || (t.platform === 'linux' && IS_LINUX))
    .map(t => t.id)
}

export function listToolDefs(): ToolDef[] {
  return Array.from(registry.values())
    .filter(t => t.platform === 'all' || (t.platform === 'linux' && IS_LINUX))
    .map(t => ({
      name: t.id,
      description: t.description || `Run desktop tool ${t.id} on the connected Linux agent.`,
      input_schema: t.inputSchema || { type: 'object', properties: {}, additionalProperties: true },
    }))
}
