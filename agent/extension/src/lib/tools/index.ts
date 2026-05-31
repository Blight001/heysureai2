// tools/ — public API for the MCP tool catalog and dispatcher.
//
//   definitions.ts  — BROWSER_TOOLS schema, SEARCH_ENGINES, BROWSER_CAPABILITIES,
//                      BROWSER_TOOL_CATEGORIES (单一分组来源)
//   browser.ts      — browser_* tool implementations + executeBrowserOnly router
//   router.ts       — executeBrowserTool dispatcher
//   executor.ts     — executeTask: server-dispatched task runner with AI loop
//   overrides.ts    — effectiveToolDefs: BROWSER_TOOLS merged with local edits

export { SEARCH_ENGINES, BROWSER_TOOLS, BROWSER_CAPABILITIES, BROWSER_TOOL_CATEGORIES, browserToolCategory } from './definitions'
export type { BrowserToolCategory } from './definitions'
export { executeBrowserOnly } from './browser'
export { executeBrowserTool } from './router'
export { executeTask } from './executor'
export { effectiveToolDefs } from './overrides'
