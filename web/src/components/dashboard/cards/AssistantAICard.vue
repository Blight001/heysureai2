<script setup lang="ts">
import { computed } from 'vue'

interface AssistantAI {
  id: number
  name: string
  description?: string
  model: string
  enabled: boolean
  mcp_enabled: boolean
  mcp_tools: string
}

interface RuntimeStatus {
  id?: number
  ai_config_id?: number | null
  running: boolean
  mcp_enabled: boolean
  current_status: string
  current_mcp_tool: string
  updated_at?: number
}

const props = defineProps<{
  ai: AssistantAI
  status?: RuntimeStatus | null
}>()

const emit = defineEmits<{
  (e: 'toggle-run', id: number): void
  (e: 'toggle-mcp', id: number): void
  (e: 'show-tools', ai: AssistantAI): void
  (e: 'chat', ai: AssistantAI): void
}>()

const runState = computed(() => (props.ai.enabled ? '运行中' : '已停止'))

const mcpState = computed(() => {
  if (!props.ai.enabled) return 'AI 停止中'
  return props.ai.mcp_enabled ? 'MCP 开启' : 'MCP 关闭'
})

const runtimeDetail = computed(() => {
  if (props.status?.current_status === 'running' && props.status?.current_mcp_tool) {
    return `调用中: ${props.status.current_mcp_tool}`
  }
  if (props.status?.current_status === 'error') {
    return '状态: MCP 调用失败'
  }
  return props.ai.enabled ? '状态: 空闲' : '状态: 已停止'
})
</script>

<template>
  <div class="bg-white rounded-xl border border-zinc-200 p-3 dark:bg-zinc-900 dark:border-zinc-700 shadow-sm">
    <div class="flex items-start justify-between gap-3">
      <div>
        <h4 class="text-sm font-bold text-zinc-800 dark:text-zinc-100">{{ ai.name }}</h4>
        <p class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{{ ai.model }}</p>
      </div>
      <span
        class="text-[10px] px-2 py-0.5 rounded-full border"
        :class="ai.enabled
          ? 'text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-500/30 dark:bg-emerald-900/10'
          : 'text-zinc-500 border-zinc-200 bg-zinc-100 dark:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800'"
      >
        {{ runState }}
      </span>
    </div>

    <p class="mt-2 text-xs text-zinc-600 dark:text-zinc-400 line-clamp-2">
      {{ ai.description || '用户辅助AI' }}
    </p>

    <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
      <div class="rounded-lg border border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
        <div class="text-zinc-400">运行状态</div>
        <div class="text-zinc-700 dark:text-zinc-300 font-medium">{{ runState }}</div>
      </div>
      <div class="rounded-lg border border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
        <div class="text-zinc-400">MCP 状态</div>
        <div class="text-zinc-700 dark:text-zinc-300 font-medium">{{ mcpState }}</div>
      </div>
    </div>

    <div class="mt-2 text-[11px] text-indigo-600 dark:text-indigo-300">{{ runtimeDetail }}</div>

    <div class="mt-3 grid grid-cols-2 gap-2">
      <button
        class="text-[11px] px-2 py-1.5 rounded border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        @click="emit('show-tools', ai)"
      >
        查看 MCP
      </button>
      <button
        class="text-[11px] px-2 py-1.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-900/20 dark:text-indigo-300"
        @click="emit('chat', ai)"
      >
        与此 AI 对话
      </button>
      <button
        class="text-[11px] px-2 py-1.5 rounded border"
        :class="ai.mcp_enabled
          ? 'text-indigo-600 border-indigo-200 bg-indigo-50 dark:text-indigo-300 dark:border-indigo-500/30 dark:bg-indigo-900/20'
          : 'text-zinc-500 border-zinc-200 bg-zinc-100 dark:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800'"
        @click="emit('toggle-mcp', ai.id)"
      >
        {{ ai.mcp_enabled ? '关闭 MCP' : '开启 MCP' }}
      </button>
      <button
        class="text-[11px] px-2 py-1.5 rounded border"
        :class="ai.enabled
          ? 'text-red-600 border-red-200 bg-red-50 dark:text-red-300 dark:border-red-500/30 dark:bg-red-900/20'
          : 'text-emerald-600 border-emerald-200 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-500/30 dark:bg-emerald-900/20'"
        @click="emit('toggle-run', ai.id)"
      >
        {{ ai.enabled ? '停止 AI' : '启动 AI' }}
      </button>
    </div>
  </div>
</template>
