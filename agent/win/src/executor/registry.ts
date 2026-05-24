// Tool registry — single source of truth for what the agent can execute.
// Each tool is one entry mapping a stable id (e.g. "screen.capture") to:
//   - handler: async function that performs the work
//   - platform: which platforms the tool is available on
//
// Adding a new capability means appending one entry — no switch statement
// to touch and no parallel arrays to keep in sync.

import { IS_WINDOWS } from '../platform'

export type ToolPlatform = 'all' | 'windows'

export interface ToolHandlerArgs {
  workspaceRoot: string
  args: Record<string, any>
}

export type ToolHandler = (ctx: ToolHandlerArgs) => any | Promise<any>

export interface ToolDefinition {
  id: string
  platform: ToolPlatform
  handler: ToolHandler
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
    .filter(t => t.platform === 'all' || (t.platform === 'windows' && IS_WINDOWS))
    .map(t => t.id)
}

export function clearRegistry(): void {
  registry.clear()
}
