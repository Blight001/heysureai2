<script setup lang="ts">
defineProps<{
  isTyping: boolean
}>()
</script>

<template>
  <div v-if="isTyping" class="flex justify-start">
    <div class="px-4 py-3 rounded-2xl rounded-tl-sm bg-white border border-zinc-200 shadow-sm dark:bg-zinc-900 dark:border-zinc-700 flex items-center gap-2">
      <span class="text-sm">🤖</span>
      <span class="flex gap-1">
        <span class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
        <span class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
        <span class="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
      </span>
    </div>
  </div>
</template>
