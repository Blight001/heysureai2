// Hidden BrowserWindow that performs `desktopCapturer` calls.
// The Electron main process can't use desktopCapturer directly with full
// fidelity, so we host a 1x1 invisible renderer that does the work and
// streams PNG bytes back over ipc-message.

import { app, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { SCREENSHOT_TIMEOUT_MS } from '../constants'
import { registerCaptureFn } from '../capture-bridge'

const CAPTURE_HTML = `<!DOCTYPE html>
<html><body><script>
const { ipcRenderer, desktopCapturer, screen } = require('electron')

ipcRenderer.on('do-capture', async (event, opts) => {
  try {
    const d = screen.getPrimaryDisplay()
    const w = opts.width || d.size.width
    const h = opts.height || d.size.height
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: w, height: h }
    })
    const idx = Math.min(opts.displayIndex || 0, sources.length - 1)
    let img = sources[idx].thumbnail
    if (opts.cropRegion) {
      img = img.crop(opts.cropRegion)
    }
    const buf = img.toPNG()
    ipcRenderer.send('capture-done', Array.from(buf))
  } catch (e) {
    ipcRenderer.send('capture-error', e.message)
  }
})
</script></body></html>`

interface PendingCapture {
  resolve: (buf: Buffer) => void
  reject: (err: Error) => void
}

let captureWindow: BrowserWindow | null = null

export async function setupCaptureWindow(): Promise<BrowserWindow> {
  captureWindow = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  const tmpHtml = path.join(app.getPath('temp'), 'hs-capture.html')
  fs.writeFileSync(tmpHtml, CAPTURE_HTML, 'utf8')
  await captureWindow.loadFile(tmpHtml)

  const pending: PendingCapture[] = []

  captureWindow.webContents.on('ipc-message', (_event, channel, ...args) => {
    if (channel === 'capture-done' && pending.length > 0) {
      pending.shift()!.resolve(Buffer.from(args[0]))
    } else if (channel === 'capture-error' && pending.length > 0) {
      pending.shift()!.reject(new Error(args[0]))
    }
  })

  registerCaptureFn((opts) => new Promise<Buffer>((resolve, reject) => {
    pending.push({ resolve, reject })
    captureWindow?.webContents.send('do-capture', opts)
    setTimeout(() => {
      const idx = pending.findIndex(p => p.reject === reject)
      if (idx !== -1) {
        pending.splice(idx, 1)
        reject(new Error(`Screenshot timed out after ${SCREENSHOT_TIMEOUT_MS / 1000}s`))
      }
    }, SCREENSHOT_TIMEOUT_MS)
  }))

  return captureWindow
}
