<script setup lang="ts">
import { getMcpToolParamRows } from '../mcpTools'
import type { McpToolDefinition } from '../types'

const props = defineProps<{
  show: boolean
  title: string
  items: McpToolDefinition[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <Transition name="fade">
    <div v-if="props.show" class="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center" @click="emit('close')">
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 w-[560px] max-h-[75vh] p-4 overflow-auto" @click.stop>
        <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3">{{ props.title }} 的 MCP 工具说明</div>
        <div class="space-y-2">
          <div
            v-for="tool in props.items"
            :key="tool.name"
            class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-2.5 bg-zinc-50/70 dark:bg-zinc-800/40"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-xs font-semibold text-zinc-800 dark:text-zinc-100 break-all">{{ tool.zhLabel || tool.name }}</div>
                <div class="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 break-all mt-0.5">{{ tool.name }}</div>
              </div>
              <div class="shrink-0 flex items-center gap-1">
                <span
                  v-for="tag in (tool.zhTags || [])"
                  :key="`${tool.name}-${tag}`"
                  class="text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                >
                  {{ tag }}
                </span>
              </div>
            </div>
            <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{{ tool.zhDescription || '暂无说明' }}</div>
            <div class="mt-2 space-y-1">
              <div
                v-for="param in getMcpToolParamRows(tool)"
                :key="`${tool.name}-${param.name}`"
                class="text-[11px] px-2 py-1 rounded border border-zinc-200/80 dark:border-zinc-700/80 bg-white/80 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-300"
              >
                <span class="font-mono text-zinc-800 dark:text-zinc-100">{{ param.name }}</span>
                <span class="mx-1 text-zinc-400">:</span>
                <span class="font-mono">{{ param.type }}</span>
                <span :class="param.required ? 'text-rose-600 dark:text-rose-300' : 'text-zinc-500 dark:text-zinc-400'">
                  {{ param.required ? ' (必填)' : ' (可选)' }}
                </span>
                <span v-if="param.description" class="text-zinc-500 dark:text-zinc-400"> - {{ param.description }}</span>
              </div>
              <div v-if="getMcpToolParamRows(tool).length === 0" class="text-[11px] text-zinc-500 dark:text-zinc-400">
                无参数
              </div>
            </div>
          </div>
          <div v-if="props.items.length === 0" class="text-xs text-zinc-500">暂无可用工具</div>
        </div>
      </div>
    </div>
  </Transition>
</template>
