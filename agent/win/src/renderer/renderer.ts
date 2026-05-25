// renderer.ts — HeySure Agent renderer process

interface Window {
  heysureAPI: {
    getSettings: () => Promise<any>
    saveSettings: (s: any) => Promise<any>
    connect: () => Promise<void>
    disconnect: () => Promise<void>
    getStatus: () => Promise<string>
    onStatusChange: (cb: (status: string, reason?: string) => void) => void
    onActivityLog: (cb: (entry: any) => void) => void
    onTaskStart: (cb: (data: any) => void) => void
    onTaskResult: (cb: (data: any) => void) => void
    setTheme: (theme: 'dark' | 'light') => Promise<void>
    testConnection: () => Promise<{ success: boolean; status?: number; ms?: number; error?: string }>
    sendChat: (content: string) => Promise<{ text: string; sessionId?: string }>
    getChatHistory: () => Promise<Array<{ id?: number; role: string; content: string; think?: string | null }>>
    login: (params: { serverUrl: string; account: string; password: string }) => Promise<{ success: boolean; user: any }>
    logout: () => Promise<{ success: boolean }>
    listAiConfigs: () => Promise<any[]>
    getAiRuntimeStatus: () => Promise<any[]>
    selectAiConfig: (cfg: any) => Promise<{ success: boolean }>
    cloneAiConfig: (configId: number) => Promise<any>
    listTasks: () => Promise<{ tasks: TaskTemplate[]; jobs: TaskJob[] }>
    getTaskGenerations: (jobId: string) => Promise<TaskGeneration[]>
    triggerTask: (payload: TriggerTaskPayload) => Promise<any>
    pauseTask: (jobId: string) => Promise<{ success: boolean }>
    resumeTask: (jobId: string) => Promise<{ success: boolean }>
    deleteTask: (jobId: string) => Promise<{ success: boolean }>
    listWorkspaceFiles: () => Promise<string[]>
    version: string
  }
}

type TaskRuntimeState = 'running' | 'next' | 'scheduled' | 'completed' | 'idle'
interface TaskTemplate {
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
interface TaskJob {
  job_id: string
  title: string
  instruction: string
  task_payload?: Record<string, any>
  priority: number
  status: string
  effective_status?: string
  run_status?: string
  trigger_type: string
  created_at?: number
  started_at?: number
  finished_at?: number
  generation_count: number
  latest_generation: number
  task_token_used?: number
  task_token_limit?: number
  latest_thinking?: string
  live_phase?: string
  live_tool?: string
  live_updated_at?: number
}
interface TaskGeneration {
  generation: number
  label: string
  run_id: string
  session_id: string
  status: string
  started_at?: number
  finished_at?: number
  system_prompt?: string
  live?: { text?: string; phase?: string; current_tool?: string; updated_at?: number }
  messages?: Array<{ role: string; content: string; created_at?: number; tags?: string }>
}
interface TriggerTaskPayload {
  title: string
  instruction: string
  priority: number
  schedule_enabled: boolean
  schedule_loop_enabled: boolean
  schedule_run_immediately: boolean
  schedule_duration_minutes: number
  schedule_at: number | string | null
  override_token_limit_enabled: boolean
  token_limit_override: number
  override_mcp_tools_enabled: boolean
  mcp_tools_override: string[]
  override_workspace_root_enabled: boolean
  workspace_root_override: string
}

// ── State ──────────────────────────────────────────────────────────────────
type AppScreen = 'login' | 'ai-select' | 'main'
let currentTheme: 'dark' | 'light' = 'dark'
let totalTasks = 0, successTasks = 0, failedTasks = 0, runningTasks = 0
let chatHistory: Array<{ role: string; content: string; serverId?: number }> = []
let chatBusy = false
let activeTab: 'chat' | 'tasks' = 'tasks'
let sidebarOpen = false
let taskTemplates: TaskTemplate[] = []
let taskJobs: TaskJob[] = []
let taskLoading = false
let selectedTaskFilter: TaskRuntimeState | 'all' = 'all'
let selectedTaskJobIds: string[] = []
let currentDetailJobId = ''
let currentDetailGenerations: TaskGeneration[] = []
let selectedDetailGeneration = 0
let taskCreateOpen = false
let taskCreateSubmitting = false
let availableWorkspaceDirs: string[] = ['.']
let taskCreateSourceJobId = ''
let taskLiveRefreshTimer = 0
let taskThinkingRafs: number[] = []
let currentConnectionStatus = 'disconnected'
let currentAiDisplayName = ''
let selectedAiConfigId: number | null = null

// ── Screen navigation ──────────────────────────────────────────────────────
function showScreen(screen: AppScreen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
  document.getElementById(`screen-${screen}`)?.classList.add('active')
}

// ── DOM refs (main screen) ─────────────────────────────────────────────────
const feed            = document.getElementById('feed')!
const feedEmpty       = document.getElementById('feed-empty')!
const bodyEl          = document.getElementById('body')!
const chatPane        = document.getElementById('chat-pane')!
const tasksPane       = document.getElementById('tasks-pane')!
const chatMessages    = document.getElementById('chat-messages')!
const chatNoKey       = document.getElementById('chat-no-key')!
const chatInput       = document.getElementById('chat-input') as HTMLTextAreaElement
const chatSendBtn     = document.getElementById('chat-send') as HTMLButtonElement
const tabChat         = document.getElementById('tab-chat')!
const tabTasks        = document.getElementById('tab-tasks')!
const taskList        = document.getElementById('task-list')!
const taskEmpty       = document.getElementById('task-empty')!
const taskRefreshBtn  = document.getElementById('task-refresh-btn') as HTMLButtonElement
const taskCreateBtn   = document.getElementById('task-create-btn') as HTMLButtonElement
const taskBatchDeleteBtn = document.getElementById('task-batch-delete-btn') as HTMLButtonElement
const taskFilterBar   = document.getElementById('task-filter-bar')!
const taskCreatePanel = document.getElementById('task-create-panel')!
const taskCreateCard  = document.getElementById('task-create-card')!
const taskCreateClose = document.getElementById('task-create-close') as HTMLButtonElement
const taskDetailModal = document.getElementById('task-detail-modal')!
const taskDetailCard  = document.getElementById('task-detail-card')!
const taskDetailContent = document.getElementById('task-detail-content')!
const taskDetailTitle = document.getElementById('task-detail-title')!
const taskDetailSubtitle = document.getElementById('task-detail-subtitle')!
const taskDetailClose = document.getElementById('task-detail-close') as HTMLButtonElement
const taskFormTitle   = document.getElementById('task-form-title') as HTMLInputElement
const taskFormPriority = document.getElementById('task-form-priority') as HTMLInputElement
const taskFormInstruction = document.getElementById('task-form-instruction') as HTMLTextAreaElement
const taskFormSchedule = document.getElementById('task-form-schedule') as HTMLInputElement
const taskFormLoop    = document.getElementById('task-form-loop') as HTMLInputElement
const taskFormRunNow  = document.getElementById('task-form-run-now') as HTMLInputElement
const taskFormDuration = document.getElementById('task-form-duration') as HTMLInputElement
const taskFormDate    = document.getElementById('task-form-date') as HTMLInputElement
const taskFormTokenEnabled = document.getElementById('task-form-token-enabled') as HTMLInputElement
const taskFormToken   = document.getElementById('task-form-token') as HTMLInputElement
const taskFormMcpEnabled = document.getElementById('task-form-mcp-enabled') as HTMLInputElement
const taskFormMcp     = document.getElementById('task-form-mcp') as HTMLInputElement
const taskFormWorkspaceEnabled = document.getElementById('task-form-workspace-enabled') as HTMLInputElement
const taskFormWorkspace = document.getElementById('task-form-workspace') as HTMLSelectElement
const taskSubmitBtn   = document.getElementById('task-submit-btn') as HTMLButtonElement
const taskCancelBtn   = document.getElementById('task-cancel-btn') as HTMLButtonElement
const taskFormStatus  = document.getElementById('task-form-status')!
const taskSummary     = document.getElementById('task-summary')!
const statusDot       = document.getElementById('status-dot')!
const statusLabel     = document.getElementById('status-label')!
const statusPill      = document.getElementById('status-pill')!
const infoStatus      = document.getElementById('info-status')!
const infoServer      = document.getElementById('info-server')!
const infoWorkspace   = document.getElementById('info-workspace')!
const statTasks       = document.getElementById('stat-tasks')!
const statSuccess     = document.getElementById('stat-success')!
const statFailed      = document.getElementById('stat-failed')!
const statRunning     = document.getElementById('stat-running')!
const cfgServer       = document.getElementById('cfg-server') as HTMLInputElement
const cfgWorkspace    = document.getElementById('cfg-workspace') as HTMLInputElement
const saveBtn         = document.getElementById('save-btn')!
const saveFeedback    = document.getElementById('save-feedback')!
const connectBtn      = document.getElementById('connect-btn')!
const disconnectBtn   = document.getElementById('disconnect-btn')!
const clearBtn        = document.getElementById('clear-btn')!
const settingsToggle  = document.getElementById('settings-toggle')!
const themeToggle     = document.getElementById('theme-toggle')!
const testConnBtn     = document.getElementById('test-conn-btn')!
const testResult      = document.getElementById('test-result')!
const aiInfoName      = document.getElementById('ai-info-name')!
const aiInfoRole      = document.getElementById('ai-info-role')!
const aiInfoLifecycle = document.getElementById('ai-info-lifecycle')!
const aiInfoProject   = document.getElementById('ai-info-project')!
const headerUserChip  = document.getElementById('header-user-chip')!
const headerUserAva   = document.getElementById('header-user-ava')!
const headerUserName  = document.getElementById('header-user-name')!
const aiSelectTarget  = document.getElementById('ai-select-target')!
const aiSelectTargetText = document.getElementById('ai-select-target-text')!

const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接', connecting: '连接中...', connected: '已连接', registered: '已注册', error: '连接错误',
}
const DESKTOP_AGENT_MCP_TOOLS = new Set([
  'fs.list', 'fs.read', 'fs.write',
  'shell.run', 'git.diff',
  'keyboard.type', 'keyboard.press',
  'mouse.move', 'mouse.click', 'mouse.double_click', 'mouse.right_click', 'mouse.scroll', 'mouse.drag',
  'screen.capture', 'screen.capture_region', 'screen.info',
  'clipboard.get', 'clipboard.set',
  'window.list', 'window.focus', 'window.close',
  'process.list', 'process.kill',
])

// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme(theme: 'dark' | 'light', persist = true) {
  currentTheme = theme
  document.body.className = theme
  const icon = theme === 'dark' ? '&#x2600;&#xFE0F;' : '&#x1F319;'
  ;[document.getElementById('theme-toggle'), document.getElementById('theme-toggle2')].forEach(el => { if (el) el.innerHTML = icon })
  if (persist) window.heysureAPI.setTheme(theme)
}
;[document.getElementById('theme-toggle'), document.getElementById('theme-toggle2')].forEach(btn =>
  btn?.addEventListener('click', () => applyTheme(currentTheme === 'dark' ? 'light' : 'dark'))
)

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab: 'chat' | 'tasks') {
  activeTab = tab
  tabChat.classList.toggle('active', tab === 'chat')
  tabTasks.classList.toggle('active', tab === 'tasks')
  chatPane.classList.toggle('active', tab === 'chat')
  tasksPane.classList.toggle('active', tab === 'tasks')
  if (tab === 'chat') {
    if (chatHistory.length === 0) loadServerChatHistory().catch(() => {})
    chatMessages.scrollTop = chatMessages.scrollHeight
  }
  if (tab === 'tasks') loadTasks().catch(err => showTaskError(err.message || String(err)))
  syncTaskLiveRefresh()
}
tabChat.addEventListener('click', () => switchTab('chat'))
tabTasks.addEventListener('click', () => switchTab('tasks'))

// ── Status display ─────────────────────────────────────────────────────────
function setStatus(status: string) {
  currentConnectionStatus = status
  const rawLabel = STATUS_LABELS[status] || status
  const label = status === 'registered' && currentAiDisplayName ? currentAiDisplayName : rawLabel
  statusDot.className = status
  statusLabel.textContent = label
  infoStatus.textContent = rawLabel
  infoStatus.className = `info-value ${status}`
}

function updateStats() {
  const completed = taskJobs.filter(isCompletedTaskJob).length
  const failed = taskJobs.filter(job => ['failed', 'error', 'cancelled', 'stopped'].includes(taskStatus(job))).length
  const running = taskJobs.filter(job => taskState(job) === 'running').length
  statTasks.textContent = String(taskJobs.length)
  statSuccess.textContent = String(completed)
  statFailed.textContent = String(failed)
  statRunning.textContent = String(running)
}

function setSidebarOpen(open: boolean) {
  sidebarOpen = open
  bodyEl.classList.toggle('sidebar-open', open)
  settingsToggle.classList.toggle('active', open)
}

function formatTokenCount(value?: number) {
  const n = Math.max(0, Number(value) || 0)
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return String(Math.floor(n))
}

function tokenPercent(job: TaskJob) {
  const used = Math.max(0, Number(job.task_token_used) || 0)
  const limit = Number(job.task_token_limit) || 0
  if (limit <= 0) return 0
  return Math.max(0, Math.min(100, (used / limit) * 100))
}

function tokenBarClass(job: TaskJob) {
  const pct = tokenPercent(job)
  if (pct >= 90) return 'danger'
  if (pct >= 75) return 'warn'
  return ''
}

function tokenText(job: TaskJob) {
  const used = formatTokenCount(job.task_token_used)
  const limit = Number(job.task_token_limit) || 0
  return limit > 0 ? `${used} / ${formatTokenCount(limit)}` : `${used} / 无上限`
}

function clearTaskThinkingMotion() {
  for (const raf of taskThinkingRafs) window.cancelAnimationFrame(raf)
  taskThinkingRafs = []
}

function startTaskThinkingMotion() {
  clearTaskThinkingMotion()
  taskList.querySelectorAll<HTMLElement>('.task-thinking-viewport').forEach(viewport => {
    const text = viewport.querySelector<HTMLElement>('.task-thinking-content')
    if (!text) return
    const maxScroll = Math.max(0, text.scrollHeight - viewport.clientHeight)
    viewport.scrollTop = 0
    if (maxScroll <= 1) return
    let offset = 0
    const speed = 0.55 + Math.min(2.8, (text.textContent || '').length / 260)
    const step = () => {
      offset = Math.min(maxScroll, offset + speed)
      viewport.scrollTop = offset
      if (offset < maxScroll - 0.5) {
        const raf = window.requestAnimationFrame(step)
        taskThinkingRafs.push(raf)
      }
    }
    const raf = window.requestAnimationFrame(step)
    taskThinkingRafs.push(raf)
  })
}

