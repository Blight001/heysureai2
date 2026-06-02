// Screen capture using Electron's main-process desktopCapturer + screen modules.
//
// The previous implementation hosted a hidden BrowserWindow and called
// `require('electron').screen` from the renderer. In Electron 17+ both
// `screen` and `desktopCapturer` are main-process-only, so the renderer
// approach failed at runtime with "screen.getPrimaryDisplay is not a
// function". Running directly in main removes the IPC hop entirely.

import { desktopCapturer, screen } from 'electron'
import { SCREENSHOT_TIMEOUT_MS } from './constants'

export interface CaptureOpts {
  width?: number
  height?: number
  displayIndex?: number
  cropRegion?: { x: number; y: number; width: number; height: number }
}

export interface CaptureDisplayGeometry {
  id: number
  scaleFactor: number
  bounds: { x: number; y: number; width: number; height: number }
  size: { width: number; height: number }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    )
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

export async function executeCapture(opts: CaptureOpts = {}): Promise<Buffer> {
  const displays = screen.getAllDisplays()
  const requested = opts.displayIndex ?? 0
  const idx = displays.length > 0
    ? Math.min(Math.max(requested, 0), displays.length - 1)
    : 0
  const display = displays[idx] || screen.getPrimaryDisplay()

  // Default to native pixel resolution so screenshots aren't downscaled.
  const w = opts.width ?? Math.round(display.size.width * display.scaleFactor)
  const h = opts.height ?? Math.round(display.size.height * display.scaleFactor)

  const sources = await withTimeout(
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: w, height: h },
    }),
    SCREENSHOT_TIMEOUT_MS,
    'Screenshot',
  )
  if (sources.length === 0) throw new Error('No screen sources available')

  // Prefer the source whose display_id matches the requested display; fall
  // back to positional index, then to the first source.
  const source = sources.find(s => s.display_id === String(display.id))
    || sources[idx]
    || sources[0]

  let img = source.thumbnail
  if (opts.cropRegion) img = img.crop(opts.cropRegion)
  return img.toPNG()
}

export function getCaptureDisplayGeometry(displayIndex = 0): CaptureDisplayGeometry {
  const displays = screen.getAllDisplays()
  const idx = displays.length > 0
    ? Math.min(Math.max(displayIndex, 0), displays.length - 1)
    : 0
  const display = displays[idx] || screen.getPrimaryDisplay()
  return {
    id: display.id,
    scaleFactor: display.scaleFactor,
    bounds: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    },
    size: {
      width: display.size.width,
      height: display.size.height,
    },
  }
}

export function initCapture(): void {
  if (!screen || typeof screen.getPrimaryDisplay !== 'function') {
    throw new Error('Electron screen module unavailable in main process')
  }
  if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') {
    throw new Error('Electron desktopCapturer unavailable in main process')
  }
}
