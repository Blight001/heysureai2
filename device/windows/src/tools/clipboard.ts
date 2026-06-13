import { clipboard } from 'electron'

export function clipboardGet(args: any = {}) {
  const format = String(args.format || 'text').toLowerCase()
  let content: string
  if (format === 'html') {
    content = clipboard.readHTML()
  } else if (format === 'rtf') {
    content = clipboard.readRTF()
  } else {
    content = clipboard.readText()
  }
  return { success: true, format, content, length: content.length }
}

export function clipboardSet(args: any) {
  const text = String(args.text || args.content || '')
  clipboard.writeText(text)
  return { success: true, written: text.length }
}
