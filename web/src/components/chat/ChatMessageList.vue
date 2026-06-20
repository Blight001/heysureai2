<script setup lang="ts">
import { computed } from 'vue'
import ChatActivityGroup from './ChatActivityGroup.vue'
import ChatMessage from './ChatMessage.vue'
import TypingIndicator from './TypingIndicator.vue'
import type { InlineContent as InlineContentType } from '@/utils/chatParser'
import { buildChatRenderItems } from '@/utils/chatMessageGroups'
import { formatDurationMs } from '@/utils/datetime'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  think?: string
  display_text?: string
  inlineContent?: InlineContentType[]
  front_prompt_details?: string
  id?: number
  created_at?: number
}

const props = defineProps<{
  messages: Message[]
  appliedEdits: string[]
  appliedSignatures: string[]
  actionResults: Record<string, string>
  actionResultsBySignature: Record<string, string>
  isTyping: boolean
  thinkingText?: string
  collapseThinking?: boolean
  stripMarkdownSymbols?: boolean
  isEmpty: boolean
  readonly?: boolean
  mcpIcon?: string
  nowTimestamp?: number
}>()

const renderItems = computed(() => buildChatRenderItems(props.messages))

const messageTimeLabels = computed<Record<number, string>>(() => {
  const labels: Record<number, string> = {}
  const now = Number(props.nowTimestamp || 0) || null

  const getMessageTimeMs = (message?: Message) => {
    const ts = Number(message?.created_at || 0)
    return ts > 0 ? ts * 1000 : null
  }

  for (let idx = 0; idx < props.messages.length; idx += 1) {
    const current = props.messages[idx]
    const start = getMessageTimeMs(current)
    if (start == null) continue

    let end: number | null = null
    for (let nextIdx = idx + 1; nextIdx < props.messages.length; nextIdx += 1) {
      const nextStart = getMessageTimeMs(props.messages[nextIdx])
      if (nextStart != null) {
        end = nextStart
        break
      }
    }

    if (end == null && now != null && now > start) {
      end = now
    }

    const duration = end != null && end > start ? formatDurationMs(end - start) : ''
    if (duration) labels[idx] = duration
  }

  return labels
})

const emit = defineEmits<{
  (e: 'delete', idx: number): void
  (e: 'recall', idx: number): void
  (e: 'apply', msgIdx: number, blockIdx: number): void
  (e: 'revert', msgIdx: number, blockIdx: number): void
}>()
</script>

<template>
  <div class="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar min-h-[300px]">
    <div v-if="isEmpty" class="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500 gap-2 opacity-60">
      <span class="text-4xl">💭</span>
      <span class="text-sm">开始一场智慧的碰撞吧...</span>
    </div>

    <div class="space-y-4">
      <template v-for="(item, itemIdx) in renderItems" :key="item.kind === 'message' ? (item.hideThink ? `msg-content-${item.index}` : (messages[item.index]?.id !== undefined ? `msg-${messages[item.index].id}` : `tmp-${item.index}`)) : `activity-${item.members.map((member) => `${member.kind}-${member.index}`).join('-')}-${itemIdx}`">
        <ChatActivityGroup
          v-if="item.kind === 'activity-group'"
          :members="item.members"
          :think-count="item.thinkCount"
          :mcp-count="item.mcpCount"
          :messages="messages"
          :applied-edits="appliedEdits"
          :applied-signatures="appliedSignatures"
          :action-results="actionResults"
          :action-results-by-signature="actionResultsBySignature"
          :readonly="readonly"
          :plain-text-mode="stripMarkdownSymbols"
          :mcp-icon="mcpIcon"
          :member-time-labels="item.kind === 'activity-group' ? item.members.map((member) => messageTimeLabels[member.index] || '') : undefined"
          @delete="(i) => emit('delete', i)"
          @recall="(i) => emit('recall', i)"
          @apply="(msgIdx, blockIdx) => emit('apply', msgIdx, blockIdx)"
          @revert="(msgIdx, blockIdx) => emit('revert', msgIdx, blockIdx)"
        />
        <ChatMessage
          v-else
          :message="messages[item.index]"
          :applied-edits="appliedEdits"
          :applied-signatures="appliedSignatures"
          :action-results="actionResults"
          :action-results-by-signature="actionResultsBySignature"
          :idx="item.index"
          :readonly="readonly"
          :plain-text-mode="stripMarkdownSymbols"
          :mcp-icon="mcpIcon"
          :time-label="messageTimeLabels[item.index] || ''"
          :hide-think="item.hideThink"
          @delete="(i) => emit('delete', i)"
          @recall="(i) => emit('recall', i)"
          @apply="(msgIdx, blockIdx) => emit('apply', msgIdx, blockIdx)"
          @revert="(msgIdx, blockIdx) => emit('revert', msgIdx, blockIdx)"
        />
      </template>
    </div>

    <TypingIndicator
      :isTyping="isTyping"
      :thinkingText="thinkingText"
      :plainTextMode="stripMarkdownSymbols"
      :collapsed="collapseThinking"
    />
  </div>
</template>
