<script setup lang="ts">
import { computed, ref } from 'vue'
import ChatConversationView from '@/components/chat/ChatConversationView.vue'
import {
  canPauseTaskJob,
  canResumeTaskJob,
  getTaskJobRuntimeState,
  getTaskPayloadTags,
  getTaskStateClass,
  getTaskStateLabel,
  isCompletedTaskJob,
} from '@/utils/taskSystem'
import type {
  AITaskGenerationItem,
  AITaskGenerationMessage,
  AITaskJobItem,
  AITaskListItem,
  TaskCreateForm,
} from '@/utils/taskSystem'
import { getMcpToolZhLabel, groupMcpToolGroupsByParent, groupMcpToolsByZhTag } from '@/utils/mcpTools'
import type { Agent } from '@/types'

interface Props {
  show: boolean
  target: Agent | null
  taskListItems: AITaskListItem[]
  taskJobs: AITaskJobItem[]
  selectedTaskJobIds: string[]
  taskListLoading: boolean
  taskCreatePanelOpen: boolean
  taskCreateSubmitting: boolean
  taskCreateForm: TaskCreateForm
  availableMcpTools: string[]
  defaultMcpTools: string[]
  taskDetailOpen: boolean
  taskDetailLoading: boolean
  taskDetailJob: AITaskJobItem | null
  taskGenerations: AITaskGenerationItem[]
  selectedGeneration: number
  onClose: () => void
  onRefresh: () => void
  onToggleTaskCreatePanel: () => void
  onCloseTaskCreatePanel: () => void
  onSubmitTask: () => void
  onTaskCreateToolChange: (tool: string, event: Event) => void
  onOpenTaskDetail: (job: AITaskJobItem) => void
  onReuseTaskTemplate: (job: AITaskJobItem) => void
  onPauseTaskJob: (job: AITaskJobItem) => void
  onResumeTaskJob: (job: AITaskJobItem) => void
  onDeleteTaskJob: (job: AITaskJobItem) => void
  onToggleAllTaskJobsSelection: (event: Event) => void
  onTaskJobSelectChange: (jobId: string, event: Event) => void
  onBatchDeleteTaskJobs: () => void
  onCloseTaskDetail: () => void
  onUpdateSelectedGeneration: (value: number) => void
}

const props = defineProps<Props>()
type JobStateFilter = 'running' | 'next' | 'scheduled' | 'completed'
const selectedJobStateFilter = ref<JobStateFilter | null>(null)
const taskMcpToolGroups = computed(() => groupMcpToolsByZhTag(props.availableMcpTools.length ? props.availableMcpTools : props.defaultMcpTools))
const taskMcpToolParentGroups = computed(() => groupMcpToolGroupsByParent(taskMcpToolGroups.value))

const completedTaskJobs = computed(() => {
  return props.taskJobs.filter(isCompletedTaskJob)
})

const getJobVisualState = (job: AITaskJobItem) => {
  if (isCompletedTaskJob(job)) return 'completed'
  return getTaskJobRuntimeState(job)
}

const isJobStateMatched = (job: AITaskJobItem, state: JobStateFilter | null) => {
  if (!state) return true
  return getJobVisualState(job) === state
}

const taskStateRank = (job: AITaskJobItem) => {
  const state = getJobVisualState(job)
  if (state === 'running') return 0
  if (state === 'next') return 1
  if (state === 'scheduled') return 2
  if (state === 'completed') return 3
  return 3
}

const sortedTaskJobs = computed(() => {
  const cloned = [...props.taskJobs]
  cloned.sort((a, b) => {
    const rankDiff = taskStateRank(a) - taskStateRank(b)
    if (rankDiff !== 0) return rankDiff
    const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0)
    if (priorityDiff !== 0) return priorityDiff
    const createdDiff = Number(b.created_at || 0) - Number(a.created_at || 0)
    if (createdDiff !== 0) return createdDiff
    return String(a.job_id || '').localeCompare(String(b.job_id || ''))
  })
  return cloned
})

const filteredSortedTaskJobs = computed(() => {
  return sortedTaskJobs.value.filter(job => isJobStateMatched(job, selectedJobStateFilter.value))
})

const filteredCompletedTaskJobs = computed(() => {
  return filteredSortedTaskJobs.value.filter(isCompletedTaskJob)
})

const selectedTaskJobsCount = computed(() => props.selectedTaskJobIds.length)

