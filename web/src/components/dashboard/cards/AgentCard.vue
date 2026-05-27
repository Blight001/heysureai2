<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

interface AgentTaskSnapshot {
  jobId: string
  title: string
  status: string
  effectiveStatus: string
  runStatus: string
  triggerType: string
  scheduleEnabled?: boolean
  scheduleAt?: number
  scheduleLoopEnabled?: boolean
  scheduleDurationMinutes?: number
  generationCount: number
  latestGeneration: number
  taskTokenUsed: number
  taskTokenLimit: number
  createdAt?: number
  updatedAt?: number
  startedAt?: number
  finishedAt?: number
}

interface AgentProps {
  agent: {
    id: string
    name: string
    role: 'admin' | 'worker'
    tokensUsed: number
    tokenLimit: number
    generation: number
    status: 'learning' | 'working' | 'reproducing' | 'dead'
    platform: string
    currentTask?: string
    summary?: string // 遗言/总结
    projectId?: string
    projectName?: string
    aiConfigId?: number
    enabled?: boolean
    mcpEnabled?: boolean
    mcpTools?: string
    botChannel?: 'feishu' | 'qq'
    botEnabled?: boolean
    botStatus?: {
      status?: string
      mode?: string
      label?: string
      message?: string
    }
    feishuEnabled?: boolean
    feishuWebhookUrl?: string
    feishuAppId?: string
    feishuDefaultReceiveId?: string
    feishuDefaultReceiveIdType?: string
    feishuStatus?: {
      status?: string
      mode?: string
      label?: string
      message?: string
    }
    qqEnabled?: boolean
    qqAppId?: string
    qqSandbox?: boolean
    qqDefaultTargetId?: string
    qqDefaultTargetType?: string
    qqStatus?: {
      status?: string
      mode?: string
      label?: string
      message?: string
    }
    desktopAgentConnected?: boolean
    desktopAgentId?: string
    desktopAgentName?: string
    desktopAgentPlatform?: string
    desktopAgentCapabilities?: string[]
    browserAgentConnected?: boolean
    browserAgentId?: string
    browserAgentName?: string
    browserAgentPlatform?: string
    browserAgentCapabilities?: string[]
    runtimeStatus?: string
    runtimeTool?: string
    activeRunStatus?: string
    activeRunPhase?: string
    activeRunSessionId?: string
    userChatActive?: boolean
    recentUserChatActive?: boolean
    recentUserChatAt?: number
    aiRole?: 'assistant_admin' | 'digital_member' | 'admin' | 'worker'
    digitalMemberRole?: 'manager' | 'member'
    parentAiConfigId?: number | null
    managementScope?: string
    currentTaskTitle?: string
    currentTaskStatus?: string
    taskCurrent?: AgentTaskSnapshot | null
    taskCurrentOrRecent?: AgentTaskSnapshot | null
    taskRecentCompleted?: AgentTaskSnapshot | null
    taskScheduledTasks?: AgentTaskSnapshot[]
    latestThinking?: string
  }
}

const props = defineProps<AgentProps>()
const emit = defineEmits<{
  (e: 'context', payload: { agent: AgentProps['agent']; x: number; y: number }): void
  (e: 'show-tools', agent: AgentProps['agent']): void
  (e: 'show-context', agent: AgentProps['agent']): void
  (e: 'chat', agent: AgentProps['agent']): void
  (e: 'show-tasks', agent: AgentProps['agent']): void
  (e: 'show-task-detail', payload: { agent: AgentProps['agent']; jobId: string }): void
  (e: 'settings', agent: AgentProps['agent']): void
}>()

const isUnlimitedLife = computed(() => props.agent.tokenLimit <= 0)
const syncedGeneration = computed(() => {
  const base = Math.max(1, Number(props.agent.generation) || 1)
  const fromCurrentTask = Math.max(1, Number(props.agent.taskCurrentOrRecent?.latestGeneration) || 1)
  const fromCompletedTask = Math.max(1, Number(props.agent.taskRecentCompleted?.latestGeneration) || 1)
  return Math.max(base, fromCurrentTask, fromCompletedTask)
})

const lifePercentage = computed(() => {
  if (isUnlimitedLife.value) return 100
  return Math.min((props.agent.tokensUsed / props.agent.tokenLimit) * 100, 100)
})

