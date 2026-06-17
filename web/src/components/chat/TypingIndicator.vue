<script setup lang="ts">
import { computed } from 'vue'
import { stripMarkdownFormatting } from '@/utils/chatMarkdown'

const props = defineProps<{
  isTyping: boolean
  thinkingText?: string
  plainTextMode?: boolean
  collapsed?: boolean
}>()

const renderedThinkingText = computed(() => {
  const text = String(props.thinkingText || '')
  if (!props.plainTextMode) return text
  return stripMarkdownFormatting(text)
})
</script>

<template>
  <div v-if="isTyping" class="flex justify-start">
    <div class="w-full max-w-[92%] min-w-0 text-sm text-zinc-500 dark:text-zinc-400">
      <div class="flex items-center gap-1.5 text-[12px] font-medium text-zinc-400 dark:text-zinc-500">
        <span class="thinking-dot h-1.5 w-1.5 rounded-full bg-zinc-400 dark:bg-zinc-500"></span>
        <span>思考中</span>
      </div>
      <details v-if="renderedThinkingText && collapsed" class="mt-1 group/think">
        <summary class="flex items-center gap-1 cursor-pointer select-none list-none text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          <span class="text-[8px] leading-none transition-transform group-open/think:rotate-90">▶</span>
          <span class="font-medium tracking-wide">查看思考</span>
        </summary>
        <div class="mt-1 ml-1 pl-2.5 border-l border-zinc-200 dark:border-zinc-700/80 whitespace-pre-wrap break-words text-[11px] leading-relaxed italic text-zinc-400 dark:text-zinc-500">{{ renderedThinkingText }}</div>
      </details>
      <div v-else-if="renderedThinkingText" class="mt-1 ml-1 pl-2.5 border-l border-zinc-200 dark:border-zinc-700/80 whitespace-pre-wrap break-words text-[11px] leading-relaxed italic text-zinc-400 dark:text-zinc-500">
        {{ renderedThinkingText }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.thinking-dot {
  animation: thinking-pulse 1.1s ease-in-out infinite;
}
@keyframes thinking-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1); }
}
</style>
