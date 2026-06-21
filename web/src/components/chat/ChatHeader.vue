<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface Session {
  id: string
  name: string
  totalTokens?: number
  forwardToBot?: boolean
}

interface SessionMeta extends Session {
  isTask: boolean
  /** Display label for task rows (task title without the "任务:" prefix). */
  taskTitle: string
}

const props = defineProps<{
  currentSessionId: string
  sessionList: Session[]
}>()

const emit = defineEmits<{
  (e: 'change', sessionId: string): void
  (e: 'create'): void
  (e: 'delete', sessionId: string): void
  (e: 'batchDelete', sessionIds: string[]): void
  (e: 'rename', sessionId: string): void
  (e: 'toggleForward', payload: { sessionId: string; enabled: boolean }): void
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const normalGroupOpen = ref(true)
const taskGroupOpen = ref(true)
const selectedSessionIds = ref<Set<string>>(new Set())
const contextMenu = ref({ visible: false, x: 0, y: 0 })

// A session is a task conversation when its id uses the task-runtime prefix
// (the authoritative signal); fall back to the legacy "任务:" name prefix.
const parseSession = (session: Session): SessionMeta => {
  const id = String(session.id || '')
  const name = String(session.name || '').trim()
  const isTaskById = id.startsWith('session_task_')
  const nameMatch = name.match(/^任务[:：]\s*(.+)$/)
  const isTask = isTaskById || !!nameMatch
  let taskTitle = ''
  if (isTask) {
    taskTitle = String(nameMatch?.[1] || name || '').trim() || '未命名任务'
  }
  return { ...session, isTask, taskTitle }
}

const sessionMetaList = computed<SessionMeta[]>(() => props.sessionList.map(parseSession))
const normalSessions = computed<SessionMeta[]>(() => sessionMetaList.value.filter(item => !item.isTask))
const taskSessions = computed<SessionMeta[]>(() => sessionMetaList.value.filter(item => item.isTask))
const sumTokens = (rows: SessionMeta[]) => rows.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0)
const normalSessionsTokenTotal = computed(() => sumTokens(normalSessions.value))
const taskSessionsTokenTotal = computed(() => sumTokens(taskSessions.value))

const currentSessionName = computed(() => {
  const row = props.sessionList.find(item => item.id === props.currentSessionId)
  return row?.name || '选择对话'
})

const sessionLineLabel = (session: SessionMeta) => {
  if (session.isTask) return session.taskTitle || session.name || '未命名任务'
  return session.name || '未命名会话'
}

const isSessionSelected = (sessionId: string) => selectedSessionIds.value.has(sessionId)

const toggleSessionSelection = (sessionId: string) => {
  const next = new Set(selectedSessionIds.value)
  if (next.has(sessionId)) next.delete(sessionId)
  else next.add(sessionId)
  selectedSessionIds.value = next
  contextMenu.value.visible = false
}

const clearSessionSelection = () => {
  selectedSessionIds.value = new Set()
  contextMenu.value.visible = false
}

const onSessionClick = (sessionId: string, event: MouseEvent) => {
  if (event.ctrlKey || event.metaKey) {
    toggleSessionSelection(sessionId)
    return
  }
  emit('change', sessionId)
  clearSessionSelection()
  open.value = false
}

const onSessionContextMenu = (sessionId: string, event: MouseEvent) => {
  event.preventDefault()
  if (!selectedSessionIds.value.has(sessionId)) {
    selectedSessionIds.value = new Set([sessionId])
  }
  contextMenu.value = { visible: true, x: event.clientX, y: event.clientY }
}

const deleteSelectedSessions = () => {
  const ids = Array.from(selectedSessionIds.value)
  if (ids.length === 0) return
  emit('batchDelete', ids)
  clearSessionSelection()
  open.value = false
}

const applyDefaultExpansion = () => {
  // Show whichever sections have content; keep both open by default.
  normalGroupOpen.value = normalSessions.value.length > 0 || taskSessions.value.length === 0
  taskGroupOpen.value = taskSessions.value.length > 0
}

const toggleOpen = () => {
  open.value = !open.value
  if (open.value) applyDefaultExpansion()
  else clearSessionSelection()
}

const onDocumentClick = (event: MouseEvent) => {
  if (!open.value) return
  if (!rootRef.value) return
  if (rootRef.value.contains(event.target as Node)) return
  open.value = false
  clearSessionSelection()
}

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))
</script>

