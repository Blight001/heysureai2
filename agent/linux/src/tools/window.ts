// Window management on Linux/X11. Uses wmctrl when available (clean machine
// output with PID + title) and falls back to xdotool. Both are standard tools
// in the same family already used for keyboard/mouse automation.

import { runCmd, which, requireBin } from './shared/command'

interface WinInfo {
  hwnd: number
  pid: number
  title: string
  desktop: number
}

// Parse `wmctrl -lpx` output. Columns: id desktop pid wm_class host title
function parseWmctrl(stdout: string): WinInfo[] {
  const out: WinInfo[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const cols = trimmed.split(/\s+/)
    if (cols.length < 6) continue
    const hwnd = parseInt(cols[0], 16)
    const desktop = parseInt(cols[1], 10)
    const pid = parseInt(cols[2], 10)
    // cols[3] = wm_class, cols[4] = host, rest = title (may contain spaces)
    const title = cols.slice(5).join(' ')
    if (desktop === -1) continue // skip docks / panels pinned to all desktops
    out.push({ hwnd, pid: Number.isFinite(pid) ? pid : 0, title, desktop: Number.isFinite(desktop) ? desktop : 0 })
  }
  return out
}

export async function windowList(_workspaceRoot: string, _args: any = {}) {
  if (which('wmctrl')) {
    const result = await runCmd('wmctrl', ['-lpx'])
    if (result.exitCode === 0) {
      const windows = parseWmctrl(result.stdout)
      return { success: true, count: windows.length, windows }
    }
  }
  // Fallback: enumerate via xdotool.
  const xdotool = requireBin('xdotool', '请安装 wmctrl 或 xdotool：sudo apt install wmctrl xdotool')
  const ids = await runCmd(xdotool, ['search', '--onlyvisible', '--name', ''])
  const windows: WinInfo[] = []
  for (const idStr of ids.stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
    const id = parseInt(idStr, 10)
    if (!Number.isFinite(id)) continue
    const [nameR, pidR] = await Promise.all([
      runCmd(xdotool, ['getwindowname', idStr]),
      runCmd(xdotool, ['getwindowpid', idStr]),
    ])
    const title = nameR.stdout.trim()
    if (!title) continue
    windows.push({ hwnd: id, pid: parseInt(pidR.stdout.trim(), 10) || 0, title, desktop: 0 })
  }
  return { success: true, count: windows.length, windows }
}

export async function windowFocus(_workspaceRoot: string, args: any) {
  const title = String(args.title || '')
  if (!title) throw new Error('title is required for window.focus')

  if (which('wmctrl')) {
    // -F would require an exact match; default substring match is friendlier.
    const result = await runCmd('wmctrl', ['-a', title])
    if (result.exitCode === 0) return { success: true, title, via: 'wmctrl' }
  }
  const xdotool = requireBin('xdotool', '请安装 wmctrl 或 xdotool')
  const search = await runCmd(xdotool, ['search', '--name', title])
  const firstId = search.stdout.split('\n').map(s => s.trim()).filter(Boolean)[0]
  if (!firstId) return { success: false, title, error: '未找到匹配标题的窗口' }
  const result = await runCmd(xdotool, ['windowactivate', '--sync', firstId])
  return { success: result.exitCode === 0, title, via: 'xdotool', stderr: result.stderr || '' }
}

export async function windowClose(_workspaceRoot: string, args: any) {
  const title = String(args.title || '')
  const pid = args.pid ? Number(args.pid) : null
  if (!title && !pid) throw new Error('title or pid is required for window.close')

  if (pid) {
    // Graceful terminate of the owning process closes its windows.
    const result = await runCmd('kill', ['-TERM', String(pid)])
    return { success: result.exitCode === 0, title: title || null, pid, stderr: result.stderr || '' }
  }

  if (which('wmctrl')) {
    const result = await runCmd('wmctrl', ['-c', title])
    if (result.exitCode === 0) return { success: true, title, pid: null, via: 'wmctrl' }
  }
  const xdotool = requireBin('xdotool', '请安装 wmctrl 或 xdotool')
  const search = await runCmd(xdotool, ['search', '--name', title])
  const firstId = search.stdout.split('\n').map(s => s.trim()).filter(Boolean)[0]
  if (!firstId) return { success: false, title, pid: null, error: '未找到匹配标题的窗口' }
  const result = await runCmd(xdotool, ['windowclose', firstId])
  return { success: result.exitCode === 0, title, pid: null, via: 'xdotool' }
}
