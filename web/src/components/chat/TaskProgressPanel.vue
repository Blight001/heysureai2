<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getAuthToken } from '@/api/http'
import { fetchTaskPlan, type TaskPlanPhase, type TaskPlanResponse } from '@/api/task'

/**
 * Task-mode progress panel.
 * - Default/compact: full vertical sidebar with details.
 * - header=true: minimal left-to-right flow using *colored titles* only (no badges/"完成" text).
 *   安排 = blue, phases colored by status (active=blue, completed=green, failed=red), 结束 = green/red.
 * Renders nothing for ordinary conversations.
 */
const props = withDefaults(defineProps<{
  configId?: number
  sessionId?: string
  /** Bump to force a refetch (e.g. when a run finishes / history reloads). */
  refreshSignal?: number
  /** Use tighter spacing when placed as sidebar inside chat dialog. */
  compact?: boolean
  /** Render as a minimal horizontal flow next to the chat title. */
  header?: boolean
}>(), {
  configId: undefined,
  sessionId: '',
  refreshSignal: 0,
  compact: false,
  header: false,
})

const emit = defineEmits<{
  (e: 'visibility-change', value: boolean): void
}>()

const data = ref<TaskPlanResponse | null>(null)
const loading = ref(false)

const visible = computed(() => !!data.value && data.value.stage !== 'none')

watch(visible, (v) => emit('visibility-change', v), { immediate: true })
const stage = computed(() => data.value?.stage ?? 'none')
const plan = computed(() => data.value?.plan ?? null)
const phases = computed<TaskPlanPhase[]>(() => plan.value?.phases ?? [])

const planningDone = computed(() => !!data.value?.has_plan)
const finished = computed(() => stage.value === 'finished')
const outcome = computed(() => data.value?.outcome ?? '')

const refresh = async () => {
  const token = getAuthToken()
  const sid = String(props.sessionId || '').trim()
  if (!token || props.configId === undefined || props.configId === null || !sid) {
    data.value = null
    return
  }
  loading.value = true
  try {
    data.value = await fetchTaskPlan(props.configId, sid, token)
    // After data update (esp. from polling or signal), try to center active if user idle
    if (props.header) {
      nextTick(() => requestAutoCenterIfIdle())
    }
  } catch {
    data.value = null
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.configId, props.sessionId, props.refreshSignal] as const,
  () => { void refresh() },
  { immediate: true },
)

const phaseStatusLabel: Record<string, string> = {
  pending: '待执行',
  active: '进行中',
  completed: '已完成',
  failed: '未达成',
}

const phaseDotClass = (phase: TaskPlanPhase) => {
  switch (phase.status) {
    case 'completed':
      return 'bg-emerald-500 border-emerald-500'
    case 'failed':
      return 'bg-rose-500 border-rose-500'
    case 'active':
      return 'bg-sky-500 border-sky-500 animate-pulse'
    default:
      return 'bg-transparent border-zinc-300 dark:border-zinc-600'
  }
}

const phaseBadgeClass = (phase: TaskPlanPhase) => {
  switch (phase.status) {
    case 'completed':
      return 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-900/30'
    case 'failed':
      return 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-900/30'
    case 'active':
      return 'text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-900/30'
    default:
      return 'text-zinc-500 bg-zinc-100 dark:text-zinc-400 dark:bg-zinc-800'
  }
}

const phaseTitleClass = (phase: TaskPlanPhase) => {
  switch (phase.status) {
    case 'completed':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'failed':
      return 'text-rose-600 dark:text-rose-400'
    case 'active':
      return 'text-blue-600 dark:text-blue-400'
    default:
      return 'text-zinc-500 dark:text-zinc-400'
  }
}

const endTitleClass = computed(() => {
  if (finished.value) {
    return outcome.value === 'failure'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-emerald-600 dark:text-emerald-400'
  }
  if (stage.value === 'finishing') {
    return 'text-indigo-600 dark:text-indigo-400'
  }
  return 'text-zinc-400 dark:text-zinc-500'
})

