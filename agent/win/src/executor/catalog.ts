// Default tool catalog — registers every built-in tool with the registry.
// Imported once for its side effects via executor/index.ts.

import { listFiles, readFile, writeFile } from '../tools/filesystem'
import { runCommand } from '../tools/shell'
import { gitDiff } from '../tools/git'
import { keyboardType, keyboardPress } from '../tools/keyboard'
import {
  mouseMove, mouseClick, mouseDoubleClick, mouseRightClick, mouseScroll, mouseDrag,
} from '../tools/mouse'
import { screenCapture, screenCaptureRegion, screenInfo } from '../tools/screen'
import { clipboardGet, clipboardSet } from '../tools/clipboard'
import { windowList, windowFocus, windowClose } from '../tools/window'
import { processList, processKill } from '../tools/process'
import { mouthSpeak } from '../tools/mouth'
import { visionCaptureGlobal, visionCaptureMouse } from '../tools/vision'
import { handsStart, handsStop, handsSnapshot, handsEvents, handsMouse } from '../tools/hands'
import { earStart, earStop, earLatest } from '../tools/ear'
import { registerTools } from './registry'

registerTools([
  // Filesystem (cross-platform)
  { id: 'fs.list',  platform: 'all', handler: ({ workspaceRoot, args }) => listFiles(workspaceRoot, args) },
  { id: 'fs.read',  platform: 'all', handler: ({ workspaceRoot, args }) => readFile(workspaceRoot, args) },
  { id: 'fs.write', platform: 'all', handler: ({ workspaceRoot, args }) => writeFile(workspaceRoot, args) },

  // Shell & git (cross-platform)
  { id: 'shell.run', platform: 'all', handler: ({ workspaceRoot, args }) => runCommand(workspaceRoot, args) },
  { id: 'git.diff',  platform: 'all', handler: ({ workspaceRoot, args }) => gitDiff(workspaceRoot, args) },

  // Keyboard (windows-only via robotjs)
  { id: 'keyboard.type',  platform: 'windows', handler: ({ args }) => keyboardType(args) },
  { id: 'keyboard.press', platform: 'windows', handler: ({ args }) => keyboardPress(args) },

  // Mouse (windows-only via robotjs)
  { id: 'mouse.move',         platform: 'windows', handler: ({ args }) => mouseMove(args) },
  { id: 'mouse.click',        platform: 'windows', handler: ({ args }) => mouseClick(args) },
  { id: 'mouse.double_click', platform: 'windows', handler: ({ args }) => mouseDoubleClick(args) },
  { id: 'mouse.right_click',  platform: 'windows', handler: ({ args }) => mouseRightClick(args) },
  { id: 'mouse.scroll',       platform: 'windows', handler: ({ args }) => mouseScroll(args) },
  { id: 'mouse.drag',         platform: 'windows', handler: ({ args }) => mouseDrag(args) },

  // Screen (windows-only via Electron desktopCapturer + robotjs)
  { id: 'screen.capture',        platform: 'windows', handler: ({ args }) => screenCapture(args) },
  { id: 'screen.capture_region', platform: 'windows', handler: ({ args }) => screenCaptureRegion(args) },
  { id: 'screen.info',           platform: 'windows', handler: ({ args }) => screenInfo(args) },

  // Clipboard (Electron clipboard is cross-platform but our app is Windows-targeted)
  { id: 'clipboard.get', platform: 'windows', handler: ({ args }) => clipboardGet(args) },
  { id: 'clipboard.set', platform: 'windows', handler: ({ args }) => clipboardSet(args) },

  // Window management (windows-only — uses PowerShell)
  { id: 'window.list',  platform: 'windows', handler: ({ workspaceRoot, args }) => windowList(workspaceRoot, args) },
  { id: 'window.focus', platform: 'windows', handler: ({ workspaceRoot, args }) => windowFocus(workspaceRoot, args) },
  { id: 'window.close', platform: 'windows', handler: ({ workspaceRoot, args }) => windowClose(workspaceRoot, args) },

  // Process management (windows-only — uses PowerShell)
  { id: 'process.list', platform: 'windows', handler: ({ workspaceRoot, args }) => processList(workspaceRoot, args) },
  { id: 'process.kill', platform: 'windows', handler: ({ workspaceRoot, args }) => processKill(workspaceRoot, args) },

  // AI voice / vision / hands / ear helpers (windows-only)
  { id: 'speech.speak',      platform: 'windows', handler: ({ args }) => mouthSpeak(args) },
  { id: 'vision.capture',     platform: 'windows', handler: ({ args }) => visionCaptureGlobal(args) },
  { id: 'vision.capture_mouse', platform: 'windows', handler: ({ args }) => visionCaptureMouse(args) },
  { id: 'hands.start',       platform: 'windows', handler: ({ args }) => handsStart(args) },
  { id: 'hands.stop',        platform: 'windows', handler: ({ args }) => handsStop() },
  { id: 'hands.snapshot',    platform: 'windows', handler: ({ args }) => handsSnapshot() },
  { id: 'hands.events',      platform: 'windows', handler: ({ args }) => handsEvents(args) },
  { id: 'hands.mouse',       platform: 'windows', handler: ({ args }) => handsMouse(args) },
  { id: 'ear.start',         platform: 'windows', handler: () => earStart() },
  { id: 'ear.stop',          platform: 'windows', handler: () => earStop() },
  { id: 'ear.latest',        platform: 'windows', handler: () => earLatest() },
])
