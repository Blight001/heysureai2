<script setup lang="ts">
import { ref } from 'vue'
import BrainCorePanel from './BrainCorePanel.vue'
import KnowledgeBasePanel from './KnowledgeBasePanel.vue'

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

interface KnowledgeItem {
  id: string
  title: string
  author: string
  time: string
  tags: string[]
}

interface Props {
  currentUserId?: number
  adminAgents: Agent[]
  knowledgeItems: KnowledgeItem[]
  knowledgeTotalCount: number
  knowledgeFilterOpen: boolean
  knowledgeFilterValue: 'all' | 'inheritance' | 'system' | 'business'
}

defineProps<Props>()
const emit = defineEmits<{
  (e: 'context', payload: { agent: Agent; x: number; y: number }): void
  (e: 'update:knowledgeFilterOpen', value: boolean): void
  (e: 'update:knowledgeFilterValue', value: Props['knowledgeFilterValue']): void
  (e: 'show-tools', agent: Agent): void
  (e: 'show-context', agent: Agent): void
  (e: 'show-tasks', agent: Agent): void
  (e: 'show-task-detail', payload: { agent: Agent; jobId: string }): void
  (e: 'chat', agent: Agent): void
  (e: 'settings', agent: Agent): void
  (e: 'create-ai'): void
}>()

const activeTab = ref<'brain' | 'knowledge'>('brain')
</script>

<template>
  <div class="glass rounded-2xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden h-full dark:bg-zinc-900/80 dark:border-zinc-800 transition-all duration-300 hover:shadow-md">
    <!-- Tab Header -->
    <div class="px-2 py-2 border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div class="flex p-1 bg-zinc-100/50 rounded-lg dark:bg-zinc-800/50">
        <button 
          @click="activeTab = 'brain'"
          class="flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-2"
          :class="activeTab === 'brain' 
            ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-400' 
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'"
        >
          <span>🧠</span> 智囊团核心
        </button>
        <button 
          @click="activeTab = 'knowledge'"
          class="flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-2"
          :class="activeTab === 'knowledge' 
            ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-400' 
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'"
        >
          <span>📚</span> 传承知识库
        </button>
      </div>
    </div>
    
    <div class="flex-1 overflow-hidden flex flex-col">
      <Transition name="fade" mode="out-in">
        <BrainCorePanel
          v-if="activeTab === 'brain'"
          class="flex-1"
          no-glass
          :admin-agents="adminAgents"
          @context="emit('context', $event)"
          @show-tools="emit('show-tools', $event)"
          @show-context="emit('show-context', $event)"
          @show-tasks="emit('show-tasks', $event)"
          @show-task-detail="emit('show-task-detail', $event)"
          @chat="emit('chat', $event)"
          @settings="emit('settings', $event)"
          @create-ai="emit('create-ai')"
        />
        <KnowledgeBasePanel 
          v-else
          class="flex-1"
          no-glass
          :items="knowledgeItems"
          :total-count="knowledgeTotalCount"
          :filter-open="knowledgeFilterOpen"
          :filter-value="knowledgeFilterValue"
          @update:filter-open="emit('update:knowledgeFilterOpen', $event)"
          @update:filter-value="emit('update:knowledgeFilterValue', $event)"
        />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