// Hover details state (for header mode tooltips)
const hovered = ref<null | { kind: 'arrange' | 'phase' | 'finish'; phase?: TaskPlanPhase }>(null)
const showHover = (kind: 'arrange' | 'phase' | 'finish', phase?: TaskPlanPhase) => {
  hovered.value = { kind, phase }
}
const clearHover = () => {
  hovered.value = null
}
const keepTooltipOpen = () => { /* prevent clearHover when mouse moves into the tooltip */ }

// --- Header mode enhancements: real-time updates, horizontal scroll, auto-center active ---
const flowScrollRef = ref<HTMLDivElement | null>(null)
const phaseEls = ref<Record<number, HTMLElement>>({})

const lastUserScroll = ref(0)
const setPhaseEl = (seq: number, el: any) => {
  if (el) {
    phaseEls.value[seq] = el as HTMLElement
  } else {
    delete phaseEls.value[seq]
  }
}

const markUserInteraction = () => {
  lastUserScroll.value = Date.now()
}

const scrollActiveToCenter = () => {
  const container = flowScrollRef.value
  if (!container) return
  const active = phases.value.find(p => p.status === 'active')
  if (!active) return
  const el = phaseEls.value[active.seq]
  if (!el) return
  const elCenter = el.offsetLeft + el.offsetWidth / 2
  const target = elCenter - container.clientWidth / 2
  container.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
}

const requestAutoCenterIfIdle = () => {
  if (Date.now() - lastUserScroll.value > 3000) {
    nextTick(() => nextTick(scrollActiveToCenter))
  }
}

// Polling for real-time plan status when displayed as header (top of chat)
let headerPollInterval: ReturnType<typeof setInterval> | null = null
const startPolling = () => {
  stopPolling()
  if (!props.header || props.configId == null || !props.sessionId) return
  headerPollInterval = setInterval(() => {
    void refresh()
  }, 2000)
}
const stopPolling = () => {
  if (headerPollInterval != null) {
    clearInterval(headerPollInterval)
    headerPollInterval = null
  }
}

watch(() => [props.header, props.configId, props.sessionId] as const, () => {
  if (props.header && props.configId != null && props.sessionId) {
    startPolling()
  } else {
    stopPolling()
  }
}, { immediate: true })

// Auto center active phase to middle of scroll view if user has not interacted in 3s
const activePhaseSeq = computed(() => {
  const act = phases.value.find(p => p.status === 'active')
  return act ? act.seq : -1
})

watch(activePhaseSeq, (seq) => {
  if (seq < 0) return
  requestAutoCenterIfIdle()
})

