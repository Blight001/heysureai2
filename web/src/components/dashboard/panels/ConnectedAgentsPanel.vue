<script setup lang="ts">
import { computed } from 'vue'
import type { ConnectedAgent } from '@/composables/dashboard/useDashboardData'

interface Props {
  agents: ConnectedAgent[]
}
const props = defineProps<Props>()

const hasAgents = computed(() => props.agents.length > 0)

const lifecycleClass = (lifecycle?: string) => {
  switch (lifecycle) {
    case 'dispatching':
      return 'bg-indigo-500'
    case 'registered':
    case 'connected':
      return 'bg-emerald-500'
    case 'degraded':
      return 'bg-amber-500'
    default:
      return 'bg-zinc-400'
  }
}

const lastTaskClass = (status?: string | null) => {
  if (status === 'success') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'failed' || status === 'error') return 'text-rose-600 dark:text-rose-400'
  return 'text-zinc-500 dark:text-zinc-400'
}
</script>

<template>
  <div class="rounded-xl border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
    <div class="flex items-center gap-2 mb-2">
      <span class="text-sm">🖥️</span>
      <h3 class="text-xs font-bold text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
        桌面 Agent ({{ agents.length }})
      </h3>
    </div>

    <div v-if="!hasAgents" class="text-[11px] text-zinc-400 dark:text-zinc-500 py-2">
      暂无已连接的桌面执行节点。
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="rounded-lg border border-zinc-100 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900/60"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="inline-block w-2 h-2 rounded-full shrink-0" :class="lifecycleClass(agent.lifecycle)"></span>
            <span class="text-xs font-bold text-zinc-700 dark:text-zinc-200 truncate">{{ agent.name }}</span>
          </div>
          <span class="text-[10px] font-mono text-zinc-400 shrink-0">{{ agent.platform || '' }}</span>
        </div>

        <div v-if="agent.capabilities.length" class="mt-1 flex flex-wrap gap-1">
          <span
            v-for="cap in agent.capabilities"
            :key="cap"
            class="text-[9px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          >
            {{ cap }}
          </span>
        </div>

        <div class="mt-1 text-[10px]" :class="lastTaskClass(agent.lastTaskStatus)">
          最近任务: {{ agent.lastTaskStatus ? `${agent.lastTaskStatus}` : '暂无' }}
        </div>
        <div v-if="agent.lastError" class="mt-0.5 text-[10px] text-rose-500 truncate" :title="agent.lastError">
          错误: {{ agent.lastError }}
        </div>
      </div>
    </div>
  </div>
</template>