const allTaskJobsSelected = computed(() => {
  if (filteredCompletedTaskJobs.value.length === 0) return false
  const selected = new Set(props.selectedTaskJobIds)
  return filteredCompletedTaskJobs.value.every(job => selected.has(job.job_id))
})

const selectedGenerationDetail = computed(() => {
  return props.taskGenerations.find(item => item.generation === props.selectedGeneration) || null
})

const selectedGenerationMessages = computed<AITaskGenerationMessage[]>(() => {
  if (!selectedGenerationDetail.value) return []
  return selectedGenerationDetail.value.messages
})

const canViewJobDetail = (status?: string) => {
  return ['running', 'completed', 'cancelled', 'error', 'stopped'].includes(String(status || '').toLowerCase())
}

const formatTs = (value?: number) => {
  if (!value) return '--'
  const d = new Date(value * 1000)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString()
}

const onSelectedGenerationChange = (event: Event) => {
  const target = event.target as HTMLSelectElement | null
  if (!target) return
  const next = Number(target.value)
  props.onUpdateSelectedGeneration(Number.isFinite(next) ? next : 1)
}

const onScheduleEnabledChange = (event: Event) => {
  const target = event.target as HTMLInputElement | null
  const enabled = !!target?.checked
  props.taskCreateForm.schedule_enabled = enabled
  if (!enabled) {
    props.taskCreateForm.schedule_loop_enabled = false
    props.taskCreateForm.schedule_run_immediately = false
  }
}

const onScheduleLoopEnabledChange = (event: Event) => {
  const target = event.target as HTMLInputElement | null
  const enabled = !!target?.checked
  props.taskCreateForm.schedule_loop_enabled = enabled
  if (enabled) {
    props.taskCreateForm.schedule_time_mode = 'duration'
    props.taskCreateForm.schedule_at = ''
  } else {
    props.taskCreateForm.schedule_run_immediately = false
  }
}

const onScheduleTimeModeChange = (event: Event) => {
  const target = event.target as HTMLInputElement | null
  const mode = target?.value === 'datetime' ? 'datetime' : 'duration'
  props.taskCreateForm.schedule_time_mode = mode
  if (mode === 'duration') {
    props.taskCreateForm.schedule_at = ''
  }
}

const toggleJobStateFilter = (state: JobStateFilter) => {
  selectedJobStateFilter.value = selectedJobStateFilter.value === state ? null : state
}