function syncTaskLiveRefresh() {
  if (taskLiveRefreshTimer) {
    window.clearInterval(taskLiveRefreshTimer)
    taskLiveRefreshTimer = 0
  }
  const hasLiveJobs = taskJobs.some(job => ['running', 'queued'].includes(taskStatus(job)))
  if (activeTab !== 'tasks' || !hasLiveJobs) return
  taskLiveRefreshTimer = window.setInterval(() => {
    if (activeTab === 'tasks') loadTasks(true).catch(() => {})
  }, 2500)
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatTime(ts: number) {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}
function formatDateTime(sec?: number) {
  if (!sec) return '—'
  const d = new Date(sec * 1000)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
function escapeHtml(str: string) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function lifecycleLabel(lc: string) {
  return ({ learning: '学习中', working: '工作中', reproducing: '繁殖中', dead: '退役' } as any)[lc] || lc
}

// ── Task list ──────────────────────────────────────────────────────────────
function taskState(job: TaskJob): TaskRuntimeState {
  const st = String(job.effective_status || job.status || '').toLowerCase()
  if (st === 'running') return 'running'
  if (st === 'queued' || st === 'paused') return 'next'
  if (['completed', 'done', 'finished'].includes(st)) return 'completed'
  const schedule = job.task_payload?.schedule
  if (schedule && typeof schedule === 'object' && schedule.enabled) return 'scheduled'
  return 'idle'
}
function taskStateLabel(state: string) {
  const normalized = String(state || 'idle').toLowerCase()
  if (normalized === 'running') return '执行中'
  if (['next', 'queued', 'waiting', 'paused'].includes(normalized)) return '等待执行'
  if (['scheduled', 'schedule'].includes(normalized)) return '定时任务'
  if (['completed', 'done', 'finished'].includes(normalized)) return '已完成'
  return '待命'
}
function taskStatus(job: TaskJob) {
  return String(job.effective_status || job.status || '').toLowerCase()
}
function isCompletedTaskJob(job: TaskJob) {
  return ['completed', 'done', 'finished'].includes(taskStatus(job))
}
function canPauseTaskJob(job: TaskJob) {
  return ['running', 'queued'].includes(taskStatus(job))
}
function canResumeTaskJob(job: TaskJob) {
  return taskStatus(job) === 'paused'
}
function taskRank(job: TaskJob) {
  const state = taskState(job)
  return ({ running: 0, next: 1, scheduled: 2, idle: 3, completed: 4 } as Record<TaskRuntimeState, number>)[state]
}
function taskTags(payload?: Record<string, any>) {
  const src = payload && typeof payload === 'object' ? payload : {}
  const out: string[] = []
  const schedule = src.schedule || {}
  if (schedule.enabled) {
    const duration = Number(schedule.duration_minutes) || 0
    const at = Number(schedule.schedule_at) || 0
    if (duration > 0) out.push(`定时: ${duration} 分钟`)
    if (at > 0) out.push(`时间: ${formatDateTime(at)}`)
    if (schedule.loop_enabled) out.push('循环运行')
    if (schedule.run_immediately) out.push('首次立即执行')
  }
  const token = src.override_token_limit || {}
  if (token.enabled) out.push(`Token: ${Number(token.value) || 0}`)
  const mcp = src.override_mcp_tools || {}
  if (mcp.enabled) out.push(`MCP: ${Array.isArray(mcp.tools) ? mcp.tools.length : 0} 项`)
  const workspace = src.override_workspace_root || {}
  if (workspace.enabled) out.push(`目录: ${String(workspace.value || '.')}`)
  return out
}
function updateTaskSummary() {
  const running = taskJobs.filter(job => taskState(job) === 'running').length
  const scheduled = taskJobs.filter(job => taskState(job) === 'scheduled').length
  const queued = taskJobs.filter(job => taskState(job) === 'next').length
  const completed = taskJobs.filter(isCompletedTaskJob).length
  taskSummary.textContent = `执行记录 ${taskJobs.length} 条 · 运行中 ${running} · 等待 ${queued} · 定时 ${scheduled} · 模板 ${taskTemplates.length}`
  taskBatchDeleteBtn.textContent = `批量删除 (${selectedTaskJobIds.length})`
  taskBatchDeleteBtn.disabled = selectedTaskJobIds.length === 0
  taskSummary.title = `已完成 ${completed} 条`
  updateStats()
  syncTaskLiveRefresh()
}
function normalizeWorkspaceRoot(path?: string) {
  const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return normalized || '.'
}
function setTaskFormStatus(message: string, error = false) {
  taskFormStatus.textContent = message
  taskFormStatus.className = `task-form-status${error ? ' error' : ''}`
}
function resetTaskForm(job?: TaskJob) {
  const payload = job?.task_payload && typeof job.task_payload === 'object' ? job.task_payload : {}
  const schedule = payload.schedule || {}
  const token = payload.override_token_limit || {}
  const mcp = payload.override_mcp_tools || {}
  const workspace = payload.override_workspace_root || {}
  taskCreateSourceJobId = job?.job_id || ''
  taskFormTitle.value = job?.title || ''
  taskFormPriority.value = String(Math.max(1, Math.min(10, Number(job?.priority) || 5)))
  taskFormInstruction.value = job?.instruction || ''
  taskFormSchedule.checked = !!schedule.enabled
  taskFormLoop.checked = !!schedule.loop_enabled
  taskFormRunNow.checked = !!schedule.run_immediately
  taskFormDuration.value = String(Math.max(1, Number(schedule.duration_minutes) || 30))
  const at = Number(schedule.schedule_at) || 0
  taskFormDate.value = at > 0 ? new Date(at * 1000).toISOString().slice(0, 10) : ''
  taskFormTokenEnabled.checked = !!token.enabled
  taskFormToken.value = String(Math.max(1, Number(token.value) || 10000))
  taskFormMcpEnabled.checked = !!mcp.enabled
  taskFormMcp.value = Array.isArray(mcp.tools) ? mcp.tools.join(', ') : ''
  taskFormWorkspaceEnabled.checked = !!workspace.enabled
  taskFormWorkspace.value = normalizeWorkspaceRoot(workspace.value || '.')
  setTaskFormStatus(job ? '已从任务记录带入模板，可调整后重新提交。' : '')
  syncTaskFormVisibility()
}
function syncTaskFormVisibility() {
  taskCreatePanel.classList.toggle('visible', taskCreateOpen)
  document.querySelectorAll<HTMLElement>('[data-task-schedule-field]').forEach(el => {
    el.style.display = taskFormSchedule.checked ? '' : 'none'
  })
  document.querySelectorAll<HTMLElement>('[data-task-token-field]').forEach(el => {
    el.style.display = taskFormTokenEnabled.checked ? '' : 'none'
  })
  document.querySelectorAll<HTMLElement>('[data-task-mcp-field]').forEach(el => {
    el.style.display = taskFormMcpEnabled.checked ? '' : 'none'
  })
  document.querySelectorAll<HTMLElement>('[data-task-workspace-field]').forEach(el => {
    el.style.display = taskFormWorkspaceEnabled.checked ? '' : 'none'
  })
  taskFormDate.disabled = taskFormLoop.checked
  taskFormRunNow.disabled = !taskFormLoop.checked
  taskSubmitBtn.disabled = taskCreateSubmitting
}
function openTaskCreate(job?: TaskJob) {
  taskCreateOpen = true
  resetTaskForm(job)
  loadWorkspaceDirs().catch(() => {})
}
function closeTaskCreate() {
  taskCreateOpen = false
  taskCreateSubmitting = false
  taskCreateSourceJobId = ''
  syncTaskFormVisibility()
}
function closeTaskDetail() {
  taskDetailModal.classList.remove('visible')
  taskDetailContent.innerHTML = ''
  currentDetailJobId = ''
  currentDetailGenerations = []
  selectedDetailGeneration = 0
}
async function loadWorkspaceDirs() {
  try {
    const files = await window.heysureAPI.listWorkspaceFiles()
    const dirs = new Set<string>(['.'])
    for (const raw of files) {
      const path = String(raw || '').replace(/\\/g, '/')
      if (!path) continue
      if (path.endsWith('/')) dirs.add(normalizeWorkspaceRoot(path))
      else {
        const idx = path.lastIndexOf('/')
        if (idx > 0) dirs.add(normalizeWorkspaceRoot(path.slice(0, idx)))
      }
    }
    dirs.add(normalizeWorkspaceRoot(taskFormWorkspace.value || '.'))
    availableWorkspaceDirs = Array.from(dirs).sort((a, b) => a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b))
  } catch {
    availableWorkspaceDirs = ['.']
  }
  const selected = normalizeWorkspaceRoot(taskFormWorkspace.value || '.')
  taskFormWorkspace.innerHTML = availableWorkspaceDirs.map(dir => `<option value="${escapeHtml(dir)}">${escapeHtml(dir === '.' ? '用户工作区根目录' : dir)}</option>`).join('')
  taskFormWorkspace.value = availableWorkspaceDirs.includes(selected) ? selected : '.'
}
function showTaskError(message: string) {
  taskList.innerHTML = ''
  taskEmpty.style.display = 'flex'
  taskEmpty.innerHTML = `<div class="empty-icon">&#x26A0;</div><p>${escapeHtml(message)}</p><p style="font-size:11px">请确认已登录并选择 AI 成员</p>`
  taskSummary.textContent = '任务列表加载失败'
}
async function loadTasks(force = false) {
  if (taskLoading && !force) return
  taskLoading = true
  taskRefreshBtn.disabled = true
  taskRefreshBtn.textContent = '刷新中...'
  try {
    const data = await window.heysureAPI.listTasks()
    taskTemplates = Array.isArray(data.tasks) ? data.tasks : []
    taskJobs = Array.isArray(data.jobs) ? data.jobs : []
    const validSelected = new Set(taskJobs.filter(isCompletedTaskJob).map(job => job.job_id))
    selectedTaskJobIds = selectedTaskJobIds.filter(id => validSelected.has(id))
    renderTasks()
  } catch (err: any) {
    showTaskError(err.message || String(err))
    updateStats()
  } finally {
    taskLoading = false
    taskRefreshBtn.disabled = false
    taskRefreshBtn.textContent = '刷新'
  }
}
function renderTasks() {
  updateTaskSummary()
  taskList.innerHTML = ''
  const sortedJobs = [...taskJobs].sort((a, b) => {
    const rankDiff = taskRank(a) - taskRank(b)
    if (rankDiff !== 0) return rankDiff
    const priorityDiff = Number(b.priority || 0) - Number(a.priority || 0)
    if (priorityDiff !== 0) return priorityDiff
    return Number(b.created_at || 0) - Number(a.created_at || 0)
  })
  const filteredJobs = selectedTaskFilter === 'all'
    ? sortedJobs
    : sortedJobs.filter(job => taskState(job) === selectedTaskFilter)
  taskFilterBar.querySelectorAll<HTMLButtonElement>('[data-task-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.taskFilter === selectedTaskFilter)
  })
  const templateHtml = taskTemplates.length > 0 ? `
    <div class="task-template-block">
      <div class="task-section-title">任务模板</div>
      ${taskTemplates.map(task => `
        <div class="task-template ${escapeHtml(task.runtime_state || 'idle')}">
          <div class="task-template-row">
            <div class="task-template-title">${escapeHtml(task.title)}</div>
            <button class="task-mini-btn task-template-use" data-template-id="${escapeHtml(task.id)}">使用模板新建</button>
          </div>
          <div class="task-instruction">${escapeHtml(task.instruction || '暂无任务说明')}</div>
          <div class="task-template-meta">
            <span>P${Number(task.priority) || 0}</span>
            <span>${taskStateLabel(task.runtime_state)}</span>
            <span>定时: ${task.schedule_enabled ? `${Number(task.interval_minutes) || 0} 分钟` : '否'}</span>
            <span>运行 ${Number(task.running_count) || 0}</span>
            <span>排队 ${Number(task.queued_count) || 0}</span>
          </div>
        </div>`).join('')}
    </div>` : ''

  if (filteredJobs.length === 0 && taskTemplates.length === 0) {
    taskEmpty.style.display = 'flex'
    taskEmpty.innerHTML = '<div class="empty-icon">&#x1F4CB;</div><p>暂无任务记录</p><p style="font-size:11px">创建任务后会显示在这里</p>'
    return
  }
  taskEmpty.style.display = 'none'
  const jobsHtml = filteredJobs.length === 0
    ? '<div class="task-muted task-list-muted">当前筛选下暂无任务记录</div>'
    : filteredJobs.map(job => {
    const state = taskState(job)
    const tags = taskTags(job.task_payload)
    const checked = selectedTaskJobIds.includes(job.job_id) ? 'checked' : ''
    const selectable = isCompletedTaskJob(job)
    const thinking = String(job.latest_thinking || '').trim()
    const liveTool = String(job.live_tool || '').trim()
    const tokenPct = tokenPercent(job)
    const tokenCls = tokenBarClass(job)
    return `
      <div class="task-card ${state}" data-job-id="${escapeHtml(job.job_id)}">
        ${selectable ? `<label class="task-select"><input type="checkbox" class="task-select-box" data-job-id="${escapeHtml(job.job_id)}" ${checked} /></label>` : '<span class="task-select"></span>'}
        <div class="task-card-main">
          <div class="task-card-head">
            <div class="task-title">${escapeHtml(job.title || '未命名任务')}</div>
            <span class="task-state ${state}">${taskStateLabel(state)}</span>
          </div>
          <div class="task-instruction">${escapeHtml(job.instruction || '暂无任务说明')}</div>
          <div class="task-meta">
            <span>ID: ${escapeHtml(job.job_id)}</span>
            <span>P${Number(job.priority) || 0}</span>
            <span>${escapeHtml(job.trigger_type || 'manual')}</span>
            <span>创建: ${formatDateTime(job.created_at)}</span>
            <span>代际: ${Number(job.generation_count) || 0}</span>
            ${job.run_status ? `<span>run: ${escapeHtml(job.run_status)}</span>` : ''}
            ${liveTool ? `<span>工具: ${escapeHtml(liveTool)}</span>` : ''}
          </div>
          ${tags.length > 0 ? `<div class="task-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
          <div class="task-token-row" title="任务 Token 用量">
            <div class="task-token-label">Token: ${escapeHtml(tokenText(job))}</div>
            <div class="task-token-track">
              <div class="task-token-bar ${tokenCls}" style="width:${tokenPct}%"></div>
            </div>
          </div>
          <div class="task-thinking-box ${thinking ? 'live' : ''}" title="${escapeHtml(thinking || '空闲中')}">
            <div class="task-thinking-label">思考</div>
            <div class="task-thinking-viewport">
              <div class="task-thinking-content">${escapeHtml(thinking || '空闲中')}</div>
            </div>
          </div>
        </div>
        <div class="task-actions">
          <button class="task-detail-btn" data-job-id="${escapeHtml(job.job_id)}">详情</button>
          <button class="task-mini-btn task-reuse-btn" data-job-id="${escapeHtml(job.job_id)}">复用</button>
          ${canPauseTaskJob(job) ? `<button class="task-mini-btn task-pause-btn" data-job-id="${escapeHtml(job.job_id)}">暂停</button>` : ''}
          ${canResumeTaskJob(job) ? `<button class="task-mini-btn task-resume-btn" data-job-id="${escapeHtml(job.job_id)}">恢复</button>` : ''}
          <button class="task-mini-btn danger task-delete-btn" data-job-id="${escapeHtml(job.job_id)}">删除</button>
        </div>
      </div>`
  }).join('')
  taskList.innerHTML = jobsHtml + templateHtml

  taskList.querySelectorAll<HTMLButtonElement>('.task-detail-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleTaskDetail(btn.dataset.jobId || ''))
  })
  taskList.querySelectorAll<HTMLInputElement>('.task-select-box').forEach(input => {
    input.addEventListener('change', () => toggleTaskSelection(input.dataset.jobId || '', input.checked))
  })
  taskList.querySelectorAll<HTMLButtonElement>('.task-reuse-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const job = taskJobs.find(item => item.job_id === btn.dataset.jobId)
      if (job) openTaskCreate(job)
    })
  })
  taskList.querySelectorAll<HTMLButtonElement>('.task-pause-btn').forEach(btn => {
    btn.addEventListener('click', () => pauseTask(btn.dataset.jobId || ''))
  })
  taskList.querySelectorAll<HTMLButtonElement>('.task-resume-btn').forEach(btn => {
    btn.addEventListener('click', () => resumeTask(btn.dataset.jobId || ''))
  })
  taskList.querySelectorAll<HTMLButtonElement>('.task-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteTask(btn.dataset.jobId || ''))
  })
  taskList.querySelectorAll<HTMLButtonElement>('.task-template-use').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = taskTemplates.find(item => item.id === btn.dataset.templateId)
      if (!template) return
      openTaskCreate({
        job_id: '',
        title: template.title,
        instruction: template.instruction,
        priority: template.priority,
        status: 'queued',
        trigger_type: 'template',
        generation_count: 0,
        latest_generation: 0,
        task_payload: {
          schedule: {
            enabled: template.schedule_enabled,
            duration_minutes: template.interval_minutes,
          },
        },
      })
    })
  })
  startTaskThinkingMotion()
}
async function toggleTaskDetail(jobId: string) {
  if (!jobId) return
  const job = taskJobs.find(item => item.job_id === jobId)
  currentDetailJobId = jobId
  taskDetailTitle.textContent = job?.title || '任务详情'
  taskDetailSubtitle.textContent = job ? `任务ID: ${job.job_id}` : `任务ID: ${jobId}`
  taskDetailModal.classList.add('visible')
  taskDetailContent.innerHTML = '<div class="task-detail-loading">正在加载任务详情...</div>'
  try {
    const generations = await window.heysureAPI.getTaskGenerations(jobId)
    currentDetailGenerations = generations
    selectedDetailGeneration = selectedDetailGeneration && generations.some(item => item.generation === selectedDetailGeneration)
      ? selectedDetailGeneration
      : (generations[generations.length - 1]?.generation || 0)
    renderTaskDetail(taskDetailContent, job)
  } catch (err: any) {
    taskDetailContent.innerHTML = `<div class="task-detail-error">${escapeHtml(err.message || String(err))}</div>`
  }
}
function renderTaskDetail(target: HTMLElement, job?: TaskJob) {
  const selected = currentDetailGenerations.find(item => item.generation === selectedDetailGeneration)
  const latestMessages = (selected?.messages || []).slice(-8)
  const generationOptions = currentDetailGenerations.map(item =>
    `<option value="${item.generation}" ${item.generation === selectedDetailGeneration ? 'selected' : ''}>${escapeHtml(item.label || `第${item.generation}代`)} · ${escapeHtml(item.status || '')}</option>`
  ).join('')
  const stateLabel = job ? taskStateLabel(taskState(job)) : '—'
  target.innerHTML = `
    <div class="task-detail-grid">
      <div><span>状态</span><strong>${stateLabel}</strong></div>
      <div><span>开始</span><strong>${formatDateTime(job?.started_at)}</strong></div>
      <div><span>结束</span><strong>${formatDateTime(job?.finished_at)}</strong></div>
      <div><span>运行状态</span><strong>${escapeHtml(job?.run_status || job?.effective_status || job?.status || '—')}</strong></div>
    </div>
    <div class="task-detail-section">
      <div class="task-section-title">任务说明</div>
      <pre>${escapeHtml(job?.instruction || '暂无任务说明')}</pre>
    </div>
    <div class="task-detail-section">
      <div class="task-section-title">任务参数</div>
      <pre>${escapeHtml(JSON.stringify(job?.task_payload || {}, null, 2))}</pre>
    </div>
    <div class="task-detail-section">
      <div class="task-detail-toolbar">
        <div class="task-section-title">执行详情</div>
        ${currentDetailGenerations.length > 0 ? `<select class="task-generation-select">${generationOptions}</select>` : ''}
      </div>
      ${selected ? `
        <div class="task-run-line">第 ${selected.generation} 代 · ${escapeHtml(selected.status || 'unknown')} · run: ${escapeHtml(selected.run_id || '—')} · 工具: ${escapeHtml(selected.live?.current_tool || '—')}</div>
        ${selected.live?.text ? `<pre>${escapeHtml(selected.live.text)}</pre>` : ''}
        ${selected.system_prompt ? `<details class="task-prompt-detail"><summary>系统提示词</summary><pre>${escapeHtml(selected.system_prompt)}</pre></details>` : ''}
        ${latestMessages.length > 0 ? latestMessages.map(msg => `
          <div class="task-message">
            <span>${escapeHtml(msg.role)}</span>
            <p>${escapeHtml(msg.content || '').slice(0, 2000)}</p>
          </div>`).join('') : '<div class="task-muted">暂无对话消息</div>'}
      ` : '<div class="task-muted">暂无代际记录</div>'}
    </div>`
  target.querySelector<HTMLSelectElement>('.task-generation-select')?.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement
    selectedDetailGeneration = Number(select.value) || selectedDetailGeneration
    renderTaskDetail(target, job)
  })
}
function toggleTaskSelection(jobId: string, checked: boolean) {
  if (!jobId) return
  const next = new Set(selectedTaskJobIds)
  if (checked) next.add(jobId)
  else next.delete(jobId)
  selectedTaskJobIds = Array.from(next)
  renderTasks()
}
async function submitTask() {
  if (taskCreateSubmitting) return
  const title = taskFormTitle.value.trim()
  if (!title) {
    setTaskFormStatus('请填写任务名称。', true)
    return
  }
  const mcpTools = taskFormMcp.value.split(',').map(item => item.trim()).filter(Boolean)
  if (taskFormMcpEnabled.checked && mcpTools.length === 0) {
    setTaskFormStatus('已启用 MCP 范围覆盖时，请至少填写一个工具。', true)
    return
  }
  let scheduleAt: number | string | null = null
  if (taskFormSchedule.checked && !taskFormLoop.checked && taskFormDate.value) {
    const parsedMs = Date.parse(taskFormDate.value)
    scheduleAt = Number.isFinite(parsedMs) && parsedMs > 0 ? Math.floor(parsedMs / 1000) : taskFormDate.value
  }
  const payload: TriggerTaskPayload = {
    title,
    instruction: taskFormInstruction.value.trim(),
    priority: Math.max(1, Math.min(10, Number(taskFormPriority.value) || 5)),
    schedule_enabled: taskFormSchedule.checked,
    schedule_loop_enabled: taskFormSchedule.checked && taskFormLoop.checked,
    schedule_run_immediately: taskFormSchedule.checked && taskFormLoop.checked && taskFormRunNow.checked,
    schedule_duration_minutes: Math.max(1, Number(taskFormDuration.value) || 30),
    schedule_at: scheduleAt,
    override_token_limit_enabled: taskFormTokenEnabled.checked,
    token_limit_override: Math.max(1, Number(taskFormToken.value) || 10000),
    override_mcp_tools_enabled: taskFormMcpEnabled.checked,
    mcp_tools_override: mcpTools,
    override_workspace_root_enabled: taskFormWorkspaceEnabled.checked,
    workspace_root_override: normalizeWorkspaceRoot(taskFormWorkspace.value || '.'),
  }
  taskCreateSubmitting = true
  syncTaskFormVisibility()
  setTaskFormStatus('正在提交任务...')
  try {
    const result = await window.heysureAPI.triggerTask(payload)
    setTaskFormStatus(`任务「${result?.title || title}」已创建并入队。`)
    closeTaskCreate()
    await loadTasks(true)
  } catch (err: any) {
    setTaskFormStatus(err.message || String(err), true)
  } finally {
    taskCreateSubmitting = false
    syncTaskFormVisibility()
  }
}
async function pauseTask(jobId: string) {
  const job = taskJobs.find(item => item.job_id === jobId)
  if (!job || !canPauseTaskJob(job)) return
  try {
    await window.heysureAPI.pauseTask(jobId)
    await loadTasks(true)
  } catch (err: any) {
    alert(err.message || String(err))
  }
}
async function resumeTask(jobId: string) {
  const job = taskJobs.find(item => item.job_id === jobId)
  if (!job || !canResumeTaskJob(job)) return
  try {
    await window.heysureAPI.resumeTask(jobId)
    await loadTasks(true)
  } catch (err: any) {
    alert(err.message || String(err))
  }
}
async function deleteTask(jobId: string) {
  const job = taskJobs.find(item => item.job_id === jobId)
  if (!job) return
  if (!confirm(`确认删除任务「${job.title}」？会停止当前思考并删除该任务对话记录。`)) return
  try {
    await window.heysureAPI.deleteTask(jobId)
    selectedTaskJobIds = selectedTaskJobIds.filter(id => id !== jobId)
    if (currentDetailJobId === jobId) {
      currentDetailJobId = ''
      currentDetailGenerations = []
      selectedDetailGeneration = 0
    }
    await loadTasks(true)
  } catch (err: any) {
    alert(err.message || String(err))
  }
}
async function batchDeleteTasks() {
  const ids = [...selectedTaskJobIds]
  if (ids.length === 0) return
  if (!confirm(`确认批量删除 ${ids.length} 条已完成任务执行记录？`)) return
  let success = 0
  let failed = 0
  for (const id of ids) {
    try {
      await window.heysureAPI.deleteTask(id)
      success += 1
    } catch {
      failed += 1
    }
  }
  selectedTaskJobIds = []
  await loadTasks(true)
  alert(failed === 0 ? `已批量删除 ${success} 条任务。` : `批量删除完成：成功 ${success} 条，失败 ${failed} 条。`)
}
taskRefreshBtn.addEventListener('click', () => loadTasks(true))
taskCreateBtn.addEventListener('click', () => taskCreateOpen ? closeTaskCreate() : openTaskCreate())
taskBatchDeleteBtn.addEventListener('click', () => batchDeleteTasks())
taskSubmitBtn.addEventListener('click', submitTask)
taskCancelBtn.addEventListener('click', closeTaskCreate)
taskCreateClose.addEventListener('click', closeTaskCreate)
taskDetailClose.addEventListener('click', closeTaskDetail)
taskCreatePanel.addEventListener('click', (event) => {
  if (event.target === taskCreatePanel) closeTaskCreate()
})
taskCreateCard.addEventListener('click', event => event.stopPropagation())
taskDetailModal.addEventListener('click', (event) => {
  if (event.target === taskDetailModal) closeTaskDetail()
})
taskDetailCard.addEventListener('click', event => event.stopPropagation())
taskFilterBar.querySelectorAll<HTMLButtonElement>('[data-task-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    selectedTaskFilter = (btn.dataset.taskFilter as any) || 'all'
    renderTasks()
  })
})
;[taskFormSchedule, taskFormLoop, taskFormTokenEnabled, taskFormMcpEnabled, taskFormWorkspaceEnabled].forEach(input => {
  input.addEventListener('change', syncTaskFormVisibility)
})

// ── Activity feed ──────────────────────────────────────────────────────────
function addEntry(entry: { id?: string; type: string; status: string; message: string; data?: any; timestamp: number }) {
  feedEmpty.style.display = 'none'
  const el = document.createElement('div')
  el.className = 'entry'

  const iconCls = (() => {
    if (entry.status === 'success') return 'success'
    if (entry.status === 'error') return 'error'
    if (entry.status === 'running') return 'running'
    if (entry.status === 'warn') return 'warn'
    if (entry.type === 'system') return 'system'
    return 'info'
  })()
  const badgeCls = ({ task: 'task', system: 'system', error: 'error', warn: 'warn' } as any)[entry.type] || 'info'
  const icon = ({ success: '✓', error: '✗', running: '▶', warn: '⚠', system: '●' } as any)[entry.status] || 'ℹ'

  let dataHtml = ''
  if (entry.data !== undefined && entry.data !== null) {
    const s = typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 2)
    dataHtml = `<button class="entry-data-toggle" onclick="toggleData(this)"><span class="arrow">&#x25B6;</span> 详情</button><div class="entry-data"><pre>${escapeHtml(s)}</pre></div>`
  }
  let badgeHtml = ''
  if (entry.status === 'success' || entry.status === 'error' || entry.status === 'running') {
    const bLabel = entry.status === 'success' ? '成功' : entry.status === 'error' ? '失败' : '进行中'
    badgeHtml = `<span class="entry-status-badge ${entry.status}">${bLabel}</span>`
  }

  el.innerHTML = `
    <div class="entry-icon ${iconCls}">${icon}</div>
    <div class="entry-body">
      <div class="entry-top"><span class="entry-type ${badgeCls}">${entry.type}</span><span class="entry-time">${formatTime(entry.timestamp)}</span></div>
      <div class="entry-message">${escapeHtml(entry.message)}</div>
      ${badgeHtml}${dataHtml}
    </div>`
  feed.appendChild(el)
  feed.scrollTop = feed.scrollHeight
}

;(window as any).toggleData = function(btn: HTMLButtonElement) {
  btn.classList.toggle('open')
  ;(btn.nextElementSibling as HTMLElement)?.classList.toggle('visible')
}

// ── Chat UI ────────────────────────────────────────────────────────────────
function inlineMd(text: string): string {
  const placeholders: string[] = []
  const stash = (html: string) => {
    const key = `@@HTML_${placeholders.length}@@`
    placeholders.push(html)
    return key
  }
  let out = escapeHtml(text)
  out = out.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`))
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) =>
    stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`),
  )
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, prefix, url) =>
    `${prefix}${stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>`)}`,
  )
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
  placeholders.forEach((html, idx) => {
    out = out.split(`@@HTML_${idx}@@`).join(html)
  })
  return out
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  const head = lines[index]?.trim() || ''
  const sep = lines[index + 1]?.trim() || ''
  return /^\|.+\|$/.test(head) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(sep)
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

function renderMarkdownTable(lines: string[], start: number): { html: string; next: number } {
  const headers = parseTableRow(lines[start])
  let idx = start + 2
  const rows: string[][] = []
  while (idx < lines.length && /^\|.+\|$/.test(lines[idx].trim())) {
    rows.push(parseTableRow(lines[idx]))
    idx++
  }
  const head = headers.map(cell => `<th>${inlineMd(cell)}</th>`).join('')
  const body = rows.map(row =>
    `<tr>${headers.map((_, i) => `<td>${inlineMd(row[i] || '')}</td>`).join('')}</tr>`,
  ).join('')
  return {
    html: `<div class="chat-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
    next: idx,
  }
}

