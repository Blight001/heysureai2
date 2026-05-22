import * as path from 'path'
import { listFiles, readFile, writeFile } from './tools/filesystem'
import { runCommand } from './tools/shell'
import { gitDiff } from './tools/git'
import { keyboardType, keyboardPress } from './tools/keyboard'
import { mouseMove, mouseClick, mouseDoubleClick, mouseRightClick, mouseScroll, mouseDrag } from './tools/mouse'
import { screenCapture, screenCaptureRegion, screenInfo } from './tools/screen'
import { clipboardGet, clipboardSet } from './tools/clipboard'
import { windowList, windowFocus, windowClose } from './tools/window'
import { processList, processKill } from './tools/process'
import { IS_WINDOWS } from './platform'

export interface DispatchedTask {
  taskId: string
  userId?: string | number
  aiConfigId?: string | number
  sessionId?: string
  instruction?: string
  tool?: string
  args?: Record<string, any>
  allowedTools?: string[]
}

export interface TaskResult {
  success: boolean
  tool: string
  result: any
  summary: string
}

// Infer tool from instruction text (Chinese + English keywords)
function inferTool(instruction: string): string {
  const t = instruction.toLowerCase()
  if (/截图|screenshot|screen capture|屏幕/.test(t)) return 'screen.capture'
  if (/键盘|输入文字|type text|keyboard/.test(t)) return 'keyboard.type'
  if (/点击|click|鼠标/.test(t)) return 'mouse.click'
  if (/窗口列表|list window/.test(t)) return 'window.list'
  if (/进程|process/.test(t)) return 'process.list'
  if (/剪贴板|clipboard/.test(t)) return 'clipboard.get'
  if (/git diff|改动|变更/.test(t)) return 'git.diff'
  if (/运行|执行|run|命令|command/.test(t)) return 'shell.run'
  if (/列出|ls|list|文件列表/.test(t)) return 'fs.list'
  if (/读取|read|查看/.test(t)) return 'fs.read'
  if (/写入|创建文件|write|create file/.test(t)) return 'fs.write'
  return 'shell.run'
}

export async function executeTask(workspaceRoot: string, task: DispatchedTask): Promise<TaskResult> {
  const tool = task.tool || inferTool(task.instruction || '')
  const args = task.args || {}

  // Build instruction into args for tools that use it
  if (!task.tool && task.instruction) {
    args.instruction = task.instruction
    if (!args.command && tool === 'shell.run') args.command = task.instruction
  }

  try {
    let result: any
    switch (tool) {
      // Filesystem
      case 'fs.list': result = listFiles(workspaceRoot, args); break
      case 'fs.read': result = readFile(workspaceRoot, args); break
      case 'fs.write': result = writeFile(workspaceRoot, args); break
      // Shell & git
      case 'shell.run': result = await runCommand(workspaceRoot, args); break
      case 'git.diff': result = await gitDiff(workspaceRoot, args); break
      // Keyboard (Windows-only)
      case 'keyboard.type': result = await keyboardType(args); break
      case 'keyboard.press': result = await keyboardPress(args); break
      // Mouse (Windows-only)
      case 'mouse.move': result = await mouseMove(args); break
      case 'mouse.click': result = await mouseClick(args); break
      case 'mouse.double_click': result = await mouseDoubleClick(args); break
      case 'mouse.right_click': result = await mouseRightClick(args); break
      case 'mouse.scroll': result = await mouseScroll(args); break
      case 'mouse.drag': result = await mouseDrag(args); break
      // Screen (Windows-only)
      case 'screen.capture': result = await screenCapture(args); break
      case 'screen.capture_region': result = await screenCaptureRegion(args); break
      case 'screen.info': result = await screenInfo(args); break
      // Clipboard (Windows-only)
      case 'clipboard.get': result = clipboardGet(args); break
      case 'clipboard.set': result = clipboardSet(args); break
      // Window management (Windows-only)
      case 'window.list': result = await windowList(workspaceRoot, args); break
      case 'window.focus': result = await windowFocus(workspaceRoot, args); break
      case 'window.close': result = await windowClose(workspaceRoot, args); break
      // Process management (Windows-only)
      case 'process.list': result = await processList(workspaceRoot, args); break
      case 'process.kill': result = await processKill(workspaceRoot, args); break
      default:
        throw new Error(`Unknown tool: ${tool}. Use one of: ${getAvailableTools().join(', ')}`)
    }
    return { success: true, tool, result, summary: `${tool} completed successfully` }
  } catch (err: any) {
    return { success: false, tool, result: null, summary: err.message || String(err) }
  }
}

export function getAvailableTools(): string[] {
  if (IS_WINDOWS) {
    return [
      'fs.list', 'fs.read', 'fs.write', 'shell.run', 'git.diff',
      'keyboard.type', 'keyboard.press',
      'mouse.move', 'mouse.click', 'mouse.double_click', 'mouse.right_click', 'mouse.scroll', 'mouse.drag',
      'screen.capture', 'screen.capture_region', 'screen.info',
      'clipboard.get', 'clipboard.set',
      'window.list', 'window.focus', 'window.close',
      'process.list', 'process.kill',
    ]
  }
  return ['fs.list', 'fs.read', 'fs.write', 'shell.run', 'git.diff']
}
