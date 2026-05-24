// Best-effort tool inference from a free-text instruction.
// Used when the server dispatches a task without an explicit `tool` field —
// matches Chinese + English keywords against built-in tool ids.

interface Rule { pattern: RegExp; tool: string }

const RULES: Rule[] = [
  { pattern: /截图|screenshot|screen capture|屏幕/, tool: 'screen.capture' },
  { pattern: /键盘|输入文字|type text|keyboard/,    tool: 'keyboard.type' },
  { pattern: /点击|click|鼠标/,                     tool: 'mouse.click' },
  { pattern: /窗口列表|list window/,                tool: 'window.list' },
  { pattern: /进程|process/,                        tool: 'process.list' },
  { pattern: /剪贴板|clipboard/,                    tool: 'clipboard.get' },
  { pattern: /git diff|改动|变更/,                  tool: 'git.diff' },
  { pattern: /运行|执行|run|命令|command/,          tool: 'shell.run' },
  { pattern: /列出|ls|list|文件列表/,               tool: 'fs.list' },
  { pattern: /读取|read|查看/,                      tool: 'fs.read' },
  { pattern: /写入|创建文件|write|create file/,     tool: 'fs.write' },
]

const DEFAULT_TOOL = 'shell.run'

export function inferTool(instruction: string): string {
  const t = (instruction || '').toLowerCase()
  for (const rule of RULES) {
    if (rule.pattern.test(t)) return rule.tool
  }
  return DEFAULT_TOOL
}
