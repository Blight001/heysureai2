import { computed, ref, watch, type Ref } from 'vue'
import {
  batchDeleteTaskJobsById,
  deleteTaskJobById,
  fetchTaskGenerationItems,
  fetchTaskListAndJobs,
  pauseTaskJobById,
  resumeTaskJobById,
  triggerTaskForAgent,
} from '@/api/task'
import {
  canPauseTaskJob,
  canResumeTaskJob,
  isCompletedTaskJob,
  syncArrayByKey,
} from '@/utils/taskSystem'
import type {
  AITaskGenerationItem,
  AITaskJobItem,
  AITaskListItem,
  TaskCreateForm,
} from '@/utils/taskSystem'
import { getAuthToken } from '@/api/http'
import type { Agent } from '@/types'

type MessageType = 'info' | 'success' | 'warning' | 'error'
type AlertFn = (options: string | { message: string; type?: MessageType }) => Promise<void>
type ConfirmFn = (options: string | { message: string; type?: MessageType }) => Promise<boolean>

interface UseTaskManagementOptions {
  availableMcpTools: Ref<string[]>
  defaultMcpTools: string[]
  alert: AlertFn
  confirm: ConfirmFn
  onReloadAgents: () => Promise<void>
}

export const useTaskManagement = (options: UseTaskManagementOptions) => {
  const {
    availableMcpTools,
    defaultMcpTools,
    alert,
    confirm,
    onReloadAgents,
  } = options

  const taskListModalOpen = ref(false)
  const taskListTarget = ref<Agent | null>(null)
  const taskListItems = ref<AITaskListItem[]>([])
  const taskJobs = ref<AITaskJobItem[]>([])
  const selectedTaskJobIds = ref<string[]>([])
  const taskListLoading = ref(false)
  const taskCreatePanelOpen = ref(false)
  const taskCreateSubmitting = ref(false)
  const taskDetailOpen = ref(false)
  const taskDetailLoading = ref(false)
  const taskDetailJob = ref<AITaskJobItem | null>(null)
  const taskGenerations = ref<AITaskGenerationItem[]>([])
  const selectedGeneration = ref(1)

  const completedTaskJobs = computed(() => {
    return taskJobs.value.filter(isCompletedTaskJob)
  })

  const fetchAgentTaskList = async (agent: Agent, opts?: { silent?: boolean }) => {
    if (!agent.aiConfigId) return
    const token = getAuthToken()
    if (!token) return
    const silent = !!opts?.silent
    if (!silent) taskListLoading.value = true
    try {
      const { tasks, jobs } = await fetchTaskListAndJobs(agent.aiConfigId, token)
      syncArrayByKey(taskListItems.value, tasks, item => String((item as AITaskListItem).id))
      syncArrayByKey(taskJobs.value, jobs, item => String((item as AITaskJobItem).job_id))
    } catch (err: any) {
      if (!silent) {
        void alert({ message: err?.message || '任务列表加载失败', type: 'error' })
      }
    } finally {
      if (!silent) taskListLoading.value = false
    }
  }

  const fetchTaskGenerations = async (agent: Agent, jobId: string, opts?: { silent?: boolean }) => {
    if (!agent.aiConfigId) return
    const token = getAuthToken()
    if (!token) return
    const silent = !!opts?.silent
    if (!silent) taskDetailLoading.value = true
    try {
      const previousSelected = selectedGeneration.value
      const generations = await fetchTaskGenerationItems(agent.aiConfigId, jobId, token)
      syncArrayByKey(taskGenerations.value, generations, item => String((item as AITaskGenerationItem).run_id))
      if (taskGenerations.value.length > 0) {
        const hasPrev = taskGenerations.value.some(item => item.generation === previousSelected)
        selectedGeneration.value = hasPrev
          ? previousSelected
          : taskGenerations.value[taskGenerations.value.length - 1].generation
      } else {
        selectedGeneration.value = 1
      }
    } catch (err: any) {
      if (!silent) {
        void alert({ message: err?.message || '任务代际详情加载失败', type: 'error' })
      }
    } finally {
      if (!silent) taskDetailLoading.value = false
    }
  }

  const openAgentTaskList = async (agent: Agent) => {
    if (!agent.aiConfigId) return
    taskListTarget.value = agent
    taskCreatePanelOpen.value = false
    selectedTaskJobIds.value = []
    taskListModalOpen.value = true
    await fetchAgentTaskList(agent)
  }

  const closeAgentTaskList = () => {
    taskListModalOpen.value = false
    taskCreatePanelOpen.value = false
    taskCreateSubmitting.value = false
    selectedTaskJobIds.value = []
    taskDetailOpen.value = false
    taskDetailJob.value = null
    taskGenerations.value = []
  }

  const openTaskDetail = async (job: AITaskJobItem) => {
    if (!taskListTarget.value) return
    taskDetailJob.value = job
    taskDetailOpen.value = true
    await fetchTaskGenerations(taskListTarget.value, job.job_id)
  }

  const closeTaskDetail = () => {
    taskDetailOpen.value = false
    taskDetailJob.value = null
    taskGenerations.value = []
  }

  const parseAgentMcpTools = (agent?: Agent | null) => {
    try {
      const parsed = JSON.parse(agent?.mcpTools || '[]')
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item || '').trim()).filter(Boolean)
      }
    } catch {
      // ignore parse issue and fallback
    }
    return [...(availableMcpTools.value.length ? availableMcpTools.value : defaultMcpTools)]
  }

  const buildTaskCreateForm = (agent?: Agent | null): TaskCreateForm => ({
    title: '',
    instruction: '',
    priority: 5,
    schedule_enabled: false,
    schedule_loop_enabled: false,
    schedule_run_immediately: false,
    schedule_time_mode: 'duration',
    schedule_duration_minutes: 30,
    schedule_at: '',
    override_token_limit_enabled: false,
    token_limit_override: Math.max(1, Number(agent?.tokenLimit) || 10000),
    override_mcp_tools_enabled: false,
    mcp_tools_override: parseAgentMcpTools(agent),
  })

  const formatDateLocal = (unixSeconds?: number) => {
    const ts = Number(unixSeconds || 0)
    if (!Number.isFinite(ts) || ts <= 0) return ''
    const d = new Date(ts * 1000)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  const buildTaskCreateFormFromJob = (agent?: Agent | null, job?: AITaskJobItem | null): TaskCreateForm => {
    const base = buildTaskCreateForm(agent)
    if (!job) return base

    const payload = job.task_payload && typeof job.task_payload === 'object'
      ? job.task_payload
      : {}
    const schedule = payload.schedule && typeof payload.schedule === 'object'
      ? payload.schedule
      : {}
    const overrideToken = payload.override_token_limit && typeof payload.override_token_limit === 'object'
      ? payload.override_token_limit
      : {}
    const overrideMcp = payload.override_mcp_tools && typeof payload.override_mcp_tools === 'object'
      ? payload.override_mcp_tools
      : {}

    const overrideMcpTools = Array.isArray(overrideMcp.tools)
      ? overrideMcp.tools.map((item: any) => String(item || '').trim()).filter(Boolean)
      : []

    const loopEnabled = !!schedule.loop_enabled
    let parsedScheduleAt = Number(schedule.schedule_at)
    if (!Number.isFinite(parsedScheduleAt) && typeof schedule.schedule_at === 'string') {
      const parsedMs = Date.parse(schedule.schedule_at)
      if (Number.isFinite(parsedMs) && parsedMs > 0) {
        parsedScheduleAt = Math.floor(parsedMs / 1000)
      }
    }
    const hasScheduleAt = Number.isFinite(parsedScheduleAt) && parsedScheduleAt > 0
    const scheduleTimeMode: TaskCreateForm['schedule_time_mode'] = (!loopEnabled && hasScheduleAt) ? 'datetime' : 'duration'
    return {
      ...base,
      title: String(job.title || ''),
      instruction: String(job.instruction || ''),
      priority: Math.max(1, Math.min(10, Number(job.priority) || 5)),
      schedule_enabled: !!schedule.enabled,
      schedule_loop_enabled: loopEnabled,
      schedule_run_immediately: !!schedule.run_immediately,
      schedule_time_mode: scheduleTimeMode,
      schedule_duration_minutes: Math.max(1, Number(schedule.duration_minutes) || 30),
      schedule_at: scheduleTimeMode === 'datetime' ? formatDateLocal(parsedScheduleAt) : '',
      override_token_limit_enabled: !!overrideToken.enabled,
      token_limit_override: Math.max(1, Number(overrideToken.value) || base.token_limit_override),
      override_mcp_tools_enabled: !!overrideMcp.enabled,
      mcp_tools_override: overrideMcpTools.length > 0 ? overrideMcpTools : base.mcp_tools_override,
    }
  }

  const taskCreateForm = ref<TaskCreateForm>(buildTaskCreateForm())

  const openTaskCreatePanel = (agent?: Agent | null) => {
    if (!agent?.aiConfigId) return
    taskCreateForm.value = buildTaskCreateForm(agent)
    taskCreatePanelOpen.value = true
  }

  const openTaskCreatePanelFromJob = (agent?: Agent | null, job?: AITaskJobItem | null) => {
    if (!agent?.aiConfigId || !job?.job_id) return
    taskCreateForm.value = buildTaskCreateFormFromJob(agent, job)
    taskCreatePanelOpen.value = true
  }

  const toggleTaskCreatePanel = (agent?: Agent | null) => {
    if (taskCreatePanelOpen.value) {
      closeTaskCreatePanel()
      return
    }
    openTaskCreatePanel(agent)
  }

  const closeTaskCreatePanel = () => {
    taskCreatePanelOpen.value = false
    taskCreateSubmitting.value = false
  }

  const toggleTaskCreateTool = (tool: string, checked: boolean) => {
    const next = new Set(taskCreateForm.value.mcp_tools_override)
    if (checked) next.add(tool)
    else next.delete(tool)
    taskCreateForm.value.mcp_tools_override = Array.from(next)
  }

  const onTaskCreateToolChange = (tool: string, event: Event) => {
    const target = event.target as HTMLInputElement | null
    toggleTaskCreateTool(tool, !!target?.checked)
  }

  const submitTaskForAgent = async (agent?: Agent | null) => {
    if (!agent?.aiConfigId || taskCreateSubmitting.value) return
    const title = taskCreateForm.value.title.trim()
    if (!title) {
      void alert({ message: '请填写任务名称', type: 'warning' })
      return
    }
    if (taskCreateForm.value.override_mcp_tools_enabled && taskCreateForm.value.mcp_tools_override.length === 0) {
      void alert({ message: '已启用 MCP 范围覆盖时，请至少选择一个工具', type: 'warning' })
      return
    }
    const token = getAuthToken()
    if (!token) return
    const defaultTools = parseAgentMcpTools(agent)
    const selectedTools = [...taskCreateForm.value.mcp_tools_override].map(v => String(v || '').trim()).filter(Boolean)
    const sameToolCount = selectedTools.length === defaultTools.length
    const sameTools = sameToolCount && selectedTools.every(tool => defaultTools.includes(tool))
    const autoEnableMcpOverride = !sameTools
    const autoEnableTokenOverride = Number(taskCreateForm.value.token_limit_override) !== Math.max(1, Number(agent.tokenLimit) || 10000)
    const useScheduleDatetime = !!taskCreateForm.value.schedule_enabled
      && !taskCreateForm.value.schedule_loop_enabled
      && taskCreateForm.value.schedule_time_mode === 'datetime'
    if (useScheduleDatetime && !taskCreateForm.value.schedule_at) {
      void alert({ message: '请选择定时日期', type: 'warning' })
      return
    }
    let normalizedScheduleAt: number | string | null = null
    if (useScheduleDatetime && taskCreateForm.value.schedule_at) {
      const parsedMs = Date.parse(taskCreateForm.value.schedule_at)
      normalizedScheduleAt = Number.isFinite(parsedMs) && parsedMs > 0
        ? Math.floor(parsedMs / 1000)
        : taskCreateForm.value.schedule_at
    }
    taskCreateSubmitting.value = true
    try {
      const data = await triggerTaskForAgent(agent.aiConfigId, {
        title,
        instruction: taskCreateForm.value.instruction.trim(),
        priority: Math.max(1, Math.min(10, Number(taskCreateForm.value.priority) || 5)),
        schedule_enabled: !!taskCreateForm.value.schedule_enabled,
        schedule_loop_enabled: !!taskCreateForm.value.schedule_enabled && !!taskCreateForm.value.schedule_loop_enabled,
        schedule_run_immediately: !!taskCreateForm.value.schedule_enabled && !!taskCreateForm.value.schedule_loop_enabled && !!taskCreateForm.value.schedule_run_immediately,
        schedule_duration_minutes: Math.max(1, Number(taskCreateForm.value.schedule_duration_minutes) || 30),
        schedule_at: normalizedScheduleAt,
        override_token_limit_enabled: !!taskCreateForm.value.override_token_limit_enabled || autoEnableTokenOverride,
        token_limit_override: Math.max(1, Number(taskCreateForm.value.token_limit_override) || 10000),
        override_mcp_tools_enabled: !!taskCreateForm.value.override_mcp_tools_enabled || autoEnableMcpOverride,
        mcp_tools_override: selectedTools,
      }, token)
      void alert({ message: `任务「${data.title || title}」已创建并入队`, type: 'success' })
      closeTaskCreatePanel()
      await fetchAgentTaskList(agent)
      await onReloadAgents()
    } catch (err: any) {
      void alert({ message: err?.message || '创建任务失败', type: 'error' })
    } finally {
      taskCreateSubmitting.value = false
    }
  }

  const pauseTaskJob = async (agent: Agent, job: AITaskJobItem) => {
    if (!agent.aiConfigId || !job.job_id || !canPauseTaskJob(job)) return
    const token = getAuthToken()
    if (!token) return
    try {
      await pauseTaskJobById(agent.aiConfigId, job.job_id, token)
    } catch (err: any) {
      void alert({ message: err?.message || '暂停任务失败', type: 'error' })
      return
    }
    void alert({ message: `任务「${job.title}」已暂停`, type: 'success' })
    await fetchAgentTaskList(agent, { silent: true })
  }

  const resumeTaskJob = async (agent: Agent, job: AITaskJobItem) => {
    if (!agent.aiConfigId || !job.job_id || !canResumeTaskJob(job)) return
    const token = getAuthToken()
    if (!token) return
    try {
      await resumeTaskJobById(agent.aiConfigId, job.job_id, token)
    } catch (err: any) {
      void alert({ message: err?.message || '开始任务失败', type: 'error' })
      return
    }
    void alert({ message: `任务「${job.title}」已进入执行队列`, type: 'success' })
    await fetchAgentTaskList(agent, { silent: true })
  }

  const deleteTaskJob = async (agent: Agent, job: AITaskJobItem) => {
    if (!agent.aiConfigId || !job.job_id) return
    const ok = await confirm({ message: `确认删除任务「${job.title}」？将强制停止当前思考并删除该任务对话记录。`, type: 'warning' })
    if (!ok) return
    const token = getAuthToken()
    if (!token) return
    try {
      await deleteTaskJobById(agent.aiConfigId, job.job_id, token)
    } catch (err: any) {
      void alert({ message: err?.message || '删除任务失败', type: 'error' })
      return
    }
    void alert({ message: `任务「${job.title}」已删除`, type: 'success' })
    await fetchAgentTaskList(agent, { silent: true })
    await onReloadAgents()
    if (taskDetailOpen.value && taskDetailJob.value?.job_id === job.job_id) {
      closeTaskDetail()
    }
  }

  const toggleTaskJobSelection = (jobId: string, checked: boolean) => {
    const next = new Set(selectedTaskJobIds.value)
    if (checked) next.add(jobId)
    else next.delete(jobId)
    selectedTaskJobIds.value = Array.from(next)
  }

  const toggleAllTaskJobsSelection = (checked: boolean) => {
    if (!checked) {
      selectedTaskJobIds.value = []
      return
    }
    selectedTaskJobIds.value = completedTaskJobs.value.map(job => job.job_id)
  }

  const onTaskJobSelectChange = (jobId: string, event: Event) => {
    const target = event.target as HTMLInputElement | null
    toggleTaskJobSelection(jobId, !!target?.checked)
  }

  const onSelectAllTaskJobsChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null
    toggleAllTaskJobsSelection(!!target?.checked)
  }

  const batchDeleteTaskJobs = async (agent?: Agent | null) => {
    if (!agent?.aiConfigId) return
    const selectedIds = [...selectedTaskJobIds.value]
    if (selectedIds.length === 0) {
      void alert({ message: '请先选择要删除的执行记录', type: 'warning' })
      return
    }
    const ok = await confirm({
      message: `确认批量删除 ${selectedIds.length} 条任务执行记录？将强制停止当前思考并删除相关对话记录。`,
      type: 'warning'
    })
    if (!ok) return
    const token = getAuthToken()
    if (!token) return

    const { successCount, failCount } = await batchDeleteTaskJobsById(agent.aiConfigId, selectedIds, token)
    for (const jobId of selectedIds) {
      if (taskDetailOpen.value && taskDetailJob.value?.job_id === jobId) closeTaskDetail()
    }

    selectedTaskJobIds.value = []
    await fetchAgentTaskList(agent, { silent: true })
    await onReloadAgents()
    if (failCount === 0) {
      void alert({ message: `已批量删除 ${successCount} 条任务执行记录`, type: 'success' })
    } else {
      void alert({ message: `批量删除完成：成功 ${successCount} 条，失败 ${failCount} 条`, type: 'warning' })
    }
  }

  const refreshOpenTaskPanel = async () => {
    if (!taskListModalOpen.value || !taskListTarget.value) return
    await fetchAgentTaskList(taskListTarget.value, { silent: true })
    if (taskDetailOpen.value && taskDetailJob.value) {
      await fetchTaskGenerations(taskListTarget.value, taskDetailJob.value.job_id, { silent: true })
    }
  }

  watch(taskJobs, (rows) => {
    const validIds = new Set(rows.filter(isCompletedTaskJob).map(row => row.job_id))
    selectedTaskJobIds.value = selectedTaskJobIds.value.filter(id => validIds.has(id))
  }, { deep: true })

  return {
    taskListModalOpen,
    taskListTarget,
    taskListItems,
    taskJobs,
    selectedTaskJobIds,
    taskListLoading,
    taskCreatePanelOpen,
    taskCreateSubmitting,
    taskDetailOpen,
    taskDetailLoading,
    taskDetailJob,
    taskGenerations,
    selectedGeneration,
    taskCreateForm,
    fetchAgentTaskList,
    fetchTaskGenerations,
    openAgentTaskList,
    closeAgentTaskList,
    openTaskDetail,
    closeTaskDetail,
    toggleTaskCreatePanel,
    openTaskCreatePanelFromJob,
    closeTaskCreatePanel,
    onTaskCreateToolChange,
    submitTaskForAgent,
    pauseTaskJob,
    resumeTaskJob,
    deleteTaskJob,
    onTaskJobSelectChange,
    onSelectAllTaskJobsChange,
    batchDeleteTaskJobs,
    refreshOpenTaskPanel,
  }
}