watch(phases, () => {
  requestAutoCenterIfIdle()
}, { deep: true })

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<template>
  <!-- Header mode: minimal horizontal flow placed next to title at top of dialog.
       Status is shown purely via title color (no badges or "完成" labels).
       Hover any item (安排 / 阶段 / 结束) to see details. -->
  <div v-if="visible && props.header" class="relative">
    <div
      ref="flowScrollRef"
      class="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap overflow-x-auto max-w-[480px] pb-1"
      @wheel.passive="markUserInteraction"
      @mousedown="markUserInteraction"
    >
      <!-- 安排（蓝色） -->
      <span
        class="font-medium text-blue-600 dark:text-blue-400 cursor-help hover:underline decoration-dotted"
        @mouseenter="showHover('arrange')"
        @mouseleave="clearHover"
      >安排</span>
      <span class="text-zinc-400">→</span>

      <!-- 各阶段（颜色即状态） -->
      <template v-for="phase in phases" :key="phase.seq">
        <span
          class="font-medium cursor-help hover:underline decoration-dotted"
          :class="phaseTitleClass(phase)"
          :ref="el => setPhaseEl(phase.seq, el)"
          @mouseenter="showHover('phase', phase)"
          @mouseleave="clearHover"
        >{{ phase.title }}</span>
        <span class="text-zinc-400">→</span>
      </template>

      <!-- 结束（成功绿 / 失败红） -->
      <span
        class="font-medium cursor-help hover:underline decoration-dotted"
        :class="endTitleClass"
        @mouseenter="showHover('finish')"
        @mouseleave="clearHover"
      >结束</span>
    </div>

    <!-- 共享悬停详情卡片（鼠标移到阶段上显示） -->
    <div
      v-if="hovered"
      class="absolute left-0 top-full mt-1 z-[90] rounded-lg border border-zinc-200 bg-white/95 shadow-xl p-2 text-[11px] leading-snug text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-200 min-w-[210px] max-w-[280px]"
      @mouseenter="keepTooltipOpen"
      @mouseleave="clearHover"
    >
      <!-- 安排详情 -->
      <template v-if="hovered.kind === 'arrange'">
        <div class="font-semibold text-blue-700 dark:text-blue-400 mb-1">安排</div>
        <div v-if="plan?.goal">目标：{{ plan.goal }}</div>
        <div class="mt-0.5">共 {{ plan?.phase_count ?? phases.length }} 个阶段</div>
        <div v-if="stage === 'planning'" class="mt-1 text-amber-600 dark:text-amber-400 text-[10px]">
          正在制定分阶段计划…
        </div>
      </template>

      <!-- 单个阶段详情 -->
      <template v-else-if="hovered.kind === 'phase' && hovered.phase">
        <div class="font-semibold mb-1">
          阶段 {{ hovered.phase.seq + 1 }}：{{ hovered.phase.title }}
        </div>
        <div v-if="hovered.phase.goal" class="mt-0.5">目标：{{ hovered.phase.goal }}</div>
        <div v-if="hovered.phase.done_signal" class="mt-0.5 text-zinc-500 dark:text-zinc-400">
          结束标志：{{ hovered.phase.done_signal }}
        </div>

        <ul v-if="hovered.phase.actions?.length" class="mt-1 ml-3 list-disc space-y-0.5 text-[10px] text-zinc-600 dark:text-zinc-400">
          <li v-for="(action, i) in hovered.phase.actions" :key="i">
            {{ action.goal }}
            <span v-if="action.done_signal" class="text-[9px] text-zinc-400">（{{ action.done_signal }}）</span>
          </li>
        </ul>

        <div v-if="hovered.phase.summary" class="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-2">
          {{ hovered.phase.summary }}
        </div>

        <div class="mt-1 text-[10px]" :class="{
          'text-blue-600 dark:text-blue-400': hovered.phase.status === 'active',
          'text-emerald-600 dark:text-emerald-400': hovered.phase.status === 'completed',
          'text-rose-600 dark:text-rose-400': hovered.phase.status === 'failed'
        }">
          状态：{{ phaseStatusLabel[hovered.phase.status] || hovered.phase.status }}
        </div>
      </template>

      <!-- 结束详情 -->
      <template v-else-if="hovered.kind === 'finish'">
        <div class="font-semibold mb-1">结束</div>
        <div v-if="finished">
          {{ outcome === 'failure' ? '任务失败，已写入失败日志' : '任务完成，已写入成功日志' }}
        </div>
        <div v-else-if="stage === 'finishing'">所有阶段完成，正在总结收尾…</div>
        <div v-else>待所有阶段完成后总结</div>
      </template>
    </div>
  </div>

  <!-- Original sidebar / default mode -->
  <div
    v-if="visible && !props.header"
    :class="[
      'rounded-lg border border-zinc-200 bg-white/70 dark:border-zinc-700 dark:bg-zinc-900/60',
      props.compact ? 'px-1.5 py-1 text-[10px]' : 'px-2.5 py-2 text-[11px]'
    ]"
  >
    <div :class="props.compact ? 'mb-1 flex items-center justify-between gap-1' : 'mb-2 flex items-center justify-between gap-2'">
      <div class="flex items-center gap-1.5 font-semibold text-zinc-700 dark:text-zinc-200">
        <span>任务流程</span>
        <span
          v-if="stage === 'planning'"
          class="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        >安排中</span>
        <span
          v-else-if="stage === 'executing'"
          class="rounded bg-sky-50 px-1.5 py-0.5 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
        >实施中</span>
        <span
          v-else-if="stage === 'finishing'"
          class="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
        >收尾中</span>
        <span
          v-else-if="finished"
          :class="outcome === 'failure'
            ? 'rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
            : 'rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'"
        >{{ outcome === 'failure' ? '已失败' : '已完成' }}</span>
      </div>
      <button
        class="text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-200"
        :disabled="loading"
        title="刷新进度"
        @click="refresh"
      >↻</button>
    </div>

    <p v-if="plan?.goal" :class="props.compact ? 'mb-1 line-clamp-2 text-zinc-600 dark:text-zinc-300' : 'mb-2 line-clamp-2 text-zinc-600 dark:text-zinc-300'">
      目标：{{ plan.goal }}
    </p>

    <ol :class="props.compact ? 'space-y-1' : 'space-y-1.5'">
      <!-- 安排 -->
      <li class="flex items-start gap-2">
        <span
          class="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full border"
          :class="planningDone ? 'bg-emerald-500 border-emerald-500' : 'bg-amber-500 border-amber-500 animate-pulse'"
        />
        <div class="min-w-0">
          <span class="font-medium text-zinc-700 dark:text-zinc-200">安排</span>
          <span class="ml-1 text-zinc-500 dark:text-zinc-400">
            {{ planningDone ? `已制定计划（共 ${plan?.phase_count ?? phases.length} 个阶段）` : '正在制定分阶段计划…' }}
          </span>
        </div>
      </li>

      <!-- 各阶段 + 子任务 -->
      <li v-for="phase in phases" :key="phase.seq" class="flex items-start gap-2">
        <span class="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full border" :class="phaseDotClass(phase)" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="font-medium text-zinc-700 dark:text-zinc-200">
              阶段 {{ phase.seq + 1 }}：{{ phase.title }}
            </span>
            <span class="rounded px-1.5 py-0.5 text-[10px]" :class="phaseBadgeClass(phase)">
              {{ phaseStatusLabel[phase.status] || phase.status }}
            </span>
          </div>
          <div v-if="phase.status === 'active'" class="mt-1 space-y-1 text-zinc-500 dark:text-zinc-400">
            <div v-if="phase.goal">目标：{{ phase.goal }}</div>
            <div v-if="phase.done_signal">结束标志：{{ phase.done_signal }}</div>
            <ul v-if="phase.actions?.length" class="ml-3 list-disc space-y-0.5">
              <li v-for="(action, idx) in phase.actions" :key="idx">
                {{ action.goal }}
                <span v-if="action.done_signal" class="text-zinc-400 dark:text-zinc-500">
                  （{{ action.done_signal }}）
                </span>
              </li>
            </ul>
          </div>
          <div v-else-if="phase.summary" class="mt-0.5 line-clamp-1 text-zinc-400 dark:text-zinc-500">
            {{ phase.summary }}
          </div>
        </div>
      </li>

      <!-- 结束 -->
      <li class="flex items-start gap-2">
        <span
          class="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full border"
          :class="finished
            ? (outcome === 'failure' ? 'bg-rose-500 border-rose-500' : 'bg-emerald-500 border-emerald-500')
            : (stage === 'finishing' ? 'bg-indigo-500 border-indigo-500 animate-pulse' : 'bg-transparent border-zinc-300 dark:border-zinc-600')"
        />
        <div class="min-w-0">
          <span class="font-medium text-zinc-700 dark:text-zinc-200">结束</span>
          <span class="ml-1 text-zinc-500 dark:text-zinc-400">
            <template v-if="finished">{{ outcome === 'failure' ? '任务失败，已写入失败日志' : '任务完成，已写入成功日志' }}</template>
            <template v-else-if="stage === 'finishing'">所有阶段完成，正在总结收尾…</template>
            <template v-else>待所有阶段完成后总结</template>
          </span>
        </div>
      </li>
    </ol>
  </div>
</template>
