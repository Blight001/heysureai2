<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  includeFileTree: boolean
  includeGitDiff: boolean
  selectedFilesCount: number
}>()

const emit = defineEmits<{
  (e: 'update:includeFileTree', value: boolean): void
  (e: 'update:includeGitDiff', value: boolean): void
}>()

const includeFileTreeValue = computed({
  get: () => props.includeFileTree,
  set: (val) => emit('update:includeFileTree', val)
})

const includeGitDiffValue = computed({
  get: () => props.includeGitDiff,
  set: (val) => emit('update:includeGitDiff', val)
})
</script>

<template>
  <div class="flex flex-wrap gap-4 px-1 py-2 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-lg border border-zinc-100 dark:border-zinc-800/50">
    <label class="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
      <input type="checkbox" v-model="includeFileTreeValue" class="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 transition-colors">
      包含目录
    </label>
    <label class="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
      <input type="checkbox" v-model="includeGitDiffValue" class="rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 transition-colors">
      包含 Diff
    </label>
    <div class="text-xs text-zinc-400 dark:text-zinc-500 ml-auto flex items-center gap-1.5 bg-white dark:bg-zinc-800 px-2 py-0.5 rounded shadow-sm border border-zinc-100 dark:border-zinc-700">
      <span>📁</span> 已选 {{ selectedFilesCount }} 文件
    </div>
  </div>
</template>