function renderMarkdown(text: string): string {
  const src = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!src) return ''
  const blocks: string[] = []
  const parts = src.split(/(```[\s\S]*?```)/g)
  for (const part of parts) {
    if (!part) continue
    const fence = part.match(/^```([\w-]*)\n?([\s\S]*?)```$/)
    if (fence) {
      const lang = fence[1] ? `<div class="chat-code-lang">${escapeHtml(fence[1])}</div>` : ''
      blocks.push(`${lang}<pre>${escapeHtml(fence[2].trim())}</pre>`)
      continue
    }

    const lines = part.split('\n')
    let para: string[] = []
    let list: string[] = []
    let ordered = false
    const flushPara = () => {
      if (!para.length) return
      blocks.push(`<p>${inlineMd(para.join('\n')).replace(/\n/g, '<br>')}</p>`)
      para = []
    }
    const flushList = () => {
      if (!list.length) return
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${list.join('')}</${ordered ? 'ol' : 'ul'}>`)
      list = []
    }

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]
      const trimmed = line.trim()
      if (!trimmed) {
        flushPara()
        flushList()
        continue
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        flushPara()
        flushList()
        blocks.push('<hr>')
        continue
      }
      if (isMarkdownTableStart(lines, lineIndex)) {
        flushPara()
        flushList()
        const table = renderMarkdownTable(lines, lineIndex)
        blocks.push(table.html)
        lineIndex = table.next - 1
        continue
      }
      const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
      if (heading) {
        flushPara()
        flushList()
        const level = Math.min(3, heading[1].length)
        blocks.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`)
        continue
      }
      const quote = trimmed.match(/^>\s+(.+)$/)
      if (quote) {
        flushPara()
        flushList()
        blocks.push(`<blockquote>${inlineMd(quote[1])}</blockquote>`)
        continue
      }
      const unordered = trimmed.match(/^[-*]\s+(.+)$/)
      const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/)
      if (unordered || orderedMatch) {
        flushPara()
        const nextOrdered = !!orderedMatch
        if (list.length && ordered !== nextOrdered) flushList()
        ordered = nextOrdered
        list.push(`<li>${inlineMd((unordered || orderedMatch)![1])}</li>`)
        continue
      }
      para.push(line)
    }
    flushPara()
    flushList()
  }
  return `<div class="chat-md">${blocks.join('')}</div>`
}

