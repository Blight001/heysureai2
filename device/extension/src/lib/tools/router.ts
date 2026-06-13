// tools/router.ts — public tool dispatcher.
// Routes browser_* names to executeBrowserOnly. This is what background code
// and the AI loop call. (Card automation was removed.)

import { executeBrowserOnly } from './browser'

export async function executeBrowserTool(name: string, args: any): Promise<any> {
  return executeBrowserOnly(name, args)
}
