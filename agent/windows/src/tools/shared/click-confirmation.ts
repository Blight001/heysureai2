import { nativeImage } from 'electron'
import { executeCapture, getCaptureDisplayGeometry } from '../../capture-bridge'
import { toCapturePoint } from './coordinates'
import { getRobot } from './robot'

export interface ClickConfirmationOptions {
  enabled?: boolean
  x?: number
  y?: number
  display?: number
  radius?: number
  /** 'pre' = 点击前确认图（默认）；'post' = 点击后结果核对图。两者话术不同。 */
  phase?: 'pre' | 'post'
}

function pngDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function numberArg(value: any, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function markPng(buf: Buffer, markerX: number, markerY: number): Buffer {
  const img = nativeImage.createFromBuffer(buf)
  const size = img.getSize()
  if (!size.width || !size.height) return buf

  const bitmap = Buffer.from(img.getBitmap())
  const cx = Math.round(markerX)
  const cy = Math.round(markerY)
  const radius = 5
  const ring = 9

  const setPixel = (x: number, y: number, r: number, g: number, b: number, a = 255) => {
    if (x < 0 || y < 0 || x >= size.width || y >= size.height) return
    const i = (y * size.width + x) * 4
    // Electron nativeImage bitmaps are BGRA.
    bitmap[i] = b
    bitmap[i + 1] = g
    bitmap[i + 2] = r
    bitmap[i + 3] = a
  }

  for (let y = cy - ring; y <= cy + ring; y++) {
    for (let x = cx - ring; x <= cx + ring; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d <= radius || (d >= ring - 1 && d <= ring + 0.75)) setPixel(x, y, 255, 0, 0)
    }
  }
  for (let d = -12; d <= 12; d++) {
    setPixel(cx + d, cy, 255, 255, 255)
    setPixel(cx, cy + d, 255, 255, 255)
  }
  for (let d = -10; d <= 10; d++) {
    setPixel(cx + d, cy, 255, 0, 0)
    setPixel(cx, cy + d, 255, 0, 0)
  }

  return nativeImage.createFromBitmap(bitmap, size).toPNG()
}

export async function captureClickConfirmation(options: ClickConfirmationOptions = {}) {
  if (options.enabled === false) return undefined

  const displayIndex = Math.max(0, Math.trunc(numberArg(options.display, 0)))
  const geometry = getCaptureDisplayGeometry(displayIndex)
  const captureWidth = Math.round(geometry.bounds.width * geometry.scaleFactor)
  const captureHeight = Math.round(geometry.bounds.height * geometry.scaleFactor)
  const radius = clamp(Math.trunc(numberArg(options.radius, 160)), 48, 480)

  let target = Number.isFinite(options.x) && Number.isFinite(options.y)
    ? { x: Math.round(Number(options.x)), y: Math.round(Number(options.y)) }
    : null
  if (!target) {
    const pos = getRobot().getMousePos()
    target = toCapturePoint(pos.x, pos.y)
  }

  const left = clamp(target.x - radius, 0, Math.max(0, captureWidth - 1))
  const top = clamp(target.y - radius, 0, Math.max(0, captureHeight - 1))
  const width = clamp(radius * 2, 1, captureWidth - left)
  const height = clamp(radius * 2, 1, captureHeight - top)
  const raw = await executeCapture({
    displayIndex,
    cropRegion: { x: left, y: top, width, height },
  })
  const marker = {
    x: clamp(target.x - left, 0, Math.max(0, width - 1)),
    y: clamp(target.y - top, 0, Math.max(0, height - 1)),
  }
  const marked = markPng(raw, marker.x, marker.y)

  const isPost = options.phase === 'post'
  const instructions = isPost
    ? [
        '点击已经执行，这是点击后的结果核对图，红点为本次实际点击的位置。',
        '请确认红点处的目标是否产生了预期变化（如菜单展开、按钮高亮、页面跳转、选中状态等）。',
        '如果没有任何反应或点偏了，请重新定位目标后再次调用 mouse.click 纠正。',
      ].join(' ')
    : [
        '这只是点击前确认图，尚未执行点击。',
        '请检查红点/十字是否落在本次想点击的目标可点击中心。',
        '如果偏离目标，请估算目标中心相对红点的像素偏差 correction_dx/correction_dy，并再次调用 mouse.click，x=target.x+correction_dx，y=target.y+correction_dy，继续获取新的确认图。',
        '如果红点已经正确，请再次调用 mouse.click，并传 confirmed:true 执行点击。',
      ].join(' ')

  return {
    success: true,
    purpose: isPost ? 'click_result_verification' : 'click_target_confirmation',
    dataUrl: pngDataUrl(marked),
    width,
    height,
    region: { x: left, y: top, width, height },
    target: { x: target.x, y: target.y },
    marker,
    instructions,
  }
}
