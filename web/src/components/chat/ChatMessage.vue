<script setup lang="ts">
import InlineContent from './InlineContent.vue'
import type { InlineContent as InlineContentType } from '../../utils/chatParser'
import { computed } from 'vue'

const emit = defineEmits<{
  (e: 'delete', idx: number): void
  (e: 'recall', idx: number): void
  (e: 'apply', msgIdx: number, blockIdx: number): void
  (e: 'revert', msgIdx: number, blockIdx: number): void
}>()

const props = defineProps<{
  message: {
    role: 'user' | 'assistant' | 'system'
    content: string
    think?: string
    display_text?: string
    inlineContent?: InlineContentType[]
    id?: number
  }
  appliedEdits: string[]
  appliedSignatures: string[]
  actionResults: Record<string, string>
  actionResultsBySignature: Record<string, string>
  idx: number
  readonly?: boolean
}>()

const isFrontPromptMessage = computed(() => {
  if (props.message.role !== 'system') return false
  const text = String(props.message.display_text || props.message.content || '')
  return text.startsWith('[前置 Prompt]')
})

const isSystemNoticeMessage = computed(() => {
  if (props.message.role !== 'user') return false
  const text = String(props.message.display_text || props.message.content || '').trim()
  return text.startsWith('[系统提示]')
})

const normalizedInlineContent = computed<InlineContentType[]>(() => {
  if (Array.isArray(props.message.inlineContent) && props.message.inlineContent.length > 0) {
    return props.message.inlineContent
  }
  const text = String(props.message.display_text || props.message.content || '')
  if (!text) return []
  return [{ type: 'text', content: text }]
})
</script>

<template>
  <div
    class="flex flex-col gap-1.5"
    :class="isFrontPromptMessage ? 'items-center' : ((props.message.role === 'user' && !isSystemNoticeMessage) ? 'items-end' : 'items-start')"
  >
    <div class="group relative max-w-[95%] sm:max-w-[85%]">
      <!-- Think Block -->
      <div v-if="props.message.think" class="mb-1.5">
        <details class="bg-zinc-100/60 rounded-xl border border-zinc-200/80 dark:bg-zinc-800/60 dark:border-zinc-700/80 shadow-sm overflow-hidden transition-all">
          <summary class="px-3 py-1.5 text-[11px] text-zinc-500 font-medium cursor-pointer hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400 transition-colors select-none flex items-center gap-1.5">
            <span class="text-sm">🤔</span> 深度思考
          </summary>
          <div class="p-3 text-xs text-zinc-600 leading-relaxed italic dark:text-zinc-400 whitespace-pre-wrap border-t border-zinc-200/50 dark:border-zinc-700/50 bg-white/30 dark:bg-zinc-900/30">
            {{ props.message.think }}
          </div>
        </details>
      </div>
      
      <!-- Main Content -->
      <div
        class="px-4 py-3 rounded-2xl border transition-all duration-300 hover:shadow-md"
        :class="[
          (props.message.role === 'user' && !isSystemNoticeMessage)
            ? 'bg-indigo-600 border-indigo-500 text-white rounded-tr-sm shadow-indigo-200/50 dark:shadow-none'
            : isSystemNoticeMessage
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 rounded-tl-sm dark:bg-emerald-500/15 dark:border-emerald-500/40 dark:text-emerald-200'
            : isFrontPromptMessage
              ? 'bg-violet-50 border-violet-200 text-zinc-800 dark:bg-violet-500/15 dark:border-violet-500/40 dark:text-zinc-100'
              : props.message.role === 'system'
                ? 'bg-zinc-100 border-zinc-200 text-zinc-700 font-mono text-xs dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300'
                : 'bg-white border-zinc-200 text-zinc-800 rounded-tl-sm shadow-sm dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200',
          isFrontPromptMessage ? 'front-prompt-bubble' : ''
        ]"
      >
        
        <!-- Delete & Recall Buttons (hover 显示) -->
        <div v-if="!props.readonly && !isFrontPromptMessage" class="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <!-- Recall Button (仅用户消息显示) -->
          <button 
            v-if="props.message.role === 'user'"
            @click.stop="emit('recall', props.idx)"
            class="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-md hover:bg-amber-600 transition-colors"
            title="撤回此消息及之后所有对话"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <!-- Delete Button -->
          <button 
            @click.stop="emit('delete', props.idx)"
            class="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
            title="删除此消息"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div
          class="whitespace-pre-wrap text-[13px] leading-relaxed"
          :class="[
            (props.message.role === 'user' && !isSystemNoticeMessage) ? 'text-white' : '',
            isFrontPromptMessage ? 'text-left w-full front-prompt-content' : ''
          ]"
        >
          <template v-if="normalizedInlineContent.length > 0">
            <InlineContent 
              :content="normalizedInlineContent"
              :appliedEdits="props.appliedEdits"
              :appliedSignatures="props.appliedSignatures"
              :actionResults="props.actionResults"
              :actionResultsBySignature="props.actionResultsBySignature"
              @apply="(blockIdx) => emit('apply', props.idx, blockIdx)"
              @revert="(blockIdx) => emit('revert', props.idx, blockIdx)"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.front-prompt-bubble {
  height: 14rem;
  overflow-y: auto;
  overflow-x: hidden;
}

.front-prompt-content {
  min-height: 100%;
}
</style>