function renderChatHistory() {
  chatMessages.querySelectorAll('.chat-msg').forEach(el => el.remove())
  chatNoKey.style.display = chatHistory.length === 0 ? 'flex' : 'none'
  chatHistory.forEach(msg => appendChatMsg(msg.role === 'assistant' ? 'ai' : 'user', msg.content))
  updateChatEmptyVisibility()
}

async function loadServerChatHistory() {
  try {
    const rows = await window.heysureAPI.getChatHistory()
    chatHistory = rows
      .filter(row => row && (row.role === 'user' || row.role === 'assistant'))
      .map(row => ({
        role: row.role,
        content: row.think ? `<think>${row.think}</think>${row.content || ''}` : String(row.content || ''),
        serverId: typeof row.id === 'number' ? row.id : undefined,
      }))
    renderChatHistory()
  } catch (err: any) {
    chatHistory = []
    renderChatHistory()
    appendChatMsg('ai', `⚠ 错误: ${err.message || String(err)}`)
  }
}

function appendChatMsg(role: 'user' | 'ai', content: string) {
  chatNoKey.style.display = 'none'
  const el = document.createElement('div')
  el.className = `chat-msg ${role}`
  el.innerHTML = `<div class="chat-avatar">${role === 'ai' ? '&#x2728;' : '&#x1F464;'}</div><div class="chat-bubble">${renderMarkdown(content)}</div>`
  chatMessages.appendChild(el)
  chatMessages.scrollTop = chatMessages.scrollHeight
  return el
}
function appendThinking() {
  chatNoKey.style.display = 'none'
  const el = document.createElement('div')
  el.className = 'chat-msg ai'; el.id = 'chat-thinking'
  el.innerHTML = `<div class="chat-avatar">&#x2728;</div><div class="chat-bubble"><div class="chat-thinking"><div class="chat-thinking-dot"></div><div class="chat-thinking-dot"></div><div class="chat-thinking-dot"></div></div></div>`
  chatMessages.appendChild(el)
  chatMessages.scrollTop = chatMessages.scrollHeight
  return el
}
function updateChatEmptyVisibility() {
  chatNoKey.style.display = chatHistory.length === 0 ? 'flex' : 'none'
  chatInput.disabled = false
  chatSendBtn.disabled = false
}
async function sendChat() {
  if (chatBusy) return
  const text = chatInput.value.trim()
  if (!text) return
  chatInput.value = ''; chatInput.style.height = 'auto'
  chatBusy = true; chatSendBtn.disabled = true
  chatHistory.push({ role: 'user', content: text })
  appendChatMsg('user', text)
  const thinkEl = appendThinking()
  try {
    await window.heysureAPI.sendChat(text)
    thinkEl.remove()
    await loadServerChatHistory()
  } catch (err: any) {
    thinkEl.remove()
    appendChatMsg('ai', `⚠ 错误: ${err.message || String(err)}`)
  } finally {
    chatBusy = false; chatSendBtn.disabled = false; chatInput.focus()
  }
}
chatSendBtn.addEventListener('click', sendChat)
chatInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } })
chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(chatInput.scrollHeight, 110) + 'px' })
document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  closeLoginModal()
  closeAiSelectModal()
  if (taskDetailModal.classList.contains('visible')) closeTaskDetail()
  if (taskCreateOpen) closeTaskCreate()
})

