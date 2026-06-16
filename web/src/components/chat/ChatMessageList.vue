<script setup lang="ts">
import ChatMessage from './ChatMessage.vue'
import TypingIndicator from './TypingIndicator.vue'
import type { InlineContent as InlineContentType } from '@/utils/chatParser'

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

defineProps<{
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
}>()

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
      <ChatMessage 
        v-for="(msg, idx) in messages" 
        :key="msg.id !== undefined ? `msg-${msg.id}` : `tmp-${idx}`" 
        :message="msg"
        :appliedEdits="appliedEdits"
        :appliedSignatures="appliedSignatures"
        :actionResults="actionResults"
        :actionResultsBySignature="actionResultsBySignature"
        :idx="idx"
        :readonly="readonly"
        :plainTextMode="stripMarkdownSymbols"
        :mcpIcon="mcpIcon"
        @delete="(i) => emit('delete', i)"
        @recall="(i) => emit('recall', i)"
        @apply="(msgIdx, blockIdx) => emit('apply', msgIdx, blockIdx)"
        @revert="(msgIdx, blockIdx) => emit('revert', msgIdx, blockIdx)"
      />
    </div>

    <TypingIndicator
      :isTyping="isTyping"
      :thinkingText="thinkingText"
      :plainTextMode="stripMarkdownSymbols"
      :collapsed="collapseThinking"
    />
  </div>
</template>
