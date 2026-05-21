export type TaskRuntimeState = 'running' | 'next' | 'scheduled' | 'completed' | 'idle'

export interface AITaskListItem {
  id: string
  title: string
  instruction: string
  priority: number
  enabled: boolean
  schedule_enabled: boolean
  interval_minutes: number
  runtime_state: TaskRuntimeState
  queued_count: number
  running_count: number
}

export interface AITaskJobItem {
  job_id: string
  title: string
  instruction: string
  task_payload?: Record<string, any>
  priority: number
  status: string
  effective_status?: string
  run_status?: string
  trigger_type: string
  last_run_id?: string
  session_id?: string
  created_at?: number
  started_at?: number
  finished_at?: number
  generation_count: number
  latest_generation: number
}

export interface AITaskGenerationMessage {
  id?: number
  role: string
  content: string
  tags?: string
  system_prompt?: string
  created_at?: number
}

export interface AITaskGenerationItem {
  generation: number
  label: string
  run_id: string
  session_id: string
  status: string
  started_at?: number
  finished_at?: number
  system_prompt?: string
  messages: AITaskGenerationMessage[]
  live: {
    text: string
    phase: string
    current_tool: string
    updated_at?: number
  }
}

export interface TaskCreateForm {
  title: string
  instruction: string
  priority: number
  schedule_enabled: boolean
  schedule_loop_enabled: boolean
  schedule_run_immediately: boolean
  schedule_time_mode: 'duration' | 'datetime'
  schedule_duration_minutes: number
  schedule_at: string
  override_token_limit_enabled: boolean
  token_limit_override: number
  override_mcp_tools_enabled: boolean
  mcp_tools_override: string[]
  override_workspace_root_enabled: boolean
  workspace_root_override: string
}

export interface SystemAutoControlDefaults {
  start_task_prompt: string
  resume_task_prompt: string
  supervision_prompt: string
  inheritance_notice: string
}

export interface SystemAutoControlTaskItem {
  id: string
  title: string
  instruction: string
  priority: number
  enabled: boolean
  schedule_enabled: boolean
  interval_minutes: number
}

export interface SystemAutoControlConfig {
  enabled: boolean
  start_task_prompt: string
  resume_task_prompt: string
  supervision_prompt: string
  inheritance_notice: string
  tasks: SystemAutoControlTaskItem[]
}

export const taskStateClassMap: Record<TaskRuntimeState, string> = {
  running: 'border-emerald-400 bg-emerald-50/70 dark:border-emerald-400/70 dark:bg-emerald-500/10 task-running-border',
  next: 'border-amber-300 bg-amber-50/70 dark:border-amber-400/70 dark:bg-amber-500/10',
  scheduled: 'border-blue-300 bg-blue-50/70 dark:border-blue-400/70 dark:bg-blue-500/10',
  completed: 'border-zinc-300 bg-zinc-100/80 dark:border-zinc-600 dark:bg-zinc-800/70',
  idle: 'border-zinc-200 bg-white/70 dark:border-zinc-700 dark:bg-zinc-900/50',
}

export const taskStateLabelMap: Record<TaskRuntimeState, string> = {
  running: '执行中',
  next: '等待执行',
  scheduled: '定时任务',
  completed: '已完成',
  idle: '待命',
}

export const syncArrayByKey = <T>(target: T[], incoming: T[], getKey: (item: T) => string) => {
  const currentMap = new Map(target.map(item => [getKey(item), item]))
  const next: T[] = []
  for (const item of incoming) {
    const key = getKey(item)
    const existing = currentMap.get(key)
    if (existing) {
      Object.assign(existing as any, item)
      next.push(existing)
    } else {
      next.push(item)
    }
  }
  target.splice(0, target.length, ...next)
}

export const normalizeTaskItem = (raw: any): SystemAutoControlTaskItem => ({
  id: String(raw?.id || `task_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`),
  title: String(raw?.title || '未命名任务'),
  instruction: String(raw?.instruction || ''),
  priority: Math.max(1, Math.min(10, Number(raw?.priority) || 5)),
  enabled: raw?.enabled === undefined ? true : !!raw.enabled,
  schedule_enabled: !!raw?.schedule_enabled,
  interval_minutes: Math.max(1, Number(raw?.interval_minutes) || 30),
})

export const defaultSystemAutoControl = (defaults: SystemAutoControlDefaults): SystemAutoControlConfig => ({
  enabled: false,
  start_task_prompt: defaults.start_task_prompt,
  resume_task_prompt: defaults.resume_task_prompt,
  supervision_prompt: defaults.supervision_prompt,
  inheritance_notice: defaults.inheritance_notice,
  tasks: [],
})