// ── Settings ───────────────────────────────────────────────────────────────
async function loadMainSettings() {
  const s = await window.heysureAPI.getSettings()
  selectedAiConfigId = typeof s.selectedAiConfigId === 'number' ? s.selectedAiConfigId : null
  cfgServer.value = s.serverUrl || ''
  cfgWorkspace.value = s.workspaceRoot || ''
  infoServer.textContent    = s.serverUrl || '—'
  infoWorkspace.textContent = s.workspaceRoot ? (s.workspaceRoot.split(/[/\\]/).pop() || s.workspaceRoot) : '—'
  updateChatEmptyVisibility()
  if (s.selectedAiConfigName) updateAiMemberDisplay(s)
  else clearAiMemberDisplay()
  updateUserChip(s)
  return s
}

function updateAiMemberDisplay(s: any) {
  const isManager = s.selectedAiConfigRole === 'manager'
  const name = s.selectedAiConfigName || '—'
  selectedAiConfigId = typeof s.selectedAiConfigId === 'number' ? s.selectedAiConfigId : selectedAiConfigId
  currentAiDisplayName = name === '—' ? '' : (isManager ? `★ ${name}` : name)
  aiInfoName.textContent = name
  aiInfoRole.textContent = isManager ? '组长 (Manager)' : '成员 (Member)'
  aiInfoLifecycle.textContent = lifecycleLabel(s.selectedAiConfigLifecycle)
  aiInfoProject.textContent = s.selectedAiConfigProject || '—'
  updateAiSelectTarget()
  setStatus(currentConnectionStatus)
}

