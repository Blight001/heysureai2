<script setup lang="ts">
const props = defineProps<{
  show: boolean
  loading: boolean
  title: string
  tree: string
  gitDiff: string
  error: string
  changedPaths: string[]
  canRefresh: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
}>()
</script>

<template>
  <Transition name="fade">
    <div v-if="props.show" class="fixed inset-0 z-[82] bg-black/40 flex items-center justify-center p-4" @click="emit('close')">
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 w-[840px] max-w-[96vw] max-h-[82vh] p-4 overflow-auto" @click.stop>
        <div class="flex items-center justify-between mb-3">
          <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{{ props.title }} 的读取目录</div>
          <div class="flex items-center gap-2">
            <button
              v-if="props.canRefresh"
              class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300"
              @click="emit('refresh')"
            >
              刷新
            </button>
            <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="emit('close')">
              关闭
            </button>
          </div>
        </div>

        <div v-if="props.loading" class="text-xs text-zinc-500 dark:text-zinc-400 py-6 text-center">
          正在读取目录结构与 Git Diff...
        </div>
        <div v-else-if="props.error" class="text-xs text-rose-600 dark:text-rose-300 py-3 px-3 rounded-lg border border-rose-200 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-900/20">
          {{ props.error }}
        </div>
        <div v-else class="space-y-4">
          <div class="p-3 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">目录结构</div>
            <div class="p-3 bg-zinc-100/50 rounded-xl border border-zinc-200 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800/50 dark:border-zinc-700 dark:text-zinc-400 max-h-72 overflow-y-auto whitespace-pre custom-scrollbar">{{ props.tree }}</div>
          </div>
          <div class="p-3 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">Git Diff</div>
            <div v-if="props.changedPaths.length > 0" class="mb-2 flex flex-wrap gap-1">
              <span
                v-for="changedPath in props.changedPaths"
                :key="`changed-${changedPath}`"
                class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
              >
                {{ changedPath }}
              </span>
            </div>
            <div class="p-3 bg-zinc-100/50 rounded-xl border border-zinc-200 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800/50 dark:border-zinc-700 dark:text-zinc-400 max-h-72 overflow-y-auto whitespace-pre custom-scrollbar">{{ props.gitDiff }}</div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
