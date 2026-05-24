<script setup lang="ts">
import { computed, ref } from 'vue'
import { readEntry, type KnowledgeEntryItem } from '@/api/librarian'
import { getAuthToken } from '@/api/http'

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

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const selectedItem = ref<KnowledgeItem | null>(null)
const currentDetail = ref<KnowledgeEntryItem | null>(null)

const detailContent = computed(() => currentDetail.value?.body || currentDetail.value?.summary || '（无内容）')

const toggleFilter = () => {
  emit('update:filterOpen', !props.filterOpen)
}

const applyFilter = (value: Props['filterValue']) => {
  emit('update:filterValue', value)
  emit('update:filterOpen', false)
}

const formatTime = (ts?: number | null) => {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const openDetail = async (item: KnowledgeItem) => {
  selectedItem.value = item
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  currentDetail.value = null
  try {
    const token = getAuthToken()
    currentDetail.value = await readEntry(token, item.id)
  } catch (err) {
    detailError.value = (err as Error).message || '条目加载失败'
  } finally {
    detailLoading.value = false
  }
}

const closeDetail = () => {
  detailOpen.value = false
  detailError.value = ''
  currentDetail.value = null
  selectedItem.value = null
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
      <div v-if="items.length === 0" class="text-center text-zinc-400 text-xs py-10 dark:text-zinc-500">
        暂无知识库条目
      </div>
      <TransitionGroup name="list" tag="div" class="space-y-2">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="w-full text-left p-3 bg-zinc-50 rounded border border-zinc-100 hover:border-indigo-200 transition-all duration-200 cursor-pointer group hover:scale-[1.01] hover:shadow-sm dark:bg-zinc-800 dark:border-zinc-700 dark:hover:border-indigo-400"
          @click="openDetail(item)"
        >
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
        </button>
      </TransitionGroup>
    </div>

    <div
      v-if="detailOpen"
      class="fixed inset-0 z-[320] bg-black/50 flex items-center justify-center p-4"
      @click.self="closeDetail"
    >
      <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-zinc-200 dark:border-zinc-800">
        <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-zinc-700 dark:text-zinc-200 truncate">
              {{ currentDetail?.title || selectedItem?.title || '知识库详情' }}
            </div>
            <div class="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {{ currentDetail?.memory_id || selectedItem?.id }}
            </div>
          </div>
          <button class="ml-3 text-zinc-400 hover:text-zinc-600 text-xl leading-none" @click="closeDetail">×</button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 custom-scrollbar">
          <div v-if="detailLoading" class="text-center text-zinc-400 py-10">加载中…</div>
          <div v-else-if="detailError" class="text-center text-rose-500 py-10">{{ detailError }}</div>
          <template v-else-if="currentDetail">
            <div class="mb-3 flex flex-wrap gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">范围：{{ currentDetail.scope }}</span>
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">置信度：{{ Math.round(currentDetail.confidence * 100) }}%</span>
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">使用：{{ currentDetail.use_count }} 次</span>
              <span class="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800">更新：{{ formatTime(currentDetail.updated_at) }}</span>
            </div>

            <div v-if="currentDetail.triggers.length" class="mb-4 flex flex-wrap gap-1.5">
              <span
                v-for="trigger in currentDetail.triggers"
                :key="trigger"
                class="text-[10px] px-1.5 py-0.5 bg-white border border-zinc-200 rounded text-zinc-500 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-400"
              >
                #{{ trigger }}
              </span>
            </div>

            <div v-if="currentDetail.summary" class="mb-4">
              <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">摘要</div>
              <div class="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">
                {{ currentDetail.summary }}
              </div>
            </div>

            <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">具体内容</div>
            <pre class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">{{ detailContent }}</pre>

            <div v-if="currentDetail.source_job_id" class="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
              来源任务：{{ currentDetail.source_job_id }} · 第 {{ currentDetail.source_generation || 1 }} 代
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