function clearAiMemberDisplay() {
  selectedAiConfigId = null
  currentAiDisplayName = ''
  aiInfoName.textContent = '—'
  aiInfoRole.textContent = '—'
  aiInfoLifecycle.textContent = '—'
  aiInfoProject.textContent = '—'
  updateAiSelectTarget()
  setStatus(currentConnectionStatus)
}

function updateAiSelectTarget() {
  if (currentAiDisplayName) {
    aiSelectTarget.classList.remove('empty')
    aiSelectTargetText.innerHTML = `当前 AI：<span class="tb-name">${escapeHtml(currentAiDisplayName)}</span>`
  } else {
    aiSelectTarget.classList.add('empty')
    aiSelectTargetText.textContent = '未选择 AI 成员'
  }
}

async function saveSettings() {
  const settings = {
    serverUrl: cfgServer.value.trim(),
    workspaceRoot: cfgWorkspace.value.trim(),
  }
  try {
    await window.heysureAPI.saveSettings(settings)
    infoServer.textContent = settings.serverUrl || '—'
    infoWorkspace.textContent = settings.workspaceRoot ? (settings.workspaceRoot.split(/[/\\]/).pop() || settings.workspaceRoot) : '—'
    updateChatEmptyVisibility()
    saveFeedback.style.color = ''; saveFeedback.textContent = '已保存 ✓'
    setTimeout(() => { saveFeedback.textContent = '' }, 2000)
  } catch {
    saveFeedback.textContent = '保存失败'; saveFeedback.style.color = 'var(--error)'
    setTimeout(() => { saveFeedback.textContent = ''; saveFeedback.style.color = '' }, 3000)
  }
}
saveBtn.addEventListener('click', saveSettings)

testConnBtn.addEventListener('click', async () => {
  testResult.textContent = '测试中...'; testResult.className = 'test-result'
  testConnBtn.setAttribute('disabled', 'true')
  try {
    const r = await window.heysureAPI.testConnection()
    testResult.textContent = r.success ? `✓ 连接成功 (${r.status}) · ${r.ms}ms` : `✗ ${r.error}`
    testResult.className = `test-result ${r.success ? 'success' : 'error'}`
  } catch (err: any) {
    testResult.textContent = `✗ ${err.message}`; testResult.className = 'test-result error'
  } finally { testConnBtn.removeAttribute('disabled') }
})

connectBtn.addEventListener('click', () => window.heysureAPI.connect())
disconnectBtn.addEventListener('click', () => window.heysureAPI.disconnect())
clearBtn.addEventListener('click', () => {
  feed.querySelectorAll('.entry').forEach(e => e.remove())
  feedEmpty.style.display = 'flex'
})
settingsToggle.addEventListener('click', () => setSidebarOpen(!sidebarOpen))

window.heysureAPI.onStatusChange(setStatus)
window.heysureAPI.onActivityLog(addEntry)
window.heysureAPI.onTaskStart((data) => {
  totalTasks++; runningTasks++
  addEntry({ id: data.taskId, type: 'task', status: 'running', message: `执行工具: ${data.tool}`, data: data.args && Object.keys(data.args).length > 0 ? data.args : undefined, timestamp: data.timestamp || Date.now() })
  loadTasks(true).catch(() => updateStats())
})
window.heysureAPI.onTaskResult((data) => {
  runningTasks = Math.max(0, runningTasks - 1)
  data.success ? successTasks++ : failedTasks++
  addEntry({ id: data.taskId + '_result', type: 'task', status: data.success ? 'success' : 'error', message: `${data.success ? '完成' : '失败'}: ${data.tool}`, data: data.result ?? undefined, timestamp: data.timestamp || Date.now() })
  loadTasks(true).catch(() => updateStats())
})

// ══════════════════════════════════════════════════════
// SCREEN 1: LOGIN
// ══════════════════════════════════════════════════════
const loginAccountInput  = document.getElementById('login-account') as HTMLInputElement
const loginPasswordInput = document.getElementById('login-password') as HTMLInputElement
const loginBtn           = document.getElementById('login-btn') as HTMLButtonElement
const loginError         = document.getElementById('login-error')!
const loginModal         = document.getElementById('login-modal')!
const loginModalClose    = document.getElementById('login-modal-close')!
const aiSelectModal      = document.getElementById('ai-select-modal')!
const aiSelectModalClose = document.getElementById('ai-select-modal-close')!

function showLoginError(msg: string) { loginError.textContent = msg; loginError.classList.add('visible') }
function clearLoginError() { loginError.classList.remove('visible') }

function openLoginModal() {
  loginModal.classList.remove('hidden')
  clearLoginError()
  window.heysureAPI.getSettings().then(s => {
    loginAccountInput.value = s.userAccount || ''
    updateUserChip(s)
    setTimeout(() => (s.authToken ? loginModalClose : loginAccountInput).focus(), 0)
  }).catch(() => {})
}

function closeLoginModal() {
  loginModal.classList.add('hidden')
}

function openAiSelectModal() {
  aiSelectModal.classList.remove('hidden')
  window.heysureAPI.getSettings().then(s => {
    updateUserChip(s)
    if (!s.authToken) {
      aiGrid.innerHTML = '<div class="ai-empty"><div class="ai-empty-icon">&#x1F512;</div><p>请先点击头像登录软件端账号</p></div>'
      return
    }
    loadAiSelectScreen().catch(() => {})
  }).catch(() => {})
}

function closeAiSelectModal() {
  aiSelectModal.classList.add('hidden')
}

async function doLogin() {
  clearLoginError()
  const saved = await window.heysureAPI.getSettings()
  const serverUrl = (cfgServer.value.trim() || saved.serverUrl || '').trim()
  const account   = loginAccountInput.value.trim()
  const password  = loginPasswordInput.value
  if (!serverUrl) { showLoginError('请先在设置中配置服务器地址'); return }
  if (!account)   { showLoginError('请输入账号'); return }
  if (!password)  { showLoginError('请输入密码'); return }

  loginBtn.classList.add('loading'); loginBtn.disabled = true
  try {
    await window.heysureAPI.login({ serverUrl, account, password })
    const s = await window.heysureAPI.getSettings()
    loginPasswordInput.value = ''
    updateUserChip(s)
    closeLoginModal()
    await loadMainSettings()
    openAiSelectModal()
  } catch (err: any) {
    showLoginError(err.message || '登录失败')
  } finally {
    loginBtn.classList.remove('loading'); loginBtn.disabled = false
  }
}
loginBtn.addEventListener('click', doLogin)
;[loginAccountInput, loginPasswordInput].forEach(el =>
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin() })
)
loginModalClose.addEventListener('click', closeLoginModal)
loginModal.addEventListener('click', e => { if (e.target === loginModal) closeLoginModal() })
statusPill.addEventListener('click', openAiSelectModal)
statusPill.addEventListener('keydown', e => {
  const key = (e as KeyboardEvent).key
  if (key === 'Enter' || key === ' ') {
    e.preventDefault()
    openAiSelectModal()
  }
})
aiSelectModalClose.addEventListener('click', closeAiSelectModal)
aiSelectModal.addEventListener('click', e => { if (e.target === aiSelectModal) closeAiSelectModal() })

