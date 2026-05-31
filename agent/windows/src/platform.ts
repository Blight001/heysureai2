import * as os from 'os'

export const IS_WINDOWS = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
export const IS_LINUX = process.platform === 'linux'

export const WINDOWS_CAPABILITIES = [
  'fs.list', 'fs.read', 'fs.write',
  'shell.run', 'git.diff',
  'keyboard.type', 'keyboard.press',
  'mouse.move', 'mouse.click', 'mouse.double_click', 'mouse.right_click', 'mouse.scroll', 'mouse.drag',
  'screen.capture', 'screen.capture_region', 'screen.info',
  'clipboard.get', 'clipboard.set',
  'window.list', 'window.focus', 'window.close',
  'process.list', 'process.kill',
  'speech.speak',
  'vision.capture', 'vision.capture_mouse',
  'hands.start', 'hands.stop', 'hands.snapshot', 'hands.events', 'hands.mouse',
  'ear.start', 'ear.stop', 'ear.latest',
]

export const OTHER_CAPABILITIES = [
  'fs.list', 'fs.read', 'fs.write',
  'shell.run', 'git.diff',
]

export function getCapabilities(): string[] {
  return IS_WINDOWS ? WINDOWS_CAPABILITIES : OTHER_CAPABILITIES
}

export function getPlatformInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
  }
}
