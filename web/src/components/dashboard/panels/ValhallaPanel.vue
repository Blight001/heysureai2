<script setup lang="ts">
import { computed, ref } from 'vue'
import ActiveAgentsPanel from './ActiveAgentsPanel.vue'
import WorkshopPanel from './WorkshopPanel.vue'
import { readValhallaEntry, type ValhallaEntry, type ValhallaEntryDetail } from '@/api/valhalla'
import { getAuthToken } from '@/api/http'
import type { ConnectedAgent } from '@/composables/dashboard/useDashboardData'

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
  entries: ValhallaEntry[]
  activeAgents: Agent[]
  connectedAgents: ConnectedAgent[]
}

const props = defineProps<Props>()

const activeTab = ref<'valhalla' | 'active' | 'workshop'>('valhalla')

// 按 job 分组，便于"任务 → 代际"的层级浏览
type JobGroup = {
  jobId: string
  jobTitle: string
  aiName: string
  latestCreatedAt: number
  entries: ValhallaEntry[]
}

const groupedEntries = computed<JobGroup[]>(() => {
  const map = new Map<string, JobGroup>()
  for (const entry of props.entries || []) {
    const g = map.get(entry.job_id)
    if (g) {
      g.entries.push(entry)
      g.latestCreatedAt = Math.max(g.latestCreatedAt, entry.created_at)
    } else {
      map.set(entry.job_id, {
        jobId: entry.job_id,
        jobTitle: entry.job_title || entry.job_id,
        aiName: entry.ai_name,
        latestCreatedAt: entry.created_at,
        entries: [entry],
      })
    }
  }
  const list = Array.from(map.values())
  for (const g of list) {
    g.entries.sort((a, b) => a.generation - b.generation || a.created_at - b.created_at)
  }
  list.sort((a, b) => b.latestCreatedAt - a.latestCreatedAt)
  return list
})

const expandedJobs = ref<Set<string>>(new Set())
const toggleJob = (jobId: string) => {
  const next = new Set(expandedJobs.value)
  if (next.has(jobId)) next.delete(jobId)
  else next.add(jobId)
  expandedJobs.value = next
}

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const currentDetail = ref<ValhallaEntryDetail | null>(null)

const formatTime = (ts: number) => {
  if (!ts) return ''
  try {
    const date = new Date(ts * 1000)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    return `${y}-${m}-${d} ${hh}:${mm}`
  } catch {
    return ''
  }
}

const kindLabel = (kind: string) => {
  if (kind === 'inherit') return '传承'
  if (kind === 'complete') return '完成'
  if (kind === 'aborted') return '中断'
  return kind
}

const kindClass = (kind: string) => {
  if (kind === 'complete') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
  if (kind === 'aborted') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
  return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
}

const openEntry = async (entry: ValhallaEntry) => {
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  currentDetail.value = null
  try {
    const token = getAuthToken()
    currentDetail.value = await readValhallaEntry(token, entry.id)
  } catch (err) {
    detailError.value = (err as Error).message || '加载失败'
  } finally {
    detailLoading.value = false
  }
}

const closeDetail = () => {
  detailOpen.value = false
  currentDetail.value = null
  detailError.value = ''
}
</script>

