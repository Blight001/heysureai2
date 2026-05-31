import { BrowserWindow, screen as electronScreen } from 'electron'

interface BoxLike {
  top?: number
  left?: number
  x?: number
  y?: number
  width?: number
  height?: number
  color?: string
  label?: string
}

const overlayWindows = new Set<BrowserWindow>()

function numberArg(value: any, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeBox(args: BoxLike) {
  const left = numberArg(args.left ?? args.x)
  const top = numberArg(args.top ?? args.y)
  const width = Math.max(1, numberArg(args.width, 1))
  const height = Math.max(1, numberArg(args.height, 1))
  return {
    left,
    top,
    width,
    height,
    color: String(args.color || 'red'),
    label: args.label === undefined ? '' : String(args.label),
  }
}

function normalizeSubBox(box: any, parentLeft: number, parentTop: number) {
  if (Array.isArray(box)) {
    const points = box
      .map((point: any) => Array.isArray(point) && point.length >= 2 ? [Number(point[0]), Number(point[1])] : null)
      .filter(Boolean) as number[][]
    if (points.length >= 2) {
      const xs = points.map(p => p[0])
      const ys = points.map(p => p[1])
      const left = Math.min(...xs) + parentLeft
      const top = Math.min(...ys) + parentTop
      return {
        left,
        top,
        width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
        height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
        color: 'yellow',
        label: '',
      }
    }
  }
  return normalizeBox({ ...(box || {}), left: (box?.left ?? box?.x ?? 0) + parentLeft, top: (box?.top ?? box?.y ?? 0) + parentTop, color: box?.color || 'yellow' })
}

function overlayBounds() {
  const displays = electronScreen.getAllDisplays()
  const minX = Math.min(...displays.map(d => d.bounds.x))
  const minY = Math.min(...displays.map(d => d.bounds.y))
  const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width))
  const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function renderHtml(bounds: Electron.Rectangle, boxes: ReturnType<typeof normalizeBox>[]) {
  const rects = boxes.map(box => ({
    ...box,
    left: box.left - bounds.x,
    top: box.top - bounds.y,
    label: escapeHtml(box.label),
  }))
  return `<!doctype html>
<html>
<body>
<canvas id="c"></canvas>
<script>
const boxes = ${JSON.stringify(rects)};
const canvas = document.getElementById('c');
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(window.innerWidth * dpr);
canvas.height = Math.round(window.innerHeight * dpr);
canvas.style.width = '100vw';
canvas.style.height = '100vh';
const ctx = canvas.getContext('2d');
ctx.scale(dpr, dpr);
ctx.font = '12px sans-serif';
ctx.lineJoin = 'round';
for (const box of boxes) {
  ctx.strokeStyle = box.color;
  ctx.lineWidth = box.color === 'yellow' ? 1 : 3;
  ctx.strokeRect(box.left, box.top, box.width, box.height);
  if (box.label) {
    const metrics = ctx.measureText(box.label);
    const labelWidth = Math.ceil(metrics.width) + 10;
    const labelTop = Math.max(0, box.top - 20);
    ctx.fillStyle = box.color;
    ctx.fillRect(box.left, labelTop, labelWidth, 18);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(box.label, box.left + 5, labelTop + 13);
  }
}
</script>
</body>
</html>`
}

export async function displayClear(_args: any = {}) {
  for (const win of Array.from(overlayWindows)) {
    if (!win.isDestroyed()) win.close()
  }
  overlayWindows.clear()
  return { success: true, cleared: true }
}

export async function displayBox(args: any) {
  const duration = Math.max(100, numberArg(args.duration ?? args.duration_ms, 1000))
  const mainBox = normalizeBox(args)
  const subBoxes = Array.isArray(args.sub_boxes)
    ? args.sub_boxes.map((box: any) => normalizeSubBox(box, mainBox.left, mainBox.top))
    : []
  const boxes = [mainBox, ...subBoxes]
  const bounds = overlayBounds()
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  overlayWindows.add(win)
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.on('closed', () => overlayWindows.delete(win))
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHtml(bounds, boxes))}`)
  setTimeout(() => {
    if (!win.isDestroyed()) win.close()
  }, duration)

  return { success: true, duration, boxes: boxes.length }
}
