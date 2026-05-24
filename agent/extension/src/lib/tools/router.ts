// tools/router.ts — combined public tool dispatcher.
// Routes browser_* names to executeBrowserOnly and card_* names to
// executeCardTool. This is what background code and the AI loop call.

import { executeBrowserOnly } from './browser'
import { executeCardTool } from './cards'

export async function executeBrowserTool(name: string, args: any): Promise<any> {
  if (name.startsWith('card_')) return executeCardTool(name, args)
  return executeBrowserOnly(name, args)
}
