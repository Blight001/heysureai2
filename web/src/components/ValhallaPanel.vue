<script setup lang="ts">
import { ref } from 'vue'
import ActiveAgentsPanel from './ActiveAgentsPanel.vue'

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
  deadAgents: Agent[]
  activeAgents: Agent[]
}

defineProps<Props>()

const activeTab = ref<'valhalla' | 'active'>('valhalla')
</script>

<template>
  <div class="glass rounded-2xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden h-full dark:bg-zinc-900/80 dark:border-zinc-800 transition-all duration-300 hover:shadow-md">
    <!-- Tab Header -->
    <div class="px-2 py-2 border-b border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div class="flex p-1 bg-zinc-100/50 rounded-lg dark:bg-zinc-800/50">
        <button 
          @click="activeTab = 'valhalla'"
          class="flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-2"
          :class="activeTab === 'valhalla' 
            ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-400' 
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'"
        >
          <span>📜</span> 英灵殿
        </button>
        <button 
          @click="activeTab = 'active'"
          class="flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-2"
          :class="activeTab === 'active' 
            ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-400' 
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'"
        >
          <span>🌱</span> 存活 AI
        </button>
      </div>
    </div>
    
    <div v-if="activeTab === 'valhalla'" class="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
      <div v-if="deadAgents.length === 0" class="text-center text-zinc-400 text-xs py-10 dark:text-zinc-500">
        暂无牺牲者，文明尚在萌芽。
      </div>
      
      <TransitionGroup name="list" tag="div" class="space-y-4">
        <div v-for="agent in deadAgents" :key="agent.id" class="relative pl-4 border-l-2 border-zinc-200 pb-4 last:pb-0 group">
          <div class="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-zinc-300 border-2 border-white dark:border-zinc-900 transition-colors group-hover:bg-zinc-400 group-hover:scale-110"></div>
          <div class="opacity-75 hover:opacity-100 transition-all duration-300 transform hover:translate-x-1">
             <div class="flex items-center gap-1.5 mb-0.5">
               <h4 class="text-sm font-bold text-zinc-700 dark:text-zinc-200">{{ agent.name }}</h4>
               <span class="opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-[10px]">🔍</span>
             </div>
             <p class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">享年 (Tokens): {{ agent.tokenLimit.toLocaleString() }}</p>
             <div class="bg-zinc-100 p-2 rounded text-xs text-zinc-600 italic border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300">
               "{{ agent.summary || '未留下遗言' }}"
             </div>

             <!-- Hover Details Section for Dead Agents -->
             <div class="max-h-0 overflow-hidden group-hover:max-h-40 transition-all duration-500 ease-in-out">
               <div class="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                 <div class="flex justify-between items-center text-[10px]">
                   <span class="text-zinc-400">职能类型:</span>
                   <span class="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                     {{ agent.role === 'admin' ? '系统管理员' : '业务执行者' }}
                   </span>
                 </div>
                 <div class="flex justify-between items-center text-[10px]">
                   <span class="text-zinc-400">文明代数:</span>
                   <span class="text-zinc-500 dark:text-zinc-400">Gen {{ agent.generation }}</span>
                 </div>
                 <div class="flex justify-between items-center text-[10px]">
                   <span class="text-zinc-400">运行平台:</span>
                   <span class="text-zinc-500 dark:text-zinc-400">{{ agent.platform }}</span>
                 </div>
                 <div v-if="agent.projectName" class="flex justify-between items-center text-[10px]">
                   <span class="text-zinc-400">所属项目:</span>
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
      </TransitionGroup>
    </div>

    <ActiveAgentsPanel v-else :active-agents="activeAgents" />
  </div>
</template>
