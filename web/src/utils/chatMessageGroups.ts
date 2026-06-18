export interface GroupableChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  think?: string
  display_text?: string
  inlineContent?: Array<{ type: string; content?: string; block?: unknown }>
}

export type ActivityGroupMember =
  | { kind: 'full'; index: number }
  | { kind: 'think'; index: number }

export type ChatRenderItem =
  | { kind: 'message'; index: number; hideThink?: boolean }
  | { kind: 'activity-group'; members: ActivityGroupMember[]; thinkCount: number; mcpCount: number }

export const isMcpToolMessage = (msg?: GroupableChatMessage | null) => {
  const text = String(msg?.display_text || msg?.content || '').trim()
  return msg?.role === 'system' && text.startsWith('[MCP工具]')
}

export const hasThinkText = (msg?: GroupableChatMessage | null) => {
  return Boolean(String(msg?.think || '').trim())
}

export const hasVisibleAssistantContent = (msg?: GroupableChatMessage | null) => {
  if (msg?.role !== 'assistant') return false
  if (String(msg.display_text || msg.content || '').trim()) return true
  if (!Array.isArray(msg.inlineContent) || msg.inlineContent.length === 0) return false
  return msg.inlineContent.some((item) => {
    if (item.type === 'text') return Boolean(String(item.content || '').trim())
    if (item.type === 'block') return true
    return false
  })
}

export const isThinkActivityMessage = (msg?: GroupableChatMessage | null) => {
  return msg?.role === 'assistant' && hasThinkText(msg) && !hasVisibleAssistantContent(msg)
}

export const isActivityStarter = (msg?: GroupableChatMessage | null) => {
  return isMcpToolMessage(msg) || (msg?.role === 'assistant' && hasThinkText(msg))
}

export const buildChatRenderItems = (messages: GroupableChatMessage[]): ChatRenderItem[] => {
  const items: ChatRenderItem[] = []
  let index = 0

  while (index < messages.length) {
    const current = messages[index]
    if (!isActivityStarter(current)) {
      items.push({ kind: 'message', index })
      index += 1
      continue
    }

    const members: ActivityGroupMember[] = []
    let thinkCount = 0
    let mcpCount = 0
    let trailingContentIndex: number | null = null

    while (index < messages.length) {
      const msg = messages[index]
      if (isMcpToolMessage(msg)) {
        members.push({ kind: 'full', index })
        mcpCount += 1
        index += 1
        continue
      }

      if (msg.role === 'assistant' && hasThinkText(msg)) {
        if (hasVisibleAssistantContent(msg)) {
          members.push({ kind: 'think', index })
          thinkCount += 1
          trailingContentIndex = index
          index += 1
          break
        }
        members.push({ kind: 'full', index })
        thinkCount += 1
        index += 1
        continue
      }

      break
    }

    if (members.length >= 2) {
      items.push({ kind: 'activity-group', members, thinkCount, mcpCount })
      if (trailingContentIndex !== null) {
        items.push({ kind: 'message', index: trailingContentIndex, hideThink: true })
      }
      continue
    }

    if (members.length === 1) {
      items.push({ kind: 'message', index: members[0].index })
    }
  }

  return items
}

export const formatActivityGroupSummary = (thinkCount: number, mcpCount: number) => {
  const parts: string[] = []
  if (thinkCount > 0) parts.push(`${thinkCount}次思考`)
  if (mcpCount > 0) parts.push(`${mcpCount}次工具调用`)
  return parts.join(' · ')
}