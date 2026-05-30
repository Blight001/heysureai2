// Default tool catalog — registers every built-in tool with the registry.
// Imported once for its side effects via executor/index.ts.
//
// Each entry carries its own MCP schema (description + inputSchema). These are
// shipped to the server at register time (agent:register -> toolDefs) and are
// the single source of truth for how this tool is described to the AI. The
// server no longer hardcodes desktop tool schemas — add a tool here and it
// shows up in mcp.list_tools / describe_tool with no server change.

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

const OBJ = (properties: Record<string, any>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: true,
})

registerTools([
  // Filesystem (cross-platform)
  {
    id: 'fs.list', platform: 'all',
    description: 'List files and subdirectories under a path in the agent workspace.',
    inputSchema: OBJ({ path: { type: 'string', description: 'Directory path relative to the workspace root. Defaults to ".".' } }),
    handler: ({ workspaceRoot, args }) => listFiles(workspaceRoot, args),
  },
  {
    id: 'fs.read', platform: 'all',
    description: 'Read the contents of a file in the agent workspace.',
    inputSchema: OBJ({
      path: { type: 'string', description: 'File path relative to the workspace root.' },
      maxBytes: { type: 'number', description: 'Maximum bytes to read before truncating.' },
    }, ['path']),
    handler: ({ workspaceRoot, args }) => readFile(workspaceRoot, args),
  },
  {
    id: 'fs.write', platform: 'all',
    description: 'Create or overwrite a file in the agent workspace.',
    inputSchema: OBJ({
      path: { type: 'string', description: 'File path relative to the workspace root.' },
      content: { type: 'string', description: 'Full file contents to write.' },
    }, ['path', 'content']),
    handler: ({ workspaceRoot, args }) => writeFile(workspaceRoot, args),
  },

  // Shell & git (cross-platform)
  {
    id: 'shell.run', platform: 'all',
    description: 'Run a shell command in the agent workspace and return its output.',
    inputSchema: OBJ({
      command: { type: 'string', description: 'Command line to execute.' },
      cwd: { type: 'string', description: 'Working directory relative to the workspace root.' },
      timeout_ms: { type: 'number', description: 'Hard timeout in milliseconds.' },
    }, ['command']),
    handler: ({ workspaceRoot, args }) => runCommand(workspaceRoot, args),
  },
  {
    id: 'git.diff', platform: 'all',
    description: 'Show the current git diff for the workspace (or a subdirectory).',
    inputSchema: OBJ({ cwd: { type: 'string', description: 'Repository directory relative to the workspace root.' } }),
    handler: ({ workspaceRoot, args }) => gitDiff(workspaceRoot, args),
  },

  // Keyboard (windows-only via robotjs)
  {
    id: 'keyboard.type', platform: 'windows',
    description: 'Type text at the current focus on the desktop.',
    inputSchema: OBJ({
      text: { type: 'string', description: 'Text to type.' },
      delay_ms: { type: 'number', description: 'Per-character delay in milliseconds.' },
    }, ['text']),
    handler: ({ args }) => keyboardType(args),
  },
  {
    id: 'keyboard.press', platform: 'windows',
    description: 'Press a single key or key combination (e.g. "ctrl+c", "enter").',
    inputSchema: OBJ({ keys: { type: 'string', description: 'Key or "+"-joined combo, e.g. "ctrl+shift+esc".' } }, ['keys']),
    handler: ({ args }) => keyboardPress(args),
  },

  // Mouse (windows-only via robotjs)
  {
    id: 'mouse.move', platform: 'windows',
    description: 'Move the mouse cursor to a screen coordinate.',
    inputSchema: OBJ({
      x: { type: 'number' }, y: { type: 'number' },
      smooth: { type: 'boolean', description: 'Animate the move. Default true.' },
    }, ['x', 'y']),
    handler: ({ args }) => mouseMove(args),
  },
  {
    id: 'mouse.click', platform: 'windows',
    description: 'Click the mouse, optionally first moving to a coordinate.',
    inputSchema: OBJ({
      x: { type: 'number' }, y: { type: 'number' },
      button: { type: 'string', description: 'left, right, or middle. Default left.' },
    }),
    handler: ({ args }) => mouseClick(args),
  },
  {
    id: 'mouse.double_click', platform: 'windows',
    description: 'Double-click the mouse, optionally first moving to a coordinate.',
    inputSchema: OBJ({ x: { type: 'number' }, y: { type: 'number' } }),
    handler: ({ args }) => mouseDoubleClick(args),
  },
  {
    id: 'mouse.right_click', platform: 'windows',
    description: 'Right-click the mouse, optionally first moving to a coordinate.',
    inputSchema: OBJ({ x: { type: 'number' }, y: { type: 'number' } }),
    handler: ({ args }) => mouseRightClick(args),
  },
  {
    id: 'mouse.scroll', platform: 'windows',
    description: 'Scroll the mouse wheel at the current or given position.',
    inputSchema: OBJ({
      x: { type: 'number' }, y: { type: 'number' },
      amount: { type: 'number', description: 'Number of scroll steps. Default 3.' },
      direction: { type: 'string', description: 'up or down. Default down.' },
    }),
    handler: ({ args }) => mouseScroll(args),
  },
  {
    id: 'mouse.drag', platform: 'windows',
    description: 'Press at one point, drag to another, and release.',
    inputSchema: OBJ({
      from_x: { type: 'number' }, from_y: { type: 'number' },
      to_x: { type: 'number' }, to_y: { type: 'number' },
    }, ['from_x', 'from_y', 'to_x', 'to_y']),
    handler: ({ args }) => mouseDrag(args),
  },

  // Screen (windows-only via Electron desktopCapturer + robotjs)
  {
    id: 'screen.capture', platform: 'windows',
    description: 'Capture a full screenshot of a desktop display. By default the server stores it under the user\'s Screenshots workspace folder.',
    inputSchema: OBJ({
      display: { type: 'number', description: 'Display index to capture. Default 0.' },
      screen: { type: 'number', description: 'Alias of display.' },
      upload_to_server: { type: 'boolean', description: 'Default true. Store on the server and return its workspace path.' },
    }),
    handler: ({ args }) => screenCapture(args),
  },
  {
    id: 'screen.capture_region', platform: 'windows',
    description: 'Capture a rectangular region of the desktop.',
    inputSchema: OBJ({
      x: { type: 'number' }, y: { type: 'number' },
      width: { type: 'number' }, height: { type: 'number' },
      upload_to_server: { type: 'boolean', description: 'Default true. Store on the server and return its workspace path.' },
    }, ['width', 'height']),
    handler: ({ args }) => screenCaptureRegion(args),
  },
  {
    id: 'screen.info', platform: 'windows',
    description: 'List the desktop displays and their resolutions.',
    inputSchema: OBJ({}),
    handler: ({ args }) => screenInfo(args),
  },

  // Clipboard (Electron clipboard is cross-platform but our app is Windows-targeted)
  {
    id: 'clipboard.get', platform: 'windows',
    description: 'Read the system clipboard.',
    inputSchema: OBJ({ format: { type: 'string', description: 'text or html. Default text.' } }),
    handler: ({ args }) => clipboardGet(args),
  },
  {
    id: 'clipboard.set', platform: 'windows',
    description: 'Write text to the system clipboard.',
    inputSchema: OBJ({ text: { type: 'string', description: 'Text to place on the clipboard.' } }, ['text']),
    handler: ({ args }) => clipboardSet(args),
  },

  // Window management (windows-only — uses PowerShell)
  {
    id: 'window.list', platform: 'windows',
    description: 'List visible top-level windows with their titles and PIDs.',
    inputSchema: OBJ({}),
    handler: ({ workspaceRoot, args }) => windowList(workspaceRoot, args),
  },
  {
    id: 'window.focus', platform: 'windows',
    description: 'Bring a window matching a title to the foreground.',
    inputSchema: OBJ({ title: { type: 'string', description: 'Window title substring to match.' } }, ['title']),
    handler: ({ workspaceRoot, args }) => windowFocus(workspaceRoot, args),
  },
  {
    id: 'window.close', platform: 'windows',
    description: 'Close a window by title or process id.',
    inputSchema: OBJ({
      title: { type: 'string', description: 'Window title substring to match.' },
      pid: { type: 'number', description: 'Process id whose window to close.' },
    }),
    handler: ({ workspaceRoot, args }) => windowClose(workspaceRoot, args),
  },

  // Process management (windows-only — uses PowerShell)
  {
    id: 'process.list', platform: 'windows',
    description: 'List running processes, optionally filtered by name.',
    inputSchema: OBJ({ filter: { type: 'string', description: 'Process name substring to filter by.' } }),
    handler: ({ workspaceRoot, args }) => processList(workspaceRoot, args),
  },
  {
    id: 'process.kill', platform: 'windows',
    description: 'Terminate a process by name or process id.',
    inputSchema: OBJ({
      name: { type: 'string', description: 'Process name to kill.' },
      pid: { type: 'number', description: 'Process id to kill.' },
    }),
    handler: ({ workspaceRoot, args }) => processKill(workspaceRoot, args),
  },

  // AI voice / vision / hands / ear helpers (windows-only)
  {
    id: 'speech.speak', platform: 'windows',
    description: 'Speak text aloud through the desktop text-to-speech voice.',
    inputSchema: OBJ({
      text: { type: 'string', description: 'Text to speak.' },
      rate: { type: 'number', description: 'Speaking rate, -10 to 10.' },
      volume: { type: 'number', description: 'Volume 0-100.' },
      voice: { type: 'string', description: 'Voice name to use.' },
    }, ['text']),
    handler: ({ args }) => mouthSpeak(args),
  },
  {
    id: 'vision.capture', platform: 'windows',
    description: 'Capture the full screen for visual understanding.',
    inputSchema: OBJ({}),
    handler: ({ args }) => visionCaptureGlobal(args),
  },
  {
    id: 'vision.capture_mouse', platform: 'windows',
    description: 'Capture a region around the mouse cursor for visual understanding.',
    inputSchema: OBJ({
      radius: { type: 'number', description: 'Half-size of the capture box in pixels. Default 50.' },
      width: { type: 'number' }, height: { type: 'number' },
    }),
    handler: ({ args }) => visionCaptureMouse(args),
  },
  {
    id: 'hands.start', platform: 'windows',
    description: 'Start capturing live input (mouse/keyboard) events from the desktop.',
    inputSchema: OBJ({ interval_ms: { type: 'number', description: 'Sampling interval in milliseconds. Default 120.' } }),
    handler: ({ args }) => handsStart(args),
  },
  {
    id: 'hands.stop', platform: 'windows',
    description: 'Stop capturing live input events.',
    inputSchema: OBJ({}),
    handler: () => handsStop(),
  },
  {
    id: 'hands.snapshot', platform: 'windows',
    description: 'Return the current input state snapshot (mouse position, pressed keys).',
    inputSchema: OBJ({}),
    handler: () => handsSnapshot(),
  },
  {
    id: 'hands.events', platform: 'windows',
    description: 'Return buffered input events newer than a given id.',
    inputSchema: OBJ({ since_id: { type: 'number', description: 'Return events with id greater than this. Default 0.' } }),
    handler: ({ args }) => handsEvents(args),
  },
  {
    id: 'hands.mouse', platform: 'windows',
    description: 'Replay or inject a mouse action through the live input channel.',
    inputSchema: OBJ({
      x: { type: 'number' }, y: { type: 'number' },
      button: { type: 'string' }, action: { type: 'string' },
    }),
    handler: ({ args }) => handsMouse(args),
  },
  {
    id: 'ear.start', platform: 'windows',
    description: 'Start listening to the microphone for speech recognition.',
    inputSchema: OBJ({}),
    handler: () => earStart(),
  },
  {
    id: 'ear.stop', platform: 'windows',
    description: 'Stop listening to the microphone.',
    inputSchema: OBJ({}),
    handler: () => earStop(),
  },
  {
    id: 'ear.latest', platform: 'windows',
    description: 'Return the latest recognized speech transcript.',
    inputSchema: OBJ({}),
    handler: () => earLatest(),
  },
])
