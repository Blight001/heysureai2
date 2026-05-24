<script setup lang="ts">
interface KnowledgeItem {
  id: string
  title: string
  author: string
  time: string
  tags: string[]
}

interface Props {
  items: KnowledgeItem[]
  totalCount: number
  filterOpen: boolean
  filterValue: 'all' | 'inheritance' | 'system' | 'business'
  noGlass?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:filterOpen', value: boolean): void
  (e: 'update:filterValue', value: Props['filterValue']): void
}>()

const toggleFilter = () => {
  emit('update:filterOpen', !props.filterOpen)
}

const applyFilter = (value: Props['filterValue']) => {
  emit('update:filterValue', value)
  emit('update:filterOpen', false)
}

</script>

<template>
  <div :class="[
    'p-4 flex-1 flex flex-col overflow-hidden transition-all duration-300',
    noGlass ? '' : 'glass rounded-2xl border border-zinc-200 shadow-sm dark:bg-zinc-900/80 dark:border-zinc-800 hover:shadow-md'
  ]">
    <div class="flex justify-between items-center border-b border-zinc-100 pb-2 mb-2 dark:border-zinc-800">
      <h2 v-if="!noGlass" class="font-bold text-zinc-800 flex items-center gap-2 dark:text-zinc-100">
        <span>📚</span> 传承知识库
      </h2>
      <div v-else class="flex items-center gap-2">
        <span class="text-xs font-semibold text-zinc-500 dark:text-zinc-400">传承知识库</span>
      </div>
      <div class="flex items-center gap-2 relative">
        <span class="text-xs bg-zinc-100 px-2 py-0.5 rounded-full text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">{{ totalCount }} 条目</span>
        <button class="px-2 py-0.5 rounded border border-zinc-200 bg-white text-xs text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300" @click.stop="toggleFilter">
          筛选
        </button>
        <Transition name="fade">
          <div v-if="filterOpen" class="absolute right-0 top-8 w-36 bg-white border border-zinc-200 rounded-lg shadow-lg text-xs text-zinc-600 z-20 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200" @click.stop>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'all' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('all')">
              全部
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'inheritance' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('inheritance')">
              传承
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'system' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('system')">
              系统
            </button>
            <button class="w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-800" :class="filterValue === 'business' ? 'text-indigo-600 dark:text-indigo-300' : ''" @click="applyFilter('business')">
              业务
            </button>
          </div>
        </Transition>
      </div>
    </div>
    
    <div class="overflow-y-auto pr-1 space-y-2 flex-1 custom-scrollbar">
      <TransitionGroup name="list" tag="div" class="space-y-2">
        <div v-for="item in items" :key="item.id" class="p-3 bg-zinc-50 rounded border border-zinc-100 hover:border-indigo-200 transition-all duration-200 cursor-pointer group hover:scale-[1.01] hover:shadow-sm dark:bg-zinc-800 dark:border-zinc-700 dark:hover:border-indigo-400">
          <h4 class="text-sm font-medium text-zinc-800 group-hover:text-indigo-600 truncate dark:text-zinc-100 dark:group-hover:text-indigo-300">{{ item.title }}</h4>
          <div class="flex justify-between items-center mt-1">
            <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ item.author }}</span>
            <span class="text-[10px] text-zinc-400 dark:text-zinc-500">{{ item.time }}</span>
          </div>
          <div class="mt-2 flex gap-1 flex-wrap">
            <span v-for="tag in item.tags" :key="tag" class="text-[10px] px-1.5 py-0.5 bg-white border border-zinc-200 rounded text-zinc-500 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-400">
              #{{ tag }}
            </span>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>
