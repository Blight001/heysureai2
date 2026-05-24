<script setup lang="ts">
import AgentCard from '../cards/AgentCard.vue'

interface Agent {
  id: string
  name: string
  role: 'admin' | 'worker'
  tokensUsed: number
  tokenLimit: number
  generation: number
  status: 'learning' | 'working' | 'reproducing' | 'dead'
  platform: string
  currentTask?: string
  summary?: string
  projectId?: string
  projectName?: string
  aiConfigId?: number
  enabled?: boolean
  mcpEnabled?: boolean
  mcpTools?: string
  runtimeStatus?: string
  runtimeTool?: string
  digitalMemberRole?: 'manager' | 'member'
  currentTaskTitle?: string
  currentTaskStatus?: string
  latestThinking?: string
}

interface Props {
  adminAgents: Agent[]
  noGlass?: boolean
}

defineProps<Props>()
const emit = defineEmits<{
  (e: 'context', payload: { agent: Agent; x: number; y: number }): void
  (e: 'show-tools', agent: Agent): void
  (e: 'show-context', agent: Agent): void
  (e: 'show-tasks', agent: Agent): void
  (e: 'show-task-detail', payload: { agent: Agent; jobId: string }): void
  (e: 'chat', agent: Agent): void
  (e: 'settings', agent: Agent): void
  (e: 'create-ai'): void
}>()
</script>

<template>
  <div :class="[
    'p-4 flex flex-col gap-4 transition-all duration-300 h-full',
    noGlass ? '' : 'glass rounded-2xl border border-zinc-200 shadow-sm dark:bg-zinc-900/80 dark:border-zinc-800 hover:shadow-md'
  ]">
    <div class="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800 flex-shrink-0">
      <h2 v-if="!noGlass" class="font-bold text-zinc-800 flex items-center gap-2 dark:text-zinc-100">
        <span>🧠</span> 数字社会核心管理员
      </h2>
      <div v-else class="flex items-center gap-2">
        <span class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">数字社会核心管理员</span>
      </div>
      <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700" @click="emit('create-ai')">+ 新建 AI</button>
    </div>

    <div v-if="adminAgents.length === 0" class="p-4 bg-red-50 text-red-600 text-sm rounded border border-red-100 animate-pulse dark:bg-red-500/10 dark:border-red-500/20">
      ⚠️ 警告：管理员离线或正在重生中...
    </div>

    <TransitionGroup name="list" tag="div" class="flex flex-col gap-3 overflow-y-auto overflow-x-visible pr-2 pt-2 pb-1 min-w-0">
      <AgentCard
        v-for="agent in adminAgents"
        :key="agent.id"
        :agent="agent"
        @context="emit('context', $event)"
        @show-tools="emit('show-tools', $event)"
        @show-context="emit('show-context', $event)"
        @show-tasks="emit('show-tasks', $event)"
        @show-task-detail="emit('show-task-detail', $event)"
        @chat="emit('chat', $event)"
        @settings="emit('settings', $event)"
      />
    </TransitionGroup>
  </div>
</template>
