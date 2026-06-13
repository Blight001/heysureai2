// Real-time input observation on Linux. The Windows build polls Win32
// GetAsyncKeyState from a PowerShell loop; on X11 there is no portable
// userspace API for global key state without an input grab, so this monitor
// polls the cursor position (via robotjs) and the active window title (via
// xdotool) on an interval and emits mouse_move / window_change events. Keys and
// buttons are surfaced as empty arrays — the field shape stays identical to the
// Windows agent so server-side consumers need no change.

import { which } from './shared/command'
import { execFile } from 'child_process'
import { getRobot } from './shared/robot'

type CursorPoint = { x: number; y: number }

interface HandsSnapshot {
  timestamp: number
  mouse: CursorPoint
  window: { hwnd: number; title: string }
  keys: string[]
  buttons: string[]
}

interface HandsEvent {
  id: number
  timestamp: number
  type: string
  data: any
}

// Resolve the active window id + title via xdotool. Returns a zeroed value when
// xdotool is missing or there is no focused window.
function getActiveWindow(): Promise<{ hwnd: number; title: string }> {
  return new Promise(resolve => {
    if (!which('xdotool')) return resolve({ hwnd: 0, title: '' })
    execFile('xdotool', ['getactivewindow', 'getwindowname'], { timeout: 1000 }, (err, stdout) => {
      if (err) return resolve({ hwnd: 0, title: '' })
      const lines = String(stdout).split('\n').map(s => s.trim()).filter(Boolean)
      const hwnd = parseInt(lines[0], 10)
      resolve({ hwnd: Number.isFinite(hwnd) ? hwnd : 0, title: lines.slice(1).join(' ') })
    })
  })
}

class HandsMonitor {
  private timer: NodeJS.Timeout | null = null
  private latest: HandsSnapshot | null = null
  private events: HandsEvent[] = []
  private lastMouse: CursorPoint | null = null
  private lastWindow = { hwnd: 0, title: '' }
  private sequence = 0
  private lastError: string | null = null
  private polling = false

  start(intervalMs = 120) {
    if (this.timer) return { running: true, intervalMs }
    const tick = async () => {
      if (this.polling) return
      this.polling = true
      try {
        await this.poll()
      } catch (err: any) {
        this.lastError = err?.message || String(err)
      } finally {
        this.polling = false
      }
    }
    this.timer = setInterval(tick, intervalMs)
    void tick()
    return { running: true, intervalMs }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    return { running: false }
  }

  snapshot() {
    if (!this.timer) this.start()
    return {
      running: !!this.timer,
      latest: this.latest,
      lastError: this.lastError,
      events: this.events.slice(-20),
    }
  }

  readEvents(sinceId = 0) {
    return {
      running: !!this.timer,
      cursor: this.sequence,
      events: this.events.filter(event => event.id > sinceId),
      lastError: this.lastError,
    }
  }

  private pushEvent(type: string, data: any) {
    const event: HandsEvent = { id: ++this.sequence, timestamp: Date.now(), type, data }
    this.events.push(event)
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200)
  }

  private async poll() {
    let mouse: CursorPoint = { x: 0, y: 0 }
    try {
      const pos = getRobot().getMousePos()
      mouse = { x: Number(pos.x) || 0, y: Number(pos.y) || 0 }
    } catch (err: any) {
      this.lastError = err?.message || String(err)
    }
    const window = await getActiveWindow()

    const snapshot: HandsSnapshot = {
      timestamp: Date.now(),
      mouse,
      window,
      keys: [],
      buttons: [],
    }
    this.latest = snapshot

    if (!this.lastMouse || this.lastMouse.x !== mouse.x || this.lastMouse.y !== mouse.y) {
      this.pushEvent('mouse_move', { mouse })
      this.lastMouse = { ...mouse }
    }
    if (this.lastWindow.hwnd !== window.hwnd || this.lastWindow.title !== window.title) {
      this.pushEvent('window_change', { window })
      this.lastWindow = { ...window }
    }
  }
}

const monitor = new HandsMonitor()

export async function handsStart(args: any = {}) {
  const intervalMs = Number(args.interval_ms || args.intervalMs || 120)
  return monitor.start(Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 120)
}

export async function handsStop() {
  return monitor.stop()
}

export async function handsSnapshot() {
  return monitor.snapshot()
}

export async function handsEvents(args: any = {}) {
  const sinceId = Number(args.since_id || args.sinceId || 0)
  return monitor.readEvents(Number.isFinite(sinceId) ? sinceId : 0)
}

export async function handsMouse(_args: any = {}) {
  const robot = getRobot()
  const pos = robot.getMousePos()
  return { success: true, mouse: pos }
}