<template>
  <div ref="rootRef" class="relative flex items-center gap-2 min-w-0">
    <button
      class="min-w-[140px] sm:min-w-[200px] max-w-[260px] sm:max-w-[320px] px-2 sm:px-3 py-1.5 sm:py-2 text-xs rounded-lg border border-zinc-200 bg-white/90 text-zinc-700 dark:bg-zinc-800/80 dark:border-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-2 overflow-hidden"
      @click="toggleOpen"
    >
      <span class="truncate text-left min-w-0">{{ currentSessionName }}</span>
      <span class="shrink-0 text-zinc-400">▾</span>
    </button>

    <div v-if="open" class="absolute left-0 top-[calc(100%+6px)] z-20 w-[320px] max-w-[88vw] sm:w-[420px] rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-700 shadow-lg p-2 overflow-hidden">
      <div class="max-h-72 overflow-y-auto overflow-x-hidden space-y-2">
        <!-- 普通对话：在此栏目下创建对话 -->
        <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-800/40">
          <button
            class="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200"
            @click="normalGroupOpen = !normalGroupOpen"
          >
            <span class="truncate">普通对话 ({{ normalSessions.length }})</span>
            <span class="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">Token: {{ normalSessionsTokenTotal }}</span>
          </button>
          <div v-if="normalGroupOpen" class="px-1 pb-1 space-y-1">
            <button
              class="w-full px-2 py-1.5 text-left text-xs rounded border border-dashed border-zinc-300 text-zinc-600 bg-white/60 hover:border-emerald-300 hover:text-emerald-600 dark:border-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-300 dark:hover:text-emerald-300"
              @click="emit('create'); open = false"
            >
              + 新建对话
            </button>
            <div
              v-for="session in normalSessions"
              :key="session.id"
              class="flex items-center gap-1 px-2 py-1.5 rounded border min-w-0"
              :class="[
                session.id === currentSessionId
                  ? 'border-emerald-300/70 bg-emerald-50/45 dark:border-emerald-500/35 dark:bg-emerald-500/10'
                  : 'border-emerald-200/60 bg-emerald-50/25 dark:border-emerald-700/35 dark:bg-emerald-500/5',
                isSessionSelected(session.id) ? 'ring-2 ring-zinc-400/40 dark:ring-zinc-500/50' : ''
              ]"
              @contextmenu="onSessionContextMenu(session.id, $event)"
            >
              <button
                class="min-w-0 flex-1 text-left text-xs truncate text-emerald-900/85 dark:text-emerald-100/85"
                @click="onSessionClick(session.id, $event)"
              >
                {{ sessionLineLabel(session) }}
              </button>
              <span class="shrink-0 text-[10px] text-emerald-700/60 dark:text-emerald-300/70">Token: {{ session.totalTokens || 0 }}</span>
              <button
                class="shrink-0 text-[11px] px-2 py-0.5 rounded border"
                :class="session.forwardToBot
                  ? 'border-sky-300 text-sky-600 bg-sky-50/60 dark:border-sky-500/40 dark:text-sky-300 dark:bg-sky-900/20'
                  : 'border-zinc-200 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500'"
                :title="session.forwardToBot ? '机器人会回复此对话，点击关闭' : '机器人不回复此对话，点击开启'"
                @click.stop="emit('toggleForward', { sessionId: session.id, enabled: !session.forwardToBot })"
              >
                {{ session.forwardToBot ? '机器人✓' : '机器人✗' }}
              </button>
              <button
                class="shrink-0 text-[11px] px-2 py-0.5 rounded border border-emerald-300/60 text-emerald-700/80 hover:bg-emerald-50/50 dark:border-emerald-600/50 dark:text-emerald-300/80 dark:hover:bg-emerald-900/10"
                @click="emit('rename', session.id)"
              >
                编辑
              </button>
              <button
                class="shrink-0 text-[11px] px-2 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-900/20"
                @click="emit('delete', session.id)"
              >
                删除
              </button>
            </div>
            <div
              v-if="normalSessions.length === 0"
              class="px-2 py-2 text-center text-[11px] text-zinc-400 dark:text-zinc-500"
            >
              还没有普通对话，点上方新建一个
            </div>
          </div>
        </div>

        <!-- 任务：存放全部任务对话记录 -->
        <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-800/40">
          <button
            class="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200"
            @click="taskGroupOpen = !taskGroupOpen"
          >
            <span class="truncate">任务 ({{ taskSessions.length }})</span>
            <span class="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">Token: {{ taskSessionsTokenTotal }}</span>
          </button>
          <div v-if="taskGroupOpen" class="px-1 pb-1 space-y-1">
            <div
              v-for="session in taskSessions"
              :key="session.id"
              class="flex items-center gap-1 px-2 py-1.5 rounded border min-w-0"
              :class="[
                session.id === currentSessionId
                  ? 'border-indigo-300/70 bg-indigo-50/45 dark:border-indigo-500/35 dark:bg-indigo-500/10'
                  : 'border-indigo-200/60 bg-indigo-50/25 dark:border-indigo-700/35 dark:bg-indigo-500/5',
                isSessionSelected(session.id) ? 'ring-2 ring-zinc-400/40 dark:ring-zinc-500/50' : ''
              ]"
              @contextmenu="onSessionContextMenu(session.id, $event)"
            >
              <span class="shrink-0 rounded bg-indigo-100 px-1 text-[10px] text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">任务</span>
              <button
                class="min-w-0 flex-1 text-left text-xs truncate text-indigo-900/85 dark:text-indigo-100/85"
                @click="onSessionClick(session.id, $event)"
              >
                {{ sessionLineLabel(session) }}
              </button>
              <span class="shrink-0 text-[10px] text-indigo-700/60 dark:text-indigo-300/70">Token: {{ session.totalTokens || 0 }}</span>
              <button
                class="shrink-0 text-[11px] px-2 py-0.5 rounded border border-indigo-300/60 text-indigo-700/80 hover:bg-indigo-50/50 dark:border-indigo-600/50 dark:text-indigo-300/80 dark:hover:bg-indigo-900/10"
                @click="emit('rename', session.id)"
              >
                编辑
              </button>
              <button
                class="shrink-0 text-[11px] px-2 py-0.5 rounded border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-900/20"
                @click="emit('delete', session.id)"
              >
                删除
              </button>
            </div>
            <div
              v-if="taskSessions.length === 0"
              class="px-2 py-2 text-center text-[11px] text-zinc-400 dark:text-zinc-500"
            >
              暂无任务对话记录
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="contextMenu.visible"
      class="fixed z-[80] min-w-[150px] rounded-lg border border-zinc-200 bg-white py-1 text-xs text-zinc-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <button
        class="w-full px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
        @click="deleteSelectedSessions"
      >
        删除选中 {{ selectedSessionIds.size }} 项
      </button>
    </div>
  </div>
</template>
