// tools/overrides.ts — merge the user's local description edits onto the static
// BROWSER_TOOLS schemas, and apply the user's enable/disable selection. The
// result is what gets reported to the server via agent:register -> toolDefs, so
// server-side mcp.list_tools / describe_tool reflect the popup's edited
// descriptions without any server-side storage, and disabled tools are withheld
// entirely (server + AI never see them).

import { BROWSER_TOOLS, isToolEnabledByDefault } from './definitions'
import { AIToolDef } from '../types'
import { getToolDescOverrides, getToolEnabledMap } from '../storage'
import { dynamicMcpToolDefs } from './dynamic'

async function allToolDefs(): Promise<AIToolDef[]> {
  const merged = new Map(BROWSER_TOOLS.map(tool => [tool.name, {
    ...tool,
    implementation: {
      kind: 'builtin',
      source_files: ['src/lib/tools/definitions.ts', 'src/lib/tools/browser.ts', 'src/lib/tools/router.ts', 'dist/background.js'],
      editable_via: 'mcp.manage_dynamic_tool',
    },
  }] as const))
  for (const tool of await dynamicMcpToolDefs()) merged.set(tool.name, tool)
  return Array.from(merged.values())
}

/** Resolve every browser tool's effective on/off state (explicit choice ?? default). */
export async function resolveToolEnabledMap(): Promise<Record<string, boolean>> {
  const explicit = await getToolEnabledMap()
  const out: Record<string, boolean> = {}
  for (const tool of await allToolDefs()) {
    out[tool.name] = tool.name in explicit ? !!explicit[tool.name] : isToolEnabledByDefault(tool.name)
  }
  return out
}

/** Names of the currently enabled tools, preserving BROWSER_TOOLS order. */
export async function enabledToolNames(): Promise<string[]> {
  const enabled = await resolveToolEnabledMap()
  return (await allToolDefs()).filter(t => enabled[t.name]).map(t => t.name)
}

export async function effectiveToolDefs(): Promise<AIToolDef[]> {
  const overrides = await getToolDescOverrides()
  const enabled = await resolveToolEnabledMap()
  return (await allToolDefs()).filter(tool => enabled[tool.name]).map(tool => {
    const o = overrides[tool.name]
    if (!o) return tool
    const desc = (o.description || '').trim()
    const props = tool.input_schema?.properties || {}
    let nextProps = props
    if (o.parameters && Object.keys(o.parameters).length) {
      nextProps = {}
      for (const [k, v] of Object.entries(props)) {
        const pd = (o.parameters[k] || '').trim()
        nextProps[k] = pd ? { ...(v as any), description: pd } : v
      }
    }
    return {
      ...tool,
      description: desc || tool.description,
      input_schema: { ...tool.input_schema, properties: nextProps },
    }
  })
}
