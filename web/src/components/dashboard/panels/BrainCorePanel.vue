<script setup lang="ts">
import { computed, ref } from 'vue'
import AgentCard from '../cards/AgentCard.vue'

interface Agent {
  id: string
  name: string
  role: 'admin' | 'worker'
  aiRole?: 'assistant_admin' | 'digital_member' | 'admin' | 'worker'
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
  activeRunStatus?: string
  latestThinking?: string
}

interface Props {
  adminAgents: Agent[]
  memberAgents: Agent[]
  viewMode: 'sections' | 'all'
  noGlass?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'context', payload: { agent: Agent; x: number; y: number }): void
  (e: 'show-tools', agent: Agent): void
  (e: 'show-context', agent: Agent): void
  (e: 'show-tasks', agent: Agent): void
  (e: 'show-task-detail', payload: { agent: Agent; jobId: string }): void
  (e: 'chat', agent: Agent): void
  (e: 'settings', agent: Agent): void
  (e: 'create-ai'): void
  (e: 'update:view-mode', value: Props['viewMode']): void
}>()

const activeSection = ref<'admins' | 'members'>('admins')
const allAgents = computed(() => [...props.adminAgents, ...props.memberAgents])
const isAllView = computed(() => props.viewMode === 'all')

const toggleViewMode = () => {
  emit('update:view-mode', isAllView.value ? 'sections' : 'all')
}
</script>

<template>
  <div :class="[
    'p-4 flex flex-col gap-4 transition-all duration-300 h-full',
    noGlass ? '' : 'glass rounded-2xl border border-zinc-200 shadow-sm dark:bg-zinc-900/80 dark:border-zinc-800 hover:shadow-md'
  ]">
    <div class="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800 flex-shrink-0">
      <h2 v-if="!noGlass" class="font-bold text-zinc-800 flex items-center gap-2 dark:text-zinc-100">
        <span>🧠</span> 智囊团核心
      </h2>
      <div v-else class="flex items-center gap-2">
        <span class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">智囊团核心</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700" @click="toggleViewMode">
          {{ isAllView ? '切换栏目查看' : '一栏查看全部' }}
        </button>
        <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700" @click="emit('create-ai')">+ 新建 AI</button>
      </div>
    </div>

    <div v-if="!isAllView" class="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/80">
      <button
        type="button"
        class="h-8 rounded-md px-2 text-xs font-semibold transition-colors"
        :class="activeSection === 'admins'
          ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'"
        @click="activeSection = 'admins'"
      >
        核心管理员 · {{ adminAgents.length }}
      </button>
      <button
        type="button"
        class="h-8 rounded-md px-2 text-xs font-semibold transition-colors"
        :class="activeSection === 'members'
          ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
          : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'"
        @click="activeSection = 'members'"
      >
        数字社会成员 · {{ memberAgents.length }}
      </button>
    </div>

    <div class="flex-1 min-h-0 overflow-hidden">
      <section v-if="isAllView" class="h-full min-h-0 min-w-0 flex flex-col">
        <div class="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">全部 AI · {{ allAgents.length }}</div>

        <div v-if="allAgents.length === 0" class="p-4 text-xs text-zinc-400 text-center rounded border border-dashed border-zinc-200 dark:border-zinc-700 dark:text-zinc-500">
          暂无 AI 配置
        </div>

        <TransitionGroup v-else name="list" tag="div" class="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overflow-x-visible pr-2 pt-2 pb-1">
          <AgentCard
            v-for="agent in allAgents"
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
      </section>

      <section v-else-if="activeSection === 'admins'" class="h-full min-h-0 min-w-0 flex flex-col">
        <div class="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">数字社会核心管理员</div>

        <div v-if="adminAgents.length === 0" class="p-4 bg-red-50 text-red-600 text-sm rounded border border-red-100 animate-pulse dark:bg-red-500/10 dark:border-red-500/20">
          ⚠️ 警告：管理员离线或正在重生中...
        </div>

        <TransitionGroup v-else name="list" tag="div" class="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overflow-x-visible pr-2 pt-2 pb-1">
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
      </section>

      <section v-else class="h-full min-h-0 min-w-0 flex flex-col">
        <div class="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">数字社会成员</div>

        <div v-if="memberAgents.length === 0" class="p-4 text-xs text-zinc-400 text-center rounded border border-dashed border-zinc-200 dark:border-zinc-700 dark:text-zinc-500">
          暂无空闲成员
        </div>

        <TransitionGroup v-else name="list" tag="div" class="flex-1 min-h-0 flex flex-col gap-3 overflow-y-auto overflow-x-visible pr-2 pt-2 pb-1">
          <AgentCard
            v-for="agent in memberAgents"
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
      </section>
    </div>
  </div>
</template>
