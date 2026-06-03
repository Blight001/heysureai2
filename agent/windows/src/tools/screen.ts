import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { pathToFileURL } from 'url'
import { executeCapture, getCaptureDisplayGeometry } from '../capture-bridge'
import { getCoordinateCalibration, rememberCaptureGeometry } from './shared/coordinates'

function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length <= 24) return { width: 0, height: 0 }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function pngDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`
}

export async function screenCapture(args: any = {}) {
  const displayIndex = Number(args.display || args.screen || 0)
  const buf = await executeCapture({ displayIndex })
  const savePath = String(args.path || path.join(os.tmpdir(), `hs_screen_${Date.now()}.png`))
  fs.writeFileSync(savePath, buf)
  const { width, height } = pngSize(buf)
  const displayGeometry = getCaptureDisplayGeometry(displayIndex)
  rememberCaptureGeometry({ capture: { width, height }, display: displayGeometry })
  const image_url = pathToFileURL(savePath).href
  return {
    success: true,
    path: savePath,
    image_url,
    dataUrl: pngDataUrl(buf),
    width,
    height,
    bytes: buf.length,
    display: displayIndex,
    calibration: {
      display: displayGeometry,
      scale_x: width > 0 ? displayGeometry.bounds.width / width : 1,
      scale_y: height > 0 ? displayGeometry.bounds.height / height : 1,
    },
  }
}

export async function screenCaptureRegion(args: any) {
  const { x = 0, y = 0, width, height } = args
  if (!width || !height) throw new Error('width and height are required for region capture')
  const buf = await executeCapture({ cropRegion: { x: Number(x), y: Number(y), width: Number(width), height: Number(height) } })
  const savePath = String(args.path || path.join(os.tmpdir(), `hs_region_${Date.now()}.png`))
  fs.writeFileSync(savePath, buf)
  const image_url = pathToFileURL(savePath).href
  return { success: true, path: savePath, image_url, dataUrl: pngDataUrl(buf), x, y, width, height, bytes: buf.length }
}

export async function screenInfo(_args: any = {}) {
  let robot: any = null
  try { robot = require('robotjs') } catch (_) {}
  const screenSize = robot ? robot.getScreenSize() : { width: 1920, height: 1080 }
  const mousePos = robot ? robot.getMousePos() : { x: 0, y: 0 }
  return {
    success: true,
    screen: { width: screenSize.width, height: screenSize.height },
    cursor: { x: mousePos.x, y: mousePos.y },
    calibration: getCoordinateCalibration(),
  }
}