const taskStateFilterButtonClass = (state: JobStateFilter) => {
  const active = selectedJobStateFilter.value === state
  if (state === 'running') {
    return active
      ? 'border-emerald-500 bg-emerald-100 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-500/25 dark:text-emerald-200'
      : 'border-emerald-300 text-emerald-700 dark:border-emerald-500/60 dark:text-emerald-300'
  }
  if (state === 'next') {
    return active
      ? 'border-amber-500 bg-amber-100 text-amber-700 dark:border-amber-400 dark:bg-amber-500/25 dark:text-amber-200'
      : 'border-amber-300 text-amber-700 dark:border-amber-500/60 dark:text-amber-300'
  }
  if (state === 'scheduled') {
    return active
      ? 'border-blue-500 bg-blue-100 text-blue-700 dark:border-blue-400 dark:bg-blue-500/25 dark:text-blue-200'
      : 'border-blue-300 text-blue-700 dark:border-blue-500/60 dark:text-blue-300'
  }
  return active
    ? 'border-zinc-500 bg-zinc-200 text-zinc-700 dark:border-zinc-400 dark:bg-zinc-700 dark:text-zinc-100'
    : 'border-zinc-300 text-zinc-700 dark:border-zinc-500/70 dark:text-zinc-300'
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show && target" class="fixed inset-0 z-[88] bg-black/45 flex items-center justify-center p-4" @click="onClose">
      <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-2xl min-h-[72vh] max-h-[90vh] overflow-y-auto p-5" @click.stop>
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{{ target.name }} 的任务列表</div>
            <div class="text-xs text-zinc-500 dark:text-zinc-400">按优先级从高到低排列</div>
          </div>
          <div class="flex items-center gap-2">
            <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="onToggleTaskCreatePanel">
              创建任务
            </button>
            <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="onRefresh">刷新</button>
            <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="onClose">关闭</button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 mb-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          <button
            class="px-2 py-0.5 rounded border transition-colors"
            :class="taskStateFilterButtonClass('running')"
            @click="toggleJobStateFilter('running')"
          >
            执行中
          </button>
          <button
            class="px-2 py-0.5 rounded border transition-colors"
            :class="taskStateFilterButtonClass('next')"
            @click="toggleJobStateFilter('next')"
          >
            等待执行
          </button>
          <button
            class="px-2 py-0.5 rounded border transition-colors"
            :class="taskStateFilterButtonClass('scheduled')"
            @click="toggleJobStateFilter('scheduled')"
          >
            定时任务
          </button>
          <button
            class="px-2 py-0.5 rounded border transition-colors"
            :class="taskStateFilterButtonClass('completed')"
            @click="toggleJobStateFilter('completed')"
          >
            已完成
          </button>
          <button
            v-if="selectedJobStateFilter"
            class="px-2 py-0.5 rounded border border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
            @click="selectedJobStateFilter = null"
          >
            取消筛选
          </button>
          <div class="ml-auto flex items-center gap-2">
            <label class="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
              <input
                type="checkbox"
                :checked="allTaskJobsSelected"
                @change="onToggleAllTaskJobsSelection($event)"
              />
              <span>全选已完成</span>
            </label>
            <button
              class="text-[11px] px-2 py-1 rounded border border-red-200 text-red-600 dark:border-red-500/40 dark:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="selectedTaskJobsCount === 0"
              @click="onBatchDeleteTaskJobs"
            >
              批量删除 ({{ selectedTaskJobsCount }})
            </button>
          </div>
        </div>

        <div v-if="taskListLoading" class="text-xs text-zinc-500 dark:text-zinc-400 py-8 text-center">正在加载任务列表...</div>
        <div v-else class="space-y-4">
          <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
            <div class="mb-2 flex items-center justify-between gap-2">
              <div class="text-xs font-semibold text-zinc-600 dark:text-zinc-300">任务执行列表（状态排序）</div>
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400">
                共 {{ taskJobs.length }} 条 · 已完成 {{ completedTaskJobs.length }} 条
              </div>
            </div>
            <div v-if="filteredSortedTaskJobs.length === 0" class="text-xs text-zinc-500 dark:text-zinc-400 py-3 text-center">
              {{ selectedJobStateFilter ? '当前筛选下暂无任务记录' : '暂无任务记录' }}
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="job in filteredSortedTaskJobs"
                :key="job.job_id"
                class="rounded-lg border p-3 transition-all"
                :class="getTaskStateClass(getJobVisualState(job))"
              >
                <div class="flex items-start gap-2">
                  <label v-if="isCompletedTaskJob(job)" class="pt-1" title="选择该任务记录">
                    <input
                      type="checkbox"
                      :checked="selectedTaskJobIds.includes(job.job_id)"
                      @change="onTaskJobSelectChange(job.job_id, $event)"
                    />
                  </label>
                  <span v-else class="inline-block w-3.5 mt-1"></span>
                  <div class="flex-1 flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-zinc-800 dark:text-zinc-100">{{ job.title }}</div>
                      <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                        状态: {{ job.effective_status || job.status }} · {{ getTaskStateLabel(getJobVisualState(job)) }} · P{{ job.priority }}
                        <span> · 类型: {{ job.trigger_type }}</span>
                        <span v-if="job.run_status"> · run: {{ job.run_status }}</span>
                        <span> · 创建: {{ formatTs(job.created_at) }}</span>
                        <span> · 共{{ Math.max(1, Number(job.generation_count) || 1) }}代</span>
                      </div>
                      <div v-if="getTaskPayloadTags(job.task_payload).length > 0" class="mt-1 flex flex-wrap gap-1">
                        <span
                          v-for="tag in getTaskPayloadTags(job.task_payload)"
                          :key="`${job.job_id}-${tag}`"
                          class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          {{ tag }}
                        </span>
                      </div>
                    </div>
                    <button
                      v-if="canViewJobDetail(job.effective_status || job.status)"
                      class="text-[11px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 shrink-0 hover:text-indigo-600 hover:border-indigo-200 dark:hover:text-indigo-300"
                      @click="onOpenTaskDetail(job)"
                    >
                      查看任务详情
                    </button>
                    <div class="flex items-center gap-1 shrink-0">
                      <button
                        v-if="isCompletedTaskJob(job)"
                        class="text-[11px] px-2 py-1 rounded border border-indigo-200 text-indigo-600 dark:border-indigo-500/40 dark:text-indigo-300"
                        @click="onReuseTaskTemplate(job)"
                      >
                        使用模板新建
                      </button>
                      <button
                        v-if="canPauseTaskJob(job)"
                        class="text-[11px] px-2 py-1 rounded border border-amber-200 text-amber-700 dark:border-amber-500/40 dark:text-amber-300"
                        @click="onPauseTaskJob(job)"
                      >
                        暂停
                      </button>
                      <button
                        v-if="canResumeTaskJob(job)"
                        class="text-[11px] px-2 py-1 rounded border border-emerald-200 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300"
                        @click="onResumeTaskJob(job)"
                      >
                        恢复
                      </button>
                      <button
                        class="text-[11px] px-2 py-1 rounded border border-zinc-300 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                        @click="onDeleteTaskJob(job)"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-if="taskListItems.length === 0" class="text-xs text-zinc-500 dark:text-zinc-400 py-4 text-center">
            暂无任务模板。可在 AI 配置的“系统自动控制”里维护任务模板。
          </div>
          <div v-else>
            <div class="text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-2">任务模板（优先级）</div>
            <div class="space-y-2">
              <div
                v-for="task in taskListItems"
                :key="task.id"
                class="rounded-lg border p-3 transition-all"
                :class="getTaskStateClass(task.runtime_state)"
              >
                <div class="flex items-start justify-between gap-3 mb-1">
                  <div class="text-sm font-medium text-zinc-800 dark:text-zinc-100">{{ task.title }}</div>
                  <div class="flex items-center gap-2 shrink-0">
                    <span class="text-[11px] px-2 py-0.5 rounded-full border border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">P{{ task.priority }}</span>
                    <span class="text-[11px] px-2 py-0.5 rounded-full border border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{{ getTaskStateLabel(task.runtime_state) }}</span>
                  </div>
                </div>
                <div class="text-xs text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{{ task.instruction || '暂无任务说明' }}</div>
                <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">启用: {{ task.enabled ? '是' : '否' }}</span>
                  <span class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">定时: {{ task.schedule_enabled ? `是 (${task.interval_minutes} 分钟)` : '否' }}</span>
                  <span class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">排队: {{ task.queued_count }}</span>
                  <span class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">运行: {{ task.running_count }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="fade">
    <div v-if="show && taskCreatePanelOpen && target" class="fixed inset-0 z-[89] bg-black/45 flex items-center justify-center p-4" @click="onCloseTaskCreatePanel">
      <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-3xl max-h-[86vh] overflow-y-auto p-5" @click.stop>
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">新建任务</div>
            <div class="text-xs text-zinc-500 dark:text-zinc-400">为 {{ target.name }} 创建任务并立即加入执行队列</div>
          </div>
          <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="onCloseTaskCreatePanel">关闭</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-[11px] text-zinc-500 mb-1">任务名称</label>
            <input
              v-model="taskCreateForm.title"
              class="w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              placeholder="例如：整理今日迭代计划"
            />
            <div class="text-[10px] text-zinc-400 mt-1">入库时会自动追加时间后缀，避免名称重复。</div>
          </div>
          <div>
            <label class="block text-[11px] text-zinc-500 mb-1">优先级</label>
            <input
              v-model.number="taskCreateForm.priority"
              type="number"
              min="1"
              max="10"
              class="w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <div class="md:col-span-2">
            <label class="block text-[11px] text-zinc-500 mb-1">任务具体内容</label>
            <textarea
              v-model="taskCreateForm.instruction"
              rows="4"
              class="w-full px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              placeholder="描述目标、验收标准、约束条件"
            />
          </div>
        </div>

        <div class="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
          <label class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              :checked="taskCreateForm.schedule_enabled"
              @change="onScheduleEnabledChange"
            />
            <span>定时任务</span>
          </label>
          <div v-if="taskCreateForm.schedule_enabled" class="space-y-3">
            <label
              class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2 mb-2"
            >
              <input
                type="checkbox"
                :checked="taskCreateForm.schedule_loop_enabled"
                :disabled="!taskCreateForm.schedule_enabled"
                @change="onScheduleLoopEnabledChange"
              />
              <span>循环运行（每次完成后自动创建下一次定时任务）</span>
            </label>
            <label
              v-if="taskCreateForm.schedule_enabled && taskCreateForm.schedule_loop_enabled"
              class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2 mb-2"
            >
              <input type="checkbox" v-model="taskCreateForm.schedule_run_immediately" />
              <span>首次立即执行</span>
            </label>
            <div class="space-y-3">
              <div>
                <label class="block text-[11px] text-zinc-500 mb-1">定时方式</label>
                <div class="flex flex-wrap items-center gap-3">
                  <label class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="task-schedule-time-mode"
                      value="duration"
                      :checked="taskCreateForm.schedule_time_mode === 'duration'"
                      :disabled="!taskCreateForm.schedule_enabled"
                      @change="onScheduleTimeModeChange"
                    />
                    <span>定时时长</span>
                  </label>
                  <label class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="task-schedule-time-mode"
                      value="datetime"
                      :checked="taskCreateForm.schedule_time_mode === 'datetime'"
                      :disabled="!taskCreateForm.schedule_enabled || taskCreateForm.schedule_loop_enabled"
                      @change="onScheduleTimeModeChange"
                    />
                    <span>定时日期</span>
                  </label>
                </div>
                <div
                  v-if="taskCreateForm.schedule_enabled && taskCreateForm.schedule_loop_enabled"
                  class="text-[10px] text-zinc-400 mt-1"
                >
                  循环运行模式下不支持定时日期，固定使用定时时长。
                </div>
              </div>

              <div v-if="taskCreateForm.schedule_time_mode === 'duration' || taskCreateForm.schedule_loop_enabled">
                <label class="block text-[11px] text-zinc-500 mb-1">定时时长（分钟）</label>
                <input
                  v-model.number="taskCreateForm.schedule_duration_minutes"
                  type="number"
                  min="1"
                  class="w-full md:w-72 px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  :disabled="!taskCreateForm.schedule_enabled"
                />
              </div>

              <div v-else>
                <label class="block text-[11px] text-zinc-500 mb-1">定时日期</label>
                <input
                  v-model="taskCreateForm.schedule_at"
                  type="date"
                  class="w-full md:w-72 px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  :disabled="!taskCreateForm.schedule_enabled"
                  @keydown.prevent
                  @paste.prevent
                  @drop.prevent
                  @beforeinput.prevent
                />
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-1 gap-3">
          <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
            <label class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2 mb-2">
              <input type="checkbox" v-model="taskCreateForm.override_token_limit_enabled" />
              <span>修改默认 Token 范围</span>
            </label>
            <input
              v-if="taskCreateForm.override_token_limit_enabled"
              v-model.number="taskCreateForm.token_limit_override"
              type="number"
              min="1"
              class="w-full md:w-56 px-2 py-1.5 text-xs rounded border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
            <label class="text-xs text-zinc-600 dark:text-zinc-300 flex items-center gap-2 mb-2">
              <input type="checkbox" v-model="taskCreateForm.override_mcp_tools_enabled" />
              <span>修改默认 MCP 使用范围</span>
            </label>
            <div
              v-if="taskCreateForm.override_mcp_tools_enabled"
              class="space-y-2 max-h-44 overflow-y-auto pr-1"
            >
              <details
                v-for="parent in taskMcpToolParentGroups"
                :key="`task-create-mcp-parent-${parent.title}`"
                class="rounded-lg border border-zinc-200 bg-white/70 dark:border-zinc-700 dark:bg-zinc-900/50"
              >
                <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between">
                  <span>{{ parent.title }}</span>
                  <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                    {{ parent.tools.filter(tool => taskCreateForm.mcp_tools_override.includes(tool)).length }} / {{ parent.tools.length }}
                  </span>
                </summary>
                <div class="space-y-2 px-2 pb-2">
                  <div
                    v-if="parent.groups.length === 1"
                    class="grid grid-cols-1 md:grid-cols-2 gap-1.5"
                  >
                    <label
                      v-for="tool in parent.groups[0].tools"
                      :key="`task-create-tool-${tool}`"
                      class="text-[11px] text-zinc-600 dark:text-zinc-300 flex items-start gap-2"
                    >
                      <input
                        type="checkbox"
                        class="mt-0.5"
                        :checked="taskCreateForm.mcp_tools_override.includes(tool)"
                        @change="onTaskCreateToolChange(tool, $event)"
                      />
                      <span class="min-w-0">
                        <span class="block">{{ getMcpToolZhLabel(tool) }}</span>
                        <span class="block font-mono text-[10px] text-zinc-400 dark:text-zinc-500 break-all">{{ tool }}</span>
                      </span>
                    </label>
                  </div>
                  <details
                    v-else
                    v-for="group in parent.groups"
                    :key="`task-create-mcp-${parent.title}-${group.tag}`"
                    class="rounded-lg border border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-950/50"
                  >
                    <summary class="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200 flex items-center justify-between">
                      <span>{{ group.tag }}</span>
                      <span class="text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
                        {{ group.tools.filter(tool => taskCreateForm.mcp_tools_override.includes(tool)).length }} / {{ group.tools.length }}
                      </span>
                    </summary>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-1.5 px-2 pb-2">
                      <label
                        v-for="tool in group.tools"
                        :key="`task-create-tool-${tool}`"
                        class="text-[11px] text-zinc-600 dark:text-zinc-300 flex items-start gap-2"
                      >
                        <input
                          type="checkbox"
                          class="mt-0.5"
                          :checked="taskCreateForm.mcp_tools_override.includes(tool)"
                          @change="onTaskCreateToolChange(tool, $event)"
                        />
                        <span class="min-w-0">
                          <span class="block">{{ getMcpToolZhLabel(tool) }}</span>
                          <span class="block font-mono text-[10px] text-zinc-400 dark:text-zinc-500 break-all">{{ tool }}</span>
                        </span>
                      </label>
                    </div>
                  </details>
                </div>
              </details>
            </div>
          </div>

        </div>

        <div class="mt-4 flex items-center justify-end gap-2">
          <button class="text-xs px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="onCloseTaskCreatePanel">取消</button>
          <button
            class="text-xs px-3 py-1.5 rounded border border-indigo-200 text-indigo-600 bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:bg-indigo-500/10"
            :disabled="taskCreateSubmitting"
            @click="onSubmitTask"
          >
            {{ taskCreateSubmitting ? '创建中...' : '提交任务' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <Transition name="fade">
    <div v-if="show && taskDetailOpen && target && taskDetailJob" class="fixed inset-0 z-[90] bg-black/45 flex items-center justify-center p-4" @click="onCloseTaskDetail">
      <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl w-full max-w-5xl h-[82vh] flex flex-col" @click.stop>
        <div class="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
          <div>
            <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{{ taskDetailJob.title }} 对话详情</div>
            <div class="text-xs text-zinc-500 dark:text-zinc-400">可切换查看第n代，执行中会实时刷新思考内容</div>
          </div>
          <button class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-300" @click="onCloseTaskDetail">关闭</button>
        </div>
        <div class="px-4 py-2 border-b border-zinc-200 dark:border-zinc-700">
          <div class="flex items-center gap-2">
            <span class="text-xs text-zinc-500 dark:text-zinc-400">选择代际:</span>
            <select
              :value="selectedGeneration"
              class="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              @change="onSelectedGenerationChange"
            >
              <option v-for="g in taskGenerations" :key="`g-opt-${g.run_id}-${g.generation}`" :value="g.generation">
                {{ g.label }} · {{ g.status }}
              </option>
            </select>
            <span v-if="selectedGenerationDetail" class="text-[11px] text-zinc-500 dark:text-zinc-400">
              run: {{ selectedGenerationDetail.run_id }}
            </span>
          </div>
        </div>
        <div class="flex-1 min-h-0">
          <div class="p-4 overflow-y-auto min-h-0 h-full">
            <div v-if="taskDetailLoading" class="text-xs text-zinc-500 dark:text-zinc-400">正在加载代际数据...</div>
            <div v-else-if="taskGenerations.length === 0" class="text-xs text-zinc-500 dark:text-zinc-400">暂无可展示的代际记录</div>
            <div v-else-if="!selectedGenerationDetail" class="text-xs text-zinc-500 dark:text-zinc-400">请选择要查看的代际</div>
            <div v-else class="space-y-3">
              <div class="text-xs text-zinc-500 dark:text-zinc-400">
                {{ selectedGenerationDetail.label }} · run: {{ selectedGenerationDetail.run_id }} · {{ formatTs(selectedGenerationDetail.started_at) }}
                <span v-if="selectedGenerationDetail.live.text"> · 实时思考中 ({{ selectedGenerationDetail.live.phase }}){{ selectedGenerationDetail.live.current_tool ? ` · 工具: ${selectedGenerationDetail.live.current_tool}` : '' }}</span>
              </div>
              <ChatConversationView
                :baseMessages="selectedGenerationMessages"
                :sessionActive="true"
                :frontPromptText="selectedGenerationDetail.system_prompt || ''"
                :aiConfigId="props.target?.aiConfigId"
                :liveText="selectedGenerationDetail.live.text || ''"
                :showFrontPrompt="true"
                :showFrontPromptPlaceholder="true"
                :recoverActionStateFromTags="true"
                :appliedEdits="[]"
                :appliedSignatures="[]"
                :actionResults="{}"
                :actionResultsBySignature="{}"
                :isTyping="false"
                :readonly="true"
                @delete="() => {}"
                @recall="() => {}"
                @apply="() => {}"
                @revert="() => {}"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