// ══════════════════════════════════════════════════════
// SCREEN 2: AI SELECT
// ══════════════════════════════════════════════════════
const aiGrid       = document.getElementById('ai-grid')!
const logoutBtn    = document.getElementById('logout-btn')!
const refreshAiBtn = document.getElementById('refresh-ai-btn')!
const accountInfoBlock  = document.getElementById('account-info') as HTMLElement
const accountInfoAva    = document.getElementById('account-info-ava') as HTMLElement
const accountInfoName   = document.getElementById('account-info-name') as HTMLElement
const accountInfoServer = document.getElementById('account-info-server') as HTMLElement
const loginFormBlock    = document.getElementById('login-form') as HTMLElement

function setUserChip(account: string, displayName: string, server: string, authenticated = true) {
  const host = (() => { try { return new URL(server).hostname } catch { return server || '—' } })()
  const shown = (displayName || account || '').trim()
  headerUserName.textContent = authenticated && shown ? shown : '未登录'
  headerUserAva.textContent = authenticated && shown ? shown.slice(0, 1).toUpperCase() : '·'
  headerUserChip.classList.toggle('logged-in', !!(authenticated && shown))
  // Login modal: swap between login form and account info
  if (authenticated && shown) {
    accountInfoAva.textContent = shown.slice(0, 1).toUpperCase()
    accountInfoName.textContent = shown
    accountInfoServer.textContent = account && account !== shown ? `${account} · ${host}` : host
    accountInfoBlock.style.display = 'flex'
    loginFormBlock.style.display = 'none'
  } else {
    accountInfoBlock.style.display = 'none'
    loginFormBlock.style.display = 'flex'
  }
}

function updateUserChip(s: any) {
  setUserChip(s.userAccount || '', s.userName || '', s.serverUrl || '', !!s.authToken)
}

function parseMcpTools(value: any): string[] {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
}

function hasDesktopMcpPermission(cfg: any) {
  if (cfg?.mcp_enabled === false) return false
  return parseMcpTools(cfg?.mcp_tools).some(tool => DESKTOP_AGENT_MCP_TOOLS.has(tool))
}

function roleOfConfig(cfg: any) {
  if (cfg?.ai_role === 'assistant_admin') return 'assistant_admin'
  return cfg?.digital_member_role === 'manager' ? 'manager' : 'member'
}

function roleLabel(role: string) {
  return ({ assistant_admin: '辅助管理员', manager: '管理者', member: '普通成员' } as Record<string, string>)[role] || role
}

function mcpToolCount(cfg: any) {
  return parseMcpTools(cfg?.mcp_tools).length
}

async function doLogout() {
  await window.heysureAPI.logout()
  const s = await window.heysureAPI.getSettings()
  cfgServer.value = s.serverUrl || ''
  loginAccountInput.value = ''
  loginPasswordInput.value = ''
  chatHistory = []
  renderChatHistory()
  updateUserChip(s)
  clearAiMemberDisplay()
  clearLoginError()
  closeLoginModal()
  closeAiSelectModal()
  setStatus('disconnected')
}

headerUserChip.addEventListener('click', () => openLoginModal())

async function loadAiSelectScreen() {
  aiGrid.innerHTML = '<div class="ai-loading"><div class="spinner-large"></div><p>加载 AI 成员列表...</p></div>'
  try {
    const [configs, statuses, settings] = await Promise.all([
      window.heysureAPI.listAiConfigs(),
      window.heysureAPI.getAiRuntimeStatus(),
      window.heysureAPI.getSettings(),
    ])
    selectedAiConfigId = typeof settings.selectedAiConfigId === 'number' ? settings.selectedAiConfigId : null
    currentAiDisplayName = settings.selectedAiConfigName || currentAiDisplayName
    updateAiSelectTarget()
    renderAiGrid(configs, statuses)
  } catch (err: any) {
    aiGrid.innerHTML = `<div class="ai-empty"><div class="ai-empty-icon">&#x26A0;</div><p>加载失败: ${escapeHtml(err.message || String(err))}</p><button class="btn btn-secondary" onclick="loadAiSelectScreen()" style="margin-top:8px">重试</button></div>`
  }
}

function renderAiGrid(configs: any[], statuses: any[]) {
  const desktopConfigs = (configs || []).filter(hasDesktopMcpPermission)
  const statusMap = new Map<number, any>()
  statuses.forEach(s => statusMap.set(s.ai_config_id, s))

  if (!configs || configs.length === 0) {
    aiGrid.innerHTML = '<div class="ai-empty"><div class="ai-empty-icon">&#x1F916;</div><p>暂无 AI 成员</p><p style="font-size:11px">请先在网页端项目中创建 AI 成员</p></div>'
    return
  }

  if (desktopConfigs.length === 0) {
    aiGrid.innerHTML = '<div class="ai-empty"><div class="ai-empty-icon">&#x1F5A5;</div><p>暂无具备 Windows 桌面权限的 AI 成员</p><p style="font-size:11px">请在网页端 AI 设置中为成员开启桌面端 MCP 工具权限</p></div>'
    return
  }

  aiGrid.innerHTML = ''
  desktopConfigs.forEach(cfg => {
    const role = roleOfConfig(cfg)
    const isAdmin = role === 'assistant_admin'
    const rs = statusMap.get(cfg.id)
    const isEnabled = rs?.running ?? cfg.enabled
    const tools = parseMcpTools(cfg?.mcp_tools)
    const toolsHtml = tools.length === 0
      ? '<div class="member-tool-empty">未配置可调用的 MCP 工具</div>'
      : `<div class="member-tools">${
          tools.slice(0, 12).map(tool => `<span class="member-tool-chip">${escapeHtml(tool)}</span>`).join('')
        }${tools.length > 12 ? `<span class="member-tool-chip more">+${tools.length - 12}</span>` : ''}</div>`

    const card = document.createElement('div')
    card.className = `member-card${cfg.id === selectedAiConfigId ? ' selected' : ''}${isAdmin ? ' admin-card' : ''}`

    card.innerHTML = `
      <div class="${isEnabled ? 'member-dot-on' : 'member-dot-off'}"></div>
      <div class="member-ava">${escapeHtml((cfg.name || '?').slice(0, 1))}</div>
      <div class="member-info">
        <div class="member-name">${escapeHtml(cfg.name || '未命名')}</div>
        <div class="member-meta">${escapeHtml(cfg.model || '—')} · MCP ${tools.length} 项 · ${escapeHtml(cfg.project_name || cfg.description || '无项目')}</div>
      </div>
      <span class="role-badge ${role}">${roleLabel(role)}</span>
      ${toolsHtml}`

    if (!isAdmin) {
      card.addEventListener('click', async () => {
        card.classList.add('selected')
        try {
          await window.heysureAPI.selectAiConfig(cfg)
          const s = await window.heysureAPI.getSettings()
          await loadMainSettings()
          updateAiMemberDisplay(s)
          const status = await window.heysureAPI.getStatus()
          setStatus(status)
          await loadServerChatHistory()
          loadTasks(true).catch(() => {})
          closeAiSelectModal()
          showScreen('main')
        } catch (err: any) {
          alert('选择失败: ' + (err.message || String(err)))
          await loadAiSelectScreen()
        }
      })
    }

    aiGrid.appendChild(card)
  })
}

;(window as any).loadAiSelectScreen = loadAiSelectScreen

logoutBtn.addEventListener('click', () => doLogout())

refreshAiBtn.addEventListener('click', () => loadAiSelectScreen())

function goToAiSelect() {
  openAiSelectModal()
}
document.getElementById('switch-ai-btn2')?.addEventListener('click', goToAiSelect)

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════
async function init() {
  const s = await window.heysureAPI.getSettings()
  applyTheme(s.theme || 'dark', false)
  cfgServer.value = s.serverUrl || ''
  loginAccountInput.value = s.userAccount || ''
  updateUserChip(s)
  await loadMainSettings()
  const status = await window.heysureAPI.getStatus()
  setStatus(status)
  showScreen('main')

  if (s.authToken && s.selectedAiConfigId) {
    await loadServerChatHistory()
    loadAiSelectScreen().catch(() => {})
    loadTasks(true).catch(() => {})
  } else if (s.authToken) {
    openAiSelectModal()
  } else {
    openLoginModal()
  }
}

init().catch(console.error)
