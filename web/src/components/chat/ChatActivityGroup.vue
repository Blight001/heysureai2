<script setup lang="ts">
import { computed } from 'vue'
import ChatCollapsible from './ChatCollapsible.vue'
import ChatMessage from './ChatMessage.vue'
import type { InlineContent as InlineContentType } from '@/utils/chatParser'
import { formatActivityGroupSummary, type ActivityGroupMember } from '@/utils/chatMessageGroups'

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
  members: ActivityGroupMember[]
  thinkCount: number
  mcpCount: number
  messages: Message[]
  appliedEdits: string[]
  appliedSignatures: string[]
  actionResults: Record<string, string>
  actionResultsBySignature: Record<string, string>
  readonly?: boolean
  plainTextMode?: boolean
  mcpIcon?: string
  memberTimeLabels?: string[]
}>()

const emit = defineEmits<{
  (e: 'delete', idx: number): void
  (e: 'recall', idx: number): void
  (e: 'apply', msgIdx: number, blockIdx: number): void
  (e: 'revert', msgIdx: number, blockIdx: number): void
}>()

const summaryText = computed(() => formatActivityGroupSummary(props.thinkCount, props.mcpCount))
</script>

<template>
  <div class="activity-group">
    <ChatCollapsible
      details-class="group/activity"
      summary-class="flex items-center gap-1 py-0.5 text-[11px] leading-4 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 cursor-pointer select-none transition-colors"
      body-class="activity-group-body"
      :default-open="true"
    >
      <template #summary>
        <span class="chat-collapsible-arrow text-[10px] leading-none">➣</span>
        <span class="font-medium tracking-wide">{{ summaryText }}</span>
      </template>
      <div class="space-y-1.5">
        <ChatMessage
          v-for="(member, memberIdx) in members"
          :key="`activity-${member.kind}-${member.index}-${memberIdx}`"
          :message="messages[member.index]"
          :applied-edits="appliedEdits"
          :applied-signatures="appliedSignatures"
          :action-results="actionResults"
          :action-results-by-signature="actionResultsBySignature"
          :idx="member.index"
          :readonly="readonly"
          :plain-text-mode="plainTextMode"
          :mcp-icon="mcpIcon"
          :think-only="member.kind === 'think'"
          :time-label="memberTimeLabels?.[memberIdx] || ''"
          embedded
          @delete="(idx) => emit('delete', idx)"
          @recall="(idx) => emit('recall', idx)"
          @apply="(msgIdx, blockIdx) => emit('apply', msgIdx, blockIdx)"
          @revert="(msgIdx, blockIdx) => emit('revert', msgIdx, blockIdx)"
        />
      </div>
    </ChatCollapsible>
  </div>
</template>

<style scoped>
.activity-group {
  max-width: 95%;
}

@media (min-width: 640px) {
  .activity-group {
    max-width: 92%;
  }
}

:deep(.activity-group-body) {
  margin-top: 0.25rem;
  margin-left: 0.25rem;
  padding-left: 0.625rem;
  border-left: 1px solid rgb(228 228 231);
}

.dark :deep(.activity-group-body) {
  border-left-color: rgba(63, 63, 70, 0.8);
}
</style>
