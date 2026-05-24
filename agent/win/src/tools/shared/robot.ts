// Lazy singleton accessor for the optional native module robotjs.
// Native modules can fail to load on non-Windows / unrebuilt environments;
// we defer the require call until a tool actually needs it.

let robot: any = null

export function getRobot(): any {
  if (!robot) {
    try {
      robot = require('robotjs')
    } catch (_e) {
      throw new Error('robotjs not available — run: npm run rebuild')
    }
  }
  return robot
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