const lifeColorClass = computed(() => {
  if (isUnlimitedLife.value) return 'bg-indigo-500'
  if (lifePercentage.value > 90) return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]' // 濒死/繁衍前夕
  if (lifePercentage.value > 75) return 'bg-orange-500'
  return 'bg-emerald-500'
})

const statusDisplay = computed(() => {
  const taskSuffix = props.agent.currentTaskTitle
    ? ` · 任务: ${props.agent.currentTaskTitle}`
    : ''
  const runtimeSuffix = !props.agent.enabled
    ? ' · 已停止'
    : props.agent.runtimeStatus === 'running' && props.agent.runtimeTool
      ? ` · 调用中: ${props.agent.runtimeTool}`
      : props.agent.runtimeStatus === 'running'
        ? ' · MCP 调用中'
      : props.agent.runtimeStatus === 'error'
        ? ' · MCP 调用失败'
        : ''

  const taskStatus = String(props.agent.currentTaskStatus || '').toLowerCase()
  const isTaskRunning = taskStatus === 'running' || props.agent.runtimeStatus === 'running'
  const isTaskWaiting = ['queued', 'paused', 'scheduled', 'next'].includes(taskStatus)
  const isUserChatActive = !!props.agent.userChatActive

  switch (props.agent.status) {
    case 'learning': return { text: `学习中 (下载记忆)${runtimeSuffix}`, class: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-300 dark:bg-blue-500/10 dark:border-blue-500/30' }
    case 'working':
      if (isUserChatActive) return { text: `与用户沟通中${runtimeSuffix}`, class: 'text-cyan-700 bg-cyan-50 border-cyan-200 dark:text-cyan-300 dark:bg-cyan-500/10 dark:border-cyan-500/30' }
      if (isTaskRunning) return { text: `工作中${taskSuffix}${runtimeSuffix}`, class: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-500/30' }
      if (isTaskWaiting) return { text: `等待中${taskSuffix}${runtimeSuffix}`, class: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/10 dark:border-amber-500/30' }
      return { text: `空闲中${runtimeSuffix}`, class: 'text-zinc-600 bg-zinc-100 border-zinc-200 dark:text-zinc-300 dark:bg-zinc-800/80 dark:border-zinc-700' }
    case 'reproducing': return { text: '传宗接代 (总结任务)', class: 'text-purple-600 bg-purple-50 border-purple-200 animate-pulse dark:text-purple-300 dark:bg-purple-500/10 dark:border-purple-500/30' }
    case 'dead': return { text: '已枯竭 (进入英灵殿)', class: 'text-zinc-500 bg-zinc-100 border-zinc-200 dark:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700' }
    default: return { text: '未知', class: 'text-gray-500' }
  }
})

const cardBorderClass = computed(() => {
  if (props.agent.aiRole === 'assistant_admin') return 'border-2 border-violet-300 ring-1 ring-inset ring-violet-200/80 shadow-[0_0_14px_rgba(196,181,253,0.5)] dark:border-violet-400/70 dark:ring-violet-500/35 dark:shadow-[0_0_16px_rgba(139,92,246,0.22)]'
  if (props.agent.aiRole === 'digital_member' && props.agent.digitalMemberRole === 'manager') return 'border-2 border-amber-300 ring-1 ring-inset ring-amber-200/80 shadow-[0_0_14px_rgba(252,211,77,0.5)] dark:border-amber-400/70 dark:ring-amber-500/35 dark:shadow-[0_0_16px_rgba(245,158,11,0.22)]'
  if (props.agent.aiRole === 'digital_member') return 'border-2 border-sky-300 ring-1 ring-inset ring-sky-200/80 shadow-[0_0_14px_rgba(125,211,252,0.5)] hover:border-sky-400 dark:border-sky-400/70 dark:ring-sky-500/35 dark:shadow-[0_0_16px_rgba(14,165,233,0.22)]'
  if (props.agent.status === 'dead') return 'border-zinc-200 opacity-75 grayscale'
  return 'border-zinc-200 hover:border-indigo-300'
})

const cardGlowClass = computed(() => {
  if (props.agent.status === 'dead') return 'agent-card-glow-dead'
  if (props.agent.aiRole === 'assistant_admin') return 'agent-card-glow-assistant'
  if (props.agent.aiRole === 'digital_member' && props.agent.digitalMemberRole === 'manager') return 'agent-card-glow-manager'
  if (props.agent.aiRole === 'digital_member') return 'agent-card-glow-member'
  return 'agent-card-glow-default'
})

const canControl = computed(() => typeof props.agent.aiConfigId === 'number')
const showLifecycle = computed(() => props.agent.aiRole !== 'assistant_admin')
const isAssistantAdmin = computed(() => props.agent.aiRole === 'assistant_admin')
const showRecentUserChatBadge = computed(() => !!props.agent.recentUserChatActive)
const isRealtimeWorking = computed(() => {
  if (props.agent.status !== 'working') return false
  if (props.agent.userChatActive || props.agent.recentUserChatActive) return true
  const taskStatus = String(props.agent.currentTaskStatus || '').toLowerCase()
  return taskStatus === 'running' || props.agent.runtimeStatus === 'running'
})
const taskSnapshotDisplay = computed(() => {
  const current = props.agent.taskCurrent || null
  if (current) return { label: '当前任务', task: current, isCurrent: true }
  const recent = props.agent.taskRecentCompleted || props.agent.taskCurrentOrRecent || null
  return recent ? { label: '最近任务', task: recent, isCurrent: false } : null
})
const scheduledTaskSnapshots = computed(() => {
  const currentJobId = props.agent.taskCurrent?.jobId || ''
  const scheduled = Array.isArray(props.agent.taskScheduledTasks)
    ? props.agent.taskScheduledTasks
    : []
  const normalized = scheduled.filter(task => task && task.jobId !== currentJobId)
  if (normalized.length > 0) return normalized
  const task = props.agent.taskCurrentOrRecent
  if (!task || task.jobId === currentJobId) return []
  if (String(task.triggerType || '').toLowerCase() !== 'schedule' && !task.scheduleEnabled) return []
  const effectiveStatus = String(task.effectiveStatus || task.status || '').toLowerCase()
  return ['queued', 'paused', 'scheduled', 'next'].includes(effectiveStatus) ? [task] : []
})
const showTaskSnapshotBlock = computed(() => {
  if (props.agent.aiRole !== 'digital_member') return false
  return Boolean(taskSnapshotDisplay.value || scheduledTaskSnapshots.value.length > 0)
})
const showWorkspaceContextButton = computed(() => {
  return props.agent.aiRole === 'digital_member' && props.agent.digitalMemberRole === 'manager'
})

const roleBadge = computed(() => {
  if (props.agent.aiRole === 'assistant_admin') {
    return {
      text: '辅助管理员',
      icon: '◆',
      class: 'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/40',
    }
  }
  if (props.agent.aiRole === 'digital_member' && props.agent.digitalMemberRole === 'manager') {
    return {
      text: '数字社会管理员',
      icon: '👑',
      class: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40',
    }
  }
  if (props.agent.aiRole === 'digital_member') {
    return {
      text: '数字成员',
      icon: '●',
      class: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/40',
    }
  }
  return null
})

const botConnection = computed(() => {
  const channel = props.agent.botChannel === 'qq' ? 'qq' : 'feishu'
  const enabled = channel === 'qq' ? props.agent.qqEnabled : props.agent.feishuEnabled
  if (!enabled) return null
  const botStatus = channel === 'qq' ? props.agent.qqStatus : props.agent.feishuStatus
  const status = String(botStatus?.status || '').trim()
  const mode = String(botStatus?.mode || '').trim()
  const message = String(botStatus?.message || '').trim()
  const receiveId = channel === 'qq'
    ? String(props.agent.qqDefaultTargetId || '').trim()
    : String(props.agent.feishuDefaultReceiveId || '').trim()
  const name = channel === 'qq' ? 'QQ' : '飞书'
  const modeText = channel === 'qq'
    ? (mode === 'sandbox_webhook' ? '沙箱Webhook' : mode === 'webhook' ? 'Webhook' : '未配置')
    : (mode === 'long_connection' ? '长连接' : mode === 'webhook' ? 'Webhook' : '未配置')
  if (status === 'success') {
    return {
      text: `${name}成功 · ${modeText}`,
      class: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
      title: [message || `${name}机器人状态成功`, receiveId ? `默认接收：${receiveId}` : ''].filter(Boolean).join('；'),
    }
  }
  if (status === 'pending') {
    return {
      text: `${name}待回调 · ${modeText}`,
      class: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300',
      title: [message || `${name}机器人等待回调`, receiveId ? `默认接收：${receiveId}` : ''].filter(Boolean).join('；'),
    }
  }
  return {
    text: `${name}失败 · ${modeText}`,
    class: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300',
    title: message || `${name}机器人状态失败`,
  }
})

const desktopConnection = computed(() => {
  if (!props.agent.desktopAgentConnected) return null
  const name = String(props.agent.desktopAgentName || props.agent.name || '').trim()
  const platform = String(props.agent.desktopAgentPlatform || 'Windows Desktop').trim()
  const id = String(props.agent.desktopAgentId || '').trim()
  return {
    text: '桌面已连接',
    class: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300',
    title: [name ? `桌面 Agent：${name}` : '', platform ? `平台：${platform}` : '', id ? `ID：${id}` : ''].filter(Boolean).join('；') || '桌面 Agent 已连接',
  }
})

const browserConnection = computed(() => {
  if (!props.agent.browserAgentConnected) return null
  const name = String(props.agent.browserAgentName || props.agent.name || '').trim()
  const platform = String(props.agent.browserAgentPlatform || 'Browser Extension').trim()
  const id = String(props.agent.browserAgentId || '').trim()
  return {
    text: '浏览器已连接',
    class: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-300',
    title: [name ? `浏览器 Agent：${name}` : '', platform ? `平台：${platform}` : '', id ? `ID：${id}` : ''].filter(Boolean).join('；') || '浏览器 Agent 已连接',
  }
})

const syncedMcpText = computed(() => {
  if (!props.agent.enabled) return 'AI 已停止'
  const activeCalling = props.agent.runtimeStatus === 'running'
    || (props.agent.currentTaskStatus === 'running' && !!props.agent.runtimeTool)
  if (activeCalling) {
    return props.agent.runtimeTool ? `MCP 调用中: ${props.agent.runtimeTool}` : 'MCP 调用中: 等待返回'
  }
  if (props.agent.runtimeStatus === 'error') return 'MCP 调用失败'
  return props.agent.runtimeTool ? `最近 MCP: ${props.agent.runtimeTool}` : '最近 MCP: 暂无调用'
})

const IDLE_THINKING_TEXT = '空闲中'
const thinkingPreview = ref(IDLE_THINKING_TEXT)

const thinkingViewportRef = ref<HTMLElement | null>(null)
const thinkingTextRef = ref<HTMLElement | null>(null)
let thinkingRaf = 0
let thinkingOffset = 0
let thinkingIdleTimer = 0
let lastLiveThinking = ''

const stopThinkingMotion = () => {
  if (thinkingRaf) {
    window.cancelAnimationFrame(thinkingRaf)
    thinkingRaf = 0
  }
}

const clearThinkingIdleTimer = () => {
  if (thinkingIdleTimer) {
    window.clearTimeout(thinkingIdleTimer)
    thinkingIdleTimer = 0
  }
}

const thinkingScrollSpeed = (textLength: number, maxScroll: number) => {
  const lengthFactor = Math.min(3.0, Math.max(0, textLength / 220))
  const distanceFactor = Math.min(3.5, Math.max(0, maxScroll / 180))
  return 0.8 + lengthFactor + distanceFactor
}

const stepThinkingMotion = () => {
  const viewport = thinkingViewportRef.value
  const text = thinkingTextRef.value
  if (!viewport || !text) return
  const maxScroll = Math.max(0, text.scrollHeight - viewport.clientHeight)
  if (maxScroll <= 1) {
    thinkingOffset = 0
    viewport.scrollTop = 0
    return
  }

  const speed = thinkingScrollSpeed(thinkingPreview.value.length, maxScroll)
  thinkingOffset = Math.min(maxScroll, thinkingOffset + speed)
  viewport.scrollTop = thinkingOffset

  if (thinkingOffset >= maxScroll - 0.5) {
    stopThinkingMotion()
    return
  }

  thinkingRaf = window.requestAnimationFrame(stepThinkingMotion)
}

const startThinkingMotion = (reset = true) => {
  stopThinkingMotion()
  const viewport = thinkingViewportRef.value
  const text = thinkingTextRef.value
  if (!viewport || !text) return

  const maxScroll = Math.max(0, text.scrollHeight - viewport.clientHeight)
  thinkingOffset = reset
    ? 0
    : Math.max(0, Math.min(viewport.scrollTop, maxScroll))
  viewport.scrollTop = thinkingOffset
  if (maxScroll <= 1) return
  thinkingRaf = window.requestAnimationFrame(stepThinkingMotion)
}

const showIdleThinking = async () => {
  thinkingPreview.value = IDLE_THINKING_TEXT
  lastLiveThinking = ''
  await nextTick()
  stopThinkingMotion()
  const viewport = thinkingViewportRef.value
  thinkingOffset = 0
  if (viewport) viewport.scrollTop = 0
}

const scheduleIdleThinking = () => {
  clearThinkingIdleTimer()
  thinkingIdleTimer = window.setTimeout(() => {
    void showIdleThinking()
  }, 5000)
}

const syncThinkingFromLive = async () => {
  const liveThinking = String(props.agent.latestThinking || '').trim()
  if (!liveThinking) {
    scheduleIdleThinking()
    return
  }

  clearThinkingIdleTimer()
  const shouldContinue = !!lastLiveThinking
    && liveThinking.length >= lastLiveThinking.length
    && liveThinking.startsWith(lastLiveThinking)
  thinkingPreview.value = liveThinking
  await nextTick()
  if (shouldContinue) {
    const viewport = thinkingViewportRef.value
    const text = thinkingTextRef.value
    if (viewport && text) {
      const maxScroll = Math.max(0, text.scrollHeight - viewport.clientHeight)
      thinkingOffset = Math.max(0, Math.min(viewport.scrollTop, maxScroll))
    }
    if (!thinkingRaf) {
      startThinkingMotion(false)
    }
  } else {
    startThinkingMotion(true)
  }
  lastLiveThinking = liveThinking
}

watch(
  () => props.agent.latestThinking,
  () => {
    void syncThinkingFromLive()
  }
)

onMounted(async () => {
  await nextTick()
  await syncThinkingFromLive()
})

onUnmounted(() => {
  stopThinkingMotion()
  clearThinkingIdleTimer()
})

const taskStatusLabel = (raw?: string) => {
  const status = String(raw || '').toLowerCase()
  if (status === 'running') return '执行中'
  if (status === 'queued' || status === 'paused') return '等待执行'
  if (status === 'scheduled' || status === 'next') return '定时等待'
  if (status === 'completed' || status === 'done' || status === 'finished') return '已完成'
  if (status === 'error' || status === 'stopped' || status === 'cancelled') return '已终止'
  return '待命'
}

const taskStatusClass = (raw?: string) => {
  const status = String(raw || '').toLowerCase()
  if (status === 'running') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-300'
  if (status === 'queued' || status === 'paused') return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-300'
  if (status === 'scheduled' || status === 'next') return 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/50 dark:bg-sky-500/10 dark:text-sky-300'
  if (status === 'completed' || status === 'done' || status === 'finished') return 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300'
  if (status === 'error' || status === 'stopped' || status === 'cancelled') return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/50 dark:bg-rose-500/10 dark:text-rose-300'
  return 'border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
}

const taskGenerationText = (task?: AgentTaskSnapshot | null) => {
  if (!task) return '第1代 / 共1代'
  const latest = Math.max(1, Number(task.latestGeneration) || 1)
  const total = Math.max(1, Number(task.generationCount) || 1)
  return `第${latest}代 / 共${total}代`
}

const taskTotalGenerations = (task?: AgentTaskSnapshot | null) => {
  if (!task) return 1
  return Math.max(1, Number(task.generationCount) || 1)
}

const DOUBLE_TAP_DELAY = 320
let lastTouchTapAt = 0

const isInteractiveCardTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return !!element?.closest('button,a,input,textarea,select,label,[role="button"],[data-card-action]')
}

const formatTaskSchedule = (task?: AgentTaskSnapshot | null) => {
  if (!task) return ''
  const parts: string[] = []
  if (task.scheduleAt) {
    const date = new Date(task.scheduleAt * 1000)
    if (!Number.isNaN(date.getTime())) {
      parts.push(`时间: ${date.toLocaleString()}`)
    }
  }
  if (task.scheduleLoopEnabled) parts.push('循环')
  if (task.scheduleDurationMinutes) parts.push(`${task.scheduleDurationMinutes}分钟`)
  return parts.join(' · ')
}

const onCardDblClick = (event: MouseEvent) => {
  if (isInteractiveCardTarget(event.target)) {
    return
  }
  emit('chat', props.agent)
}

const onCardPointerUp = (event: PointerEvent) => {
  if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
  if (isInteractiveCardTarget(event.target)) return

  const now = Date.now()
  if (now - lastTouchTapAt > DOUBLE_TAP_DELAY) {
    lastTouchTapAt = now
    return
  }

  lastTouchTapAt = 0
  emit('chat', props.agent)
}
</script>

<template>
  <div 
    class="agent-card-shell relative bg-white rounded-xl p-4 transition-all duration-300 border shadow-sm hover:shadow-lg hover:-translate-y-1 w-full min-w-0 dark:bg-zinc-900/90 dark:border-zinc-700/50 backdrop-blur-sm group cursor-pointer touch-manipulation"
    :class="[cardBorderClass, cardGlowClass]"
    @contextmenu.prevent="emit('context', { agent, x: $event.clientX, y: $event.clientY })"
    @dblclick="onCardDblClick"
    @pointerup="onCardPointerUp"
  >
    <!-- 角色徽章 -->
    <div
      v-if="roleBadge"
      class="absolute top-2 right-12 text-xs px-2 py-1 rounded-full border shadow-sm flex items-center gap-1 z-20"
      :class="roleBadge.class"
    >
      <span>{{ roleBadge.icon }}</span> {{ roleBadge.text }}
    </div>

    <!-- 头部信息 -->
    <div class="flex justify-between items-start mb-3">
      <div class="min-w-0 flex-1 pr-2">
        <h3 class="font-bold text-zinc-900 flex items-center gap-2 text-base dark:text-zinc-100 group-hover:text-indigo-600 transition-colors min-w-0">
          <span class="truncate">{{ agent.name }}</span>
          <span class="text-xs font-normal text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-400">
            第 {{ syncedGeneration }} 代
          </span>
          <span
            class="min-w-0 inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-xs font-normal text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
            :title="agent.platform"
          >
            <span class="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" title="在线"></span>
            <span class="truncate">{{ agent.platform }}</span>
          </span>
        </h3>
        <div
          v-if="botConnection || desktopConnection || browserConnection"
          class="mt-2 flex flex-wrap items-center justify-start gap-1.5"
        >
          <span
            v-if="botConnection"
            class="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none"
            :class="botConnection.class"
            :title="botConnection.title"
          >
            {{ botConnection.text }}
          </span>
          <span
            v-if="desktopConnection"
            class="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none"
            :class="desktopConnection.class"
            :title="desktopConnection.title"
          >
            {{ desktopConnection.text }}
          </span>
          <span
            v-if="browserConnection"
            class="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none"
            :class="browserConnection.class"
            :title="browserConnection.title"
          >
            {{ browserConnection.text }}
          </span>
        </div>
      </div>
      <button
        v-if="canControl"
        class="w-7 h-7 rounded-full border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-indigo-300"
        title="AI 设置"
        @click.stop="emit('settings', agent)"
      >
        ⚙
      </button>
    </div>

    <!-- 状态标签 -->
    <div v-if="!isAssistantAdmin" class="mb-3 flex justify-between items-start gap-2 min-w-0">
      <div class="flex flex-wrap items-start gap-1.5 min-w-0">
        <span
          class="px-2 py-1 rounded text-xs font-medium border break-words"
          :class="statusDisplay.class"
        >
          {{ statusDisplay.text }}
        </span>
        <span
          v-if="showRecentUserChatBadge"
          class="px-2 py-1 rounded text-xs font-medium border border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300"
          title="最近 1 分钟内收到用户对话数据"
        >
          最近1分钟内用户沟通
        </span>
      </div>
      <span class="text-xs font-mono text-zinc-400 dark:text-zinc-500 shrink-0">ID: {{ agent.id.slice(-4) }}</span>
    </div>
    <div v-else class="mb-3 flex justify-end items-start gap-2 min-w-0">
      <span
        v-if="showRecentUserChatBadge"
        class="px-2 py-1 rounded text-xs font-medium border border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300"
        title="最近 1 分钟内收到用户对话数据"
      >
        最近1分钟内用户沟通
      </span>
      <span class="text-xs font-mono text-zinc-400 dark:text-zinc-500 shrink-0">ID: {{ agent.id.slice(-4) }}</span>
    </div>

    <!-- 生命条 / Token 消耗 -->
    <div v-if="showLifecycle" class="mb-4">
      <div class="flex justify-between text-xs text-zinc-600 mb-1.5 dark:text-zinc-300">
        <span class="font-medium">{{ isUnlimitedLife ? '对话模式 (Token 不设上限)' : '生命周期 (Token)' }}</span>
        <span class="font-mono">{{ isUnlimitedLife ? `${Math.floor(agent.tokensUsed)} / 无上限` : `${Math.floor(agent.tokensUsed)} / ${agent.tokenLimit}` }}</span>
      </div>
      <div class="w-full bg-zinc-100 rounded-full h-2 overflow-hidden border border-zinc-100 dark:bg-zinc-800 dark:border-zinc-700">
        <div 
          class="h-full rounded-full transition-all duration-700 ease-out" 
          :class="lifeColorClass" 
          :style="{ width: `${lifePercentage}%` }"
        ></div>
      </div>
    </div>

    <!-- 当前任务/行为 -->
    <div class="bg-zinc-50/80 p-3 rounded-lg border border-zinc-100 text-xs text-zinc-700 min-h-[3.5rem] relative group dark:bg-zinc-800/80 dark:border-zinc-700 dark:text-zinc-300">
      <div class="absolute top-0 left-0 w-1 h-full rounded-l-lg" 
        :class="isRealtimeWorking ? 'bg-indigo-400' : 'bg-zinc-300'">
      </div>
      <span class="font-semibold block mb-1 text-zinc-900 pl-2 dark:text-zinc-100">实时状态:</span>
      <p class="pl-2 leading-relaxed text-zinc-600 dark:text-zinc-400">
        {{ syncedMcpText }}
      </p>
      <div
        ref="thinkingViewportRef"
        class="pl-2 leading-relaxed text-zinc-500 dark:text-zinc-400 mt-1 task-thinking-viewport"
        :title="thinkingPreview"
      >
        <p ref="thinkingTextRef" class="task-thinking-content">
          思考: {{ thinkingPreview }}
        </p>
      </div>
      <div v-if="showTaskSnapshotBlock" class="mt-2 pl-2 space-y-1.5">
        <div
          v-if="taskSnapshotDisplay"
          class="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/50 p-2"
        >
          <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">{{ taskSnapshotDisplay.label }}</div>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xs font-medium text-zinc-800 dark:text-zinc-100 truncate">{{ taskSnapshotDisplay.task.title }}</div>
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                {{ taskSnapshotDisplay.isCurrent ? `代数: ${taskGenerationText(taskSnapshotDisplay.task)}` : `总共代数: ${taskTotalGenerations(taskSnapshotDisplay.task)}` }}
              </div>
            </div>
            <button
              class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 transition-colors dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              @click.stop="taskSnapshotDisplay.task.jobId
                ? emit('show-task-detail', { agent, jobId: taskSnapshotDisplay.task.jobId })
                : emit('show-tasks', agent)"
            >
              对话详情
            </button>
          </div>
          <div
            v-if="taskSnapshotDisplay.isCurrent"
            class="mt-1.5 inline-flex text-[10px] px-1.5 py-0.5 rounded border"
            :class="taskStatusClass(taskSnapshotDisplay.task.effectiveStatus || taskSnapshotDisplay.task.status)"
          >
            {{ taskStatusLabel(taskSnapshotDisplay.task.effectiveStatus || taskSnapshotDisplay.task.status) }}
          </div>
        </div>

        <div
          v-for="task in scheduledTaskSnapshots"
          :key="task.jobId"
          class="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white/80 dark:bg-zinc-900/50 p-2"
        >
          <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">定时任务</div>
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xs font-medium text-zinc-800 dark:text-zinc-100 truncate">{{ task.title }}</div>
              <div class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                {{ formatTaskSchedule(task) || `代数: ${taskGenerationText(task)}` }}
              </div>
            </div>
            <span
              class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border"
              :class="taskStatusClass(task.effectiveStatus || task.status)"
            >
              {{ taskStatusLabel(task.effectiveStatus || task.status) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 (上帝干预) -->
    <div v-if="canControl && agent.status !== 'dead'" class="flex justify-end gap-2 mt-3 pt-2 border-t border-zinc-50 opacity-0 group-hover:opacity-100 transition-opacity dark:border-zinc-800">
      <button class="text-xs text-zinc-500 hover:text-indigo-600 px-2 py-1 hover:bg-zinc-50 rounded transition-colors dark:text-zinc-400 dark:hover:text-indigo-300 dark:hover:bg-zinc-800" @click.stop="emit('show-tools', agent)">
        查看 MCP
      </button>
      <button
        v-if="showWorkspaceContextButton"
        class="text-xs text-zinc-500 hover:text-indigo-600 px-2 py-1 hover:bg-zinc-50 rounded transition-colors dark:text-zinc-400 dark:hover:text-indigo-300 dark:hover:bg-zinc-800"
        @click.stop="emit('show-context', agent)"
      >
        读取目录
      </button>
      <button v-if="!isAssistantAdmin" class="text-xs text-zinc-500 hover:text-indigo-600 px-2 py-1 hover:bg-zinc-50 rounded transition-colors dark:text-zinc-400 dark:hover:text-indigo-300 dark:hover:bg-zinc-800" @click.stop="emit('show-tasks', agent)">
        任务列表
      </button>
      <button class="text-xs text-red-400 hover:text-red-600 px-2 py-1 hover:bg-red-50 rounded transition-colors dark:text-red-300 dark:hover:text-red-200 dark:hover:bg-red-500/10" @click.stop="emit('chat', agent)">
        与此 AI 对话
      </button>
    </div>
  </div>
</template>

<style scoped>
.agent-card-shell {
  isolation: isolate;
}

.agent-card-shell::before {
  content: "";
  position: absolute;
  inset: -4px;
  z-index: -1;
  border-radius: 1rem;
  background: transparent;
  border: 2px solid var(--agent-glow-color, rgba(99, 102, 241, 0.34));
  box-shadow: 0 0 16px var(--agent-glow-color, rgba(99, 102, 241, 0.34));
  filter: blur(7px);
  opacity: 0.42;
  transform: scale(0.985);
  animation: agent-card-glow-pulse 3.4s ease-in-out infinite;
  pointer-events: none;
}

.agent-card-shell:hover::before {
  opacity: 0.72;
  filter: blur(9px);
  box-shadow: 0 0 22px var(--agent-glow-color, rgba(99, 102, 241, 0.34));
  animation-duration: 2.2s;
}

.agent-card-glow-assistant {
  --agent-glow-color: rgba(139, 92, 246, 0.5);
}

.agent-card-glow-manager {
  --agent-glow-color: rgba(245, 158, 11, 0.5);
}

.agent-card-glow-member {
  --agent-glow-color: rgba(14, 165, 233, 0.48);
}

.agent-card-glow-default {
  --agent-glow-color: rgba(99, 102, 241, 0.42);
}

.agent-card-glow-dead::before {
  opacity: 0.14;
  animation: none;
  --agent-glow-color: rgba(113, 113, 122, 0.32);
}

@keyframes agent-card-glow-pulse {
  0%, 100% {
    opacity: 0.32;
    transform: scale(0.985);
  }

  50% {
    opacity: 0.66;
    transform: scale(1.018);
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-card-shell::before {
    animation: none;
  }
}

.task-thinking-viewport {
  min-height: 4.25em;
  max-height: 4.25em;
  overflow: hidden;
}

.task-thinking-content {
  word-break: break-word;
  white-space: pre-wrap;
}
</style>
