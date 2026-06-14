<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import type { AppIconName } from '@/components/common/AppIcon.vue'

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
  specialty?: string
  projectId?: string
  projectName?: string
}

interface Props {
  activeAgents: Agent[]
}

const props = defineProps<Props>()

const groupedAgents = computed(() => {
  const groups: Record<string, { label: string; icon: AppIconName; agents: Agent[] }> = {
    working: { label: '执行中', icon: 'bolt', agents: [] },
    learning: { label: '学习中', icon: 'book', agents: [] },
    reproducing: { label: '压缩中', icon: 'dna', agents: [] }
  }

  props.activeAgents.forEach(agent => {
    if (groups[agent.status]) {
      groups[agent.status].agents.push(agent)
    }
  })

  return Object.entries(groups).filter(([_, group]) => group.agents.length > 0)
})
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
    <div v-if="activeAgents.length === 0" class="text-center text-zinc-400 text-xs py-10 dark:text-zinc-500">
      暂无活跃个体，文明处于静止。
    </div>

    <div v-for="[status, group] in groupedAgents" :key="status" class="space-y-3">
      <div class="flex items-center gap-2 px-1">
        <AppIcon :name="group.icon" class="w-4 h-4" />
        <h3 class="text-xs font-bold text-zinc-500 uppercase tracking-wider dark:text-zinc-400">
          {{ group.label }} ({{ group.agents.length }})
        </h3>
        <div class="flex-1 h-px bg-zinc-100 dark:bg-zinc-800"></div>
      </div>

      <div class="space-y-3">
        <div v-for="agent in group.agents" :key="agent.id" 
             class="group p-3 rounded-xl border border-zinc-100 bg-white/50 hover:bg-white hover:border-indigo-100 hover:shadow-sm transition-all duration-300 dark:bg-zinc-900/40 dark:border-zinc-800 dark:hover:bg-zinc-800/60 dark:hover:border-indigo-900/50">
          <div class="flex justify-between items-start mb-2">
            <div>
              <div class="flex items-center gap-1.5 mb-0.5">
                <h4 class="text-sm font-bold text-zinc-700 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {{ agent.name }}
                </h4>
                <span class="opacity-0 group-hover:opacity-100 transition-opacity duration-300"><AppIcon name="search" class="w-3 h-3" /></span>
              </div>
              <p class="text-[10px] text-zinc-400 dark:text-zinc-500">
                Gen {{ agent.generation }} · {{ agent.platform }}
              </p>
            </div>
            <div class="text-[10px] font-mono text-zinc-400 bg-zinc-50 px-1.5 py-0.5 rounded dark:bg-zinc-800/50">
              {{ Math.floor((agent.tokensUsed / agent.tokenLimit) * 100) }}%
            </div>
          </div>
          
          <div class="w-full h-1 bg-zinc-100 rounded-full overflow-hidden mb-2 dark:bg-zinc-800">
            <div class="h-full bg-indigo-500 transition-all duration-500" 
                 :style="{ width: `${(agent.tokensUsed / agent.tokenLimit) * 100}%` }"
                 :class="{ 'bg-amber-500': agent.status === 'reproducing' }"></div>
          </div>

          <p class="text-[11px] text-zinc-500 line-clamp-2 italic dark:text-zinc-400">
            "{{ agent.currentTask || '等待指引...' }}"
          </p>

          <!-- Hover Details Section -->
          <div class="max-h-0 overflow-hidden group-hover:max-h-40 transition-all duration-500 ease-in-out">
            <div class="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
              <div class="flex justify-between items-center text-[10px]">
                <span class="text-zinc-400">职能类型:</span>
                <span class="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {{ agent.role === 'admin' ? '系统管理员' : '业务执行者' }}
                </span>
              </div>
              <div class="flex justify-between items-center text-[10px]">
                <span class="text-zinc-400">Token 消耗:</span>
                <span class="font-mono text-zinc-500 dark:text-zinc-400">
                  {{ agent.tokensUsed.toLocaleString() }} / {{ agent.tokenLimit.toLocaleString() }}
                </span>
              </div>
              <div v-if="agent.projectName" class="flex justify-between items-center text-[10px]">
                <span class="text-zinc-400">当前项目:</span>
                <span class="text-indigo-500 dark:text-indigo-400 truncate max-w-[120px]">
                  {{ agent.projectName }}
                </span>
              </div>
              <div v-if="agent.specialty" class="flex justify-between items-center text-[10px]">
                <span class="text-zinc-400">专业领域:</span>
                <span class="text-emerald-500 dark:text-emerald-400">
                  {{ agent.specialty }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
}
</style>
