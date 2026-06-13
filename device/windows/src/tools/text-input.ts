import { clipboard } from 'electron'
import { getRobot } from './shared/robot'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readTextArg(args: any): string {
  if (args && Object.prototype.hasOwnProperty.call(args, 'text')) return String(args.text)
  if (args && Object.prototype.hasOwnProperty.call(args, 'content')) return String(args.content)
  if (args && Object.prototype.hasOwnProperty.call(args, 'value')) return String(args.value)
  throw new Error('text is required')
}

export async function textInput(args: any = {}) {
  const text = readTextArg(args)
  const paste = args.paste !== false && args.set_only !== true
  const restoreClipboard = args.restore_clipboard !== false && args.restore !== false
  const waitMs = Math.max(0, Math.trunc(Number(args.wait_ms ?? args.delay_ms ?? 160)) || 160)
  const previousText = restoreClipboard ? clipboard.readText() : ''

  clipboard.writeText(text)

  if (paste) {
    getRobot().keyTap('v', ['control'])
    if (waitMs > 0) await sleep(waitMs)
    if (restoreClipboard) clipboard.writeText(previousText)
  }

  return {
    success: true,
    method: paste ? 'clipboard_paste' : 'clipboard_set',
    length: text.length,
    pasted: paste,
    restored_clipboard: paste && restoreClipboard,
  }
}
