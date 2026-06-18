import { parseChatResponseInline } from './chatParser'
import { stripMcpCallBlocks } from './mcpFormat'

export const normalizeAssistantReplyText = (raw?: string): string => {
  const source = stripMcpCallBlocks(String(raw || '')).trim()
  if (!source) return ''
  try {
    const parsed = parseChatResponseInline(source)
    const display = String(parsed.displayText || '').trim()
    if (display) return display
  } catch {
    // Fall back to the stripped source when inline parsing fails.
  }
  return source
}

const softenReplyTail = (text: string) => {
  return text.replace(/[\s。．.!！?？,，;；:：、]+$/g, '').trim()
}

export const isSameAssistantVisibleReply = (left?: string, right?: string): boolean => {
  const a = softenReplyTail(normalizeAssistantReplyText(left))
  const b = softenReplyTail(normalizeAssistantReplyText(right))
  if (!a || !b) return false
  if (a === b) return true
  const minLen = Math.min(a.length, b.length)
  if (minLen < 4) return false
  return a.startsWith(b) || b.startsWith(a)
}