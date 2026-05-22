import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { executeCapture } from '../capture-bridge'

export async function screenCapture(args: any = {}) {
  const displayIndex = Number(args.display || args.screen || 0)
  const buf = await executeCapture({ displayIndex })

  const savePath = String(args.path || path.join(os.tmpdir(), `hs_screen_${Date.now()}.png`))
  fs.writeFileSync(savePath, buf)

  const size = { width: 0, height: 0 }
  // Parse PNG dimensions from buffer (bytes 16-23 of IHDR chunk)
  if (buf.length > 24) {
    size.width = buf.readUInt32BE(16)
    size.height = buf.readUInt32BE(20)
  }

  return {
    success: true,
    path: savePath,
    width: size.width,
    height: size.height,
    bytes: buf.length,
    display: displayIndex,
  }
}

export async function screenCaptureRegion(args: any) {
  const { x = 0, y = 0, width, height } = args
  if (!width || !height) throw new Error('width and height are required for screen.capture_region')

  // Full screen capture first, then crop via nativeImage (done in main process IPC handler)
  const buf = await executeCapture({ cropRegion: { x, y, width, height } } as any)

  const savePath = String(args.path || path.join(os.tmpdir(), `hs_region_${Date.now()}.png`))
  fs.writeFileSync(savePath, buf)

  return { success: true, path: savePath, x, y, width, height, bytes: buf.length }
}

export async function screenInfo(args: any = {}) {
  // This is called from executor which has access to the electron screen module via IPC
  // We return a placeholder and let executor enrich it
  let robot: any = null
  try { robot = require('robotjs') } catch (_) {}

  const screenSize = robot ? robot.getScreenSize() : { width: 1920, height: 1080 }
  const mousePos = robot ? robot.getMousePos() : { x: 0, y: 0 }

  return {
    success: true,
    screen: { width: screenSize.width, height: screenSize.height },
    cursor: { x: mousePos.x, y: mousePos.y },
  }
}
