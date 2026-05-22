import os from 'os';

export const IS_WINDOWS = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export const IS_LINUX = process.platform === 'linux';
export const PLATFORM = os.platform();

export function getPlatformInfo() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    hostname: os.hostname(),
  };
}

export function getCapabilities(): string[] {
  // Headless agent: base capabilities only
  return ['fs.list', 'fs.read', 'fs.write', 'shell.run', 'git.diff'];
}

export function getPlatformNote(): string {
  if (IS_WINDOWS) {
    return 'Windows detected — this is the headless agent. Use agent/win for full keyboard/mouse/screen/clipboard capabilities.';
  }
  return `Headless agent on ${PLATFORM} — base fs/shell/git capabilities only.`;
}