export const normalizeSystemAutoControl = (raw: unknown, defaults: SystemAutoControlDefaults): SystemAutoControlConfig => {
  const base = defaultSystemAutoControl(defaults)
  const src = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const tasks = Array.isArray(src.tasks) ? src.tasks.map(normalizeTaskItem) : []
  return {
    enabled: !!src.enabled,
    start_task_prompt: String(src.start_task_prompt || base.start_task_prompt),
    resume_task_prompt: String(src.resume_task_prompt || base.resume_task_prompt),
    supervision_prompt: String(src.supervision_prompt || base.supervision_prompt),
    inheritance_notice: String(src.inheritance_notice || base.inheritance_notice),
    tasks,
  }
}

export const isCompletedTaskJob = (job: Pick<AITaskJobItem, 'status' | 'effective_status'>) => {
  const st = String(job.effective_status || job.status || '').toLowerCase()
  return ['completed', 'done', 'finished'].includes(st)
}

export const canPauseTaskJob = (job: Pick<AITaskJobItem, 'status' | 'effective_status'>) => {
  const st = String(job.effective_status || job.status || '').toLowerCase()
  return st === 'running' || st === 'queued'
}

export const canResumeTaskJob = (job: Pick<AITaskJobItem, 'status' | 'effective_status'>) => {
  const st = String(job.effective_status || job.status || '').toLowerCase()
  return st === 'paused'
}

export const getTaskJobRuntimeState = (job: AITaskJobItem): TaskRuntimeState => {
  const st = String(job.effective_status || job.status || '').toLowerCase()
  if (st === 'running') return 'running'
  if (st === 'queued' || st === 'paused') return 'next'
  if (st === 'completed') return 'completed'
  const payload = (job.task_payload && typeof job.task_payload === 'object') ? job.task_payload : {}
  const schedule = (payload as any).schedule
  if (schedule && typeof schedule === 'object' && schedule.enabled) return 'scheduled'
  return 'idle'
}

export const getTaskStateClass = (state?: string) => {
  const normalized = String(state || 'idle').toLowerCase()
  let key: TaskRuntimeState = 'idle'
  if (normalized === 'running') key = 'running'
  else if (['next', 'queued', 'waiting', 'paused'].includes(normalized)) key = 'next'
  else if (['scheduled', 'schedule'].includes(normalized)) key = 'scheduled'
  else if (['completed', 'done', 'finished'].includes(normalized)) key = 'completed'
  return taskStateClassMap[key] || taskStateClassMap.idle
}

export const getTaskStateLabel = (state?: string) => {
  const normalized = String(state || 'idle').toLowerCase()
  let key: TaskRuntimeState = 'idle'
  if (normalized === 'running') key = 'running'
  else if (['next', 'queued', 'waiting', 'paused'].includes(normalized)) key = 'next'
  else if (['scheduled', 'schedule'].includes(normalized)) key = 'scheduled'
  else if (['completed', 'done', 'finished'].includes(normalized)) key = 'completed'
  return taskStateLabelMap[key] || taskStateLabelMap.idle
}

const formatTs = (value?: number) => {
  if (!value) return '--'
  const d = new Date(value * 1000)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleString()
}

export const getTaskPayloadTags = (payload?: Record<string, any>) => {
  const src = payload && typeof payload === 'object' ? payload : {}
  const out: string[] = []
  const schedule = src.schedule || {}
  if (schedule.enabled) {
    const duration = Number(schedule.duration_minutes) || 0
    const at = Number(schedule.schedule_at) || 0
    if (duration > 0) out.push(`定时时长: ${duration}分钟`)
    if (at > 0) out.push(`定时日期: ${formatTs(at)}`)
    if (schedule.loop_enabled) out.push('循环运行: 开启')
    if (schedule.loop_enabled && schedule.run_immediately) out.push('首次执行: 立即')
  }
  const token = src.override_token_limit || {}
  if (token.enabled) out.push(`Token覆盖: ${Number(token.value) || 0}`)
  const mcp = src.override_mcp_tools || {}
  if (mcp.enabled) out.push(`MCP覆盖: ${Array.isArray(mcp.tools) ? mcp.tools.length : 0}项`)
  const workspace = src.override_workspace_root || {}
  if (workspace.enabled) out.push(`目录限制: ${String(workspace.value || '.')}`)
  return out
}