<template>
  <div class="glass rounded-2xl border border-zinc-200 shadow-sm flex flex-col overflow-hidden h-full dark:bg-zinc-900/80 dark:border-zinc-800 transition-all duration-300 hover:shadow-md">
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
        <button
          @click="activeTab = 'workshop'"
          class="flex-1 px-3 py-1.5 text-xs font-bold rounded-md transition-all duration-200 flex items-center justify-center gap-2"
          :class="activeTab === 'workshop'
            ? 'bg-white text-indigo-600 shadow-sm dark:bg-zinc-700 dark:text-indigo-400'
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'"
        >
          <span>🏭</span> 作坊
        </button>
      </div>
    </div>

    <div v-if="activeTab === 'valhalla'" class="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
      <div v-if="groupedEntries.length === 0" class="text-center text-zinc-400 text-xs py-10 dark:text-zinc-500">
        暂无传承记录，文明尚在萌芽。
      </div>

      <div v-for="group in groupedEntries" :key="group.jobId" class="rounded-xl border border-zinc-200 bg-white/60 dark:border-zinc-800 dark:bg-zinc-900/60">
        <button
          class="w-full flex items-start justify-between gap-2 px-3 py-2 text-left"
          @click="toggleJob(group.jobId)"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-zinc-400">{{ expandedJobs.has(group.jobId) ? '▾' : '▸' }}</span>
              <h4 class="text-sm font-bold text-zinc-700 dark:text-zinc-200 truncate" :title="group.jobTitle">
                {{ group.jobTitle }}
              </h4>
            </div>
            <p class="text-[11px] text-zinc-500 mt-0.5 dark:text-zinc-400">
              {{ group.aiName }} · 共 {{ group.entries.length }} 代 · 最近 {{ formatTime(group.latestCreatedAt) }}
            </p>
          </div>
        </button>

        <div v-if="expandedJobs.has(group.jobId)" class="px-3 pb-3 space-y-2">
          <div
            v-for="entry in group.entries"
            :key="entry.id"
            class="rounded-lg border border-zinc-100 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/40 p-2.5 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 transition"
            @click="openEntry(entry)"
          >
            <div class="flex items-center gap-2 mb-1">
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded" :class="kindClass(entry.kind)">
                {{ kindLabel(entry.kind) }}
              </span>
              <span class="text-xs text-zinc-600 dark:text-zinc-300">第 {{ entry.generation }} 代</span>
              <span class="ml-auto text-[10px] text-zinc-400">{{ formatTime(entry.created_at) }}</span>
            </div>
            <div class="text-xs text-zinc-600 dark:text-zinc-300 italic line-clamp-2">
              {{ entry.summary_excerpt || '（未提供摘要）' }}
            </div>
            <div class="flex items-center gap-3 mt-1.5 text-[10px] text-zinc-400">
              <span>Token {{ entry.token_used.toLocaleString() }} / {{ entry.token_limit.toLocaleString() }}</span>
              <span v-if="entry.artifacts_count > 0">产出 {{ entry.artifacts_count }} 项</span>
              <span v-if="entry.unfinished_count > 0">未完成 {{ entry.unfinished_count }} 项</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ActiveAgentsPanel v-else-if="activeTab === 'active'" :active-agents="activeAgents" />
    <WorkshopPanel v-else :devices="connectedAgents" :agents="activeAgents" />

    <!-- 遗言全文弹窗 -->
    <div
      v-if="detailOpen"
      class="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4"
      @click.self="closeDetail"
    >
      <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-zinc-200 dark:border-zinc-800">
        <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-zinc-700 dark:text-zinc-200">英灵殿遗言</span>
            <span v-if="currentDetail" class="text-xs text-zinc-500 dark:text-zinc-400">
              · {{ currentDetail.entry.ai_name }} · 第 {{ currentDetail.entry.generation }} 代
            </span>
          </div>
          <button class="text-zinc-400 hover:text-zinc-600 text-xl leading-none" @click="closeDetail">×</button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 custom-scrollbar">
          <div v-if="detailLoading" class="text-center text-zinc-400 py-10">加载中…</div>
          <div v-else-if="detailError" class="text-center text-rose-500 py-10">{{ detailError }}</div>
          <template v-else-if="currentDetail">
            <pre class="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-200 bg-zinc-50 dark:bg-zinc-800/40 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800">{{ currentDetail.content }}</pre>

            <div v-if="currentDetail.sidecars && currentDetail.sidecars['artifacts.json']?.items?.length" class="mt-4">
              <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">本代变更明细</div>
              <ul class="text-xs space-y-1 text-zinc-600 dark:text-zinc-300">
                <li v-for="(art, i) in currentDetail.sidecars['artifacts.json']!.items" :key="i" class="font-mono">
                  <span class="text-indigo-500">{{ art.tool }}</span> → {{ art.path || art.args_preview }}
                </li>
              </ul>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
