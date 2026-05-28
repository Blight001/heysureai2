<script setup lang="ts">
import { computed } from 'vue'
import { stripMarkdownFormatting } from '@/utils/chatMarkdown'

const props = defineProps<{
  isTyping: boolean
  thinkingText?: string
  plainTextMode?: boolean
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
      <div class="font-medium">正在思考中</div>
      <div v-if="renderedThinkingText" class="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5">
        {{ renderedThinkingText }}
      </div>
    </div>
  </div>
</template>
