// tools/overrides.ts — merge the user's local description edits onto the static
// BROWSER_TOOLS schemas. The result is what gets reported to the server via
// agent:register -> toolDefs, so server-side mcp.list_tools / describe_tool
// reflect the popup's edited descriptions without any server-side storage.

import { BROWSER_TOOLS } from './definitions'
import { AIToolDef } from '../types'
import { getToolDescOverrides } from '../storage'

export async function effectiveToolDefs(): Promise<AIToolDef[]> {
  const overrides = await getToolDescOverrides()
  return BROWSER_TOOLS.map(tool => {
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
