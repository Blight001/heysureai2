// capture-bridge.ts - singleton bridge for screen capture IPC

type CaptureFn = (args: { width?: number; height?: number; displayIndex?: number }) => Promise<Buffer>

let _captureFn: CaptureFn | null = null

export function registerCaptureFn(fn: CaptureFn): void {
  _captureFn = fn
}

export async function executeCapture(args: { width?: number; height?: number; displayIndex?: number }): Promise<Buffer> {
  if (!_captureFn) throw new Error('Screen capture not initialized — capture bridge not registered')
  return _captureFn(args)
}
