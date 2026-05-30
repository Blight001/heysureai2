import * as readline from 'readline'
import { spawnPowerShellScript } from './shared/powershell'
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

const KEY_CODES: Array<[string, number]> = [
  ['ctrl', 0x11], ['shift', 0x10], ['alt', 0x12], ['win', 0x5b],
  ['enter', 0x0d], ['tab', 0x09], ['escape', 0x1b], ['space', 0x20],
  ['backspace', 0x08], ['delete', 0x2e], ['insert', 0x2d],
  ['left', 0x25], ['up', 0x26], ['right', 0x27], ['down', 0x28],
  ['home', 0x24], ['end', 0x23], ['pageup', 0x21], ['pagedown', 0x22],
  ['capslock', 0x14],
  ['f1', 0x70], ['f2', 0x71], ['f3', 0x72], ['f4', 0x73], ['f5', 0x74],
  ['f6', 0x75], ['f7', 0x76], ['f8', 0x77], ['f9', 0x78], ['f10', 0x79],
  ['f11', 0x7a], ['f12', 0x7b],
]

for (let code = 0x30; code <= 0x39; code += 1) {
  KEY_CODES.push([String.fromCharCode(code), code])
}
for (let code = 0x41; code <= 0x5a; code += 1) {
  KEY_CODES.push([String.fromCharCode(code + 32), code])
}

const BUTTON_CODES: Array<[string, number]> = [
  ['left_button', 0x01],
  ['right_button', 0x02],
  ['middle_button', 0x04],
]

function buildMonitorScript(intervalMs: number): string {
  const keyEntries = KEY_CODES.map(([name, code]) => `@{ name = '${name}'; code = 0x${code.toString(16)} }`).join(',\n    ')
  const buttonEntries = BUTTON_CODES.map(([name, code]) => `@{ name = '${name}'; code = 0x${code.toString(16)} }`).join(',\n    ')

  return `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class HSInput {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
}
"@
$script:keys = @(
    ${keyEntries}
)
$script:buttons = @(
    ${buttonEntries}
)
function Get-Snapshot {
  $pt = New-Object HSInput+POINT
  [void][HSInput]::GetCursorPos([ref]$pt)
  $hWnd = [HSInput]::GetForegroundWindow()
  $titleBuilder = New-Object System.Text.StringBuilder 512
  [void][HSInput]::GetWindowText($hWnd, $titleBuilder, $titleBuilder.Capacity)
  $pressedKeys = @()
  foreach ($k in $script:keys) {
    if (([HSInput]::GetAsyncKeyState($k.code) -band 0x8000) -ne 0) { $pressedKeys += $k.name }
  }
  $pressedButtons = @()
  foreach ($b in $script:buttons) {
    if (([HSInput]::GetAsyncKeyState($b.code) -band 0x8000) -ne 0) { $pressedButtons += $b.name }
  }
  [PSCustomObject]@{
    type = 'snapshot'
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    mouse = @{ x = $pt.X; y = $pt.Y }
    window = @{ hwnd = [int64]$hWnd; title = $titleBuilder.ToString() }
    keys = $pressedKeys
    buttons = $pressedButtons
  }
}
while ($true) {
  Get-Snapshot | ConvertTo-Json -Compress -Depth 4
  Start-Sleep -Milliseconds ${intervalMs}
}
`
}

class HandsMonitor {
  private child: ReturnType<typeof spawnPowerShellScript> | null = null
  private latest: HandsSnapshot | null = null
  private events: HandsEvent[] = []
  private lastKeys = new Set<string>()
  private lastButtons = new Set<string>()
  private lastMouse: CursorPoint | null = null
  private lastWindow = { hwnd: 0, title: '' }
  private sequence = 0
  private lastError: string | null = null

  start(intervalMs = 120) {
    if (this.child) return { running: true, intervalMs }
    const script = buildMonitorScript(intervalMs)
    this.child = spawnPowerShellScript(script)
    const rl = readline.createInterface({ input: this.child.stdout })
    rl.on('line', line => this.onLine(line))
    this.child.stderr.on('data', chunk => {
      const text = chunk.toString().trim()
      if (text) this.lastError = text
    })
    this.child.on('close', () => {
      this.child = null
    })
    return { running: true, intervalMs }
  }

  stop() {
    if (this.child) {
      this.child.kill()
      this.child = null
    }
    return { running: false }
  }

  snapshot() {
    if (!this.child) this.start()
    return {
      running: !!this.child,
      latest: this.latest,
      lastError: this.lastError,
      events: this.events.slice(-20),
    }
  }

  readEvents(sinceId = 0) {
    return {
      running: !!this.child,
      cursor: this.sequence,
      events: this.events.filter(event => event.id > sinceId),
      lastError: this.lastError,
    }
  }

  private pushEvent(type: string, data: any) {
    const event: HandsEvent = {
      id: ++this.sequence,
      timestamp: Date.now(),
      type,
      data,
    }
    this.events.push(event)
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200)
  }

  private onLine(line: string) {
    const trimmed = line.trim()
    if (!trimmed) return
    let snapshot: HandsSnapshot | null = null
    try {
      const parsed = JSON.parse(trimmed)
      snapshot = {
        timestamp: Number(parsed.timestamp || Date.now()),
        mouse: {
          x: Number(parsed.mouse?.x || 0),
          y: Number(parsed.mouse?.y || 0),
        },
        window: {
          hwnd: Number(parsed.window?.hwnd || 0),
          title: String(parsed.window?.title || ''),
        },
        keys: Array.isArray(parsed.keys) ? parsed.keys.map(String) : [],
        buttons: Array.isArray(parsed.buttons) ? parsed.buttons.map(String) : [],
      }
    } catch {
      this.lastError = trimmed
      return
    }

    this.latest = snapshot

    const mouseChanged = !this.lastMouse || this.lastMouse.x !== snapshot.mouse.x || this.lastMouse.y !== snapshot.mouse.y
    if (mouseChanged) {
      this.pushEvent('mouse_move', { mouse: snapshot.mouse })
      this.lastMouse = { ...snapshot.mouse }
    }

    const windowChanged = this.lastWindow.hwnd !== snapshot.window.hwnd || this.lastWindow.title !== snapshot.window.title
    if (windowChanged) {
      this.pushEvent('window_change', { window: snapshot.window })
      this.lastWindow = { ...snapshot.window }
    }

    const currentKeys = new Set(snapshot.keys)
    for (const key of currentKeys) {
      if (!this.lastKeys.has(key)) this.pushEvent('key_down', { key })
    }
    for (const key of this.lastKeys) {
      if (!currentKeys.has(key)) this.pushEvent('key_up', { key })
    }
    this.lastKeys = currentKeys

    const currentButtons = new Set(snapshot.buttons)
    for (const button of currentButtons) {
      if (!this.lastButtons.has(button)) this.pushEvent('button_down', { button })
    }
    for (const button of this.lastButtons) {
      if (!currentButtons.has(button)) this.pushEvent('button_up', { button })
    }
    this.lastButtons = currentButtons
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

export async function handsMouse(args: any = {}) {
  const robot = getRobot()
  const pos = robot.getMousePos()
  return {
    success: true,
    mouse: pos,
  }
}

