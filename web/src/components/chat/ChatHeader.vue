<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface Session {
  id: string
  name: string
  totalTokens?: number
}

interface SessionMeta extends Session {
  isTask: boolean
  taskTitle: string
  generation: number | null
}

interface TaskSessionGroup {
  key: string
  title: string
  sessions: SessionMeta[]
  totalTokens: number
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
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const normalGroupOpen = ref(true)
const expandedTaskGroupKeys = ref<Set<string>>(new Set())
const selectedSessionIds = ref<Set<string>>(new Set())
const contextMenu = ref({ visible: false, x: 0, y: 0 })

const parseTaskSessionName = (name: string) => {
  const raw = String(name || '').trim()
  if (!raw) {
    return { isTask: false, taskTitle: '', generation: null as number | null }
  }
  const taskPrefix = raw.match(/^任务[:：]\s*(.+)$/)
  if (!taskPrefix) {
    return { isTask: false, taskTitle: '', generation: null as number | null }
  }
  const body = String(taskPrefix[1] || '').trim()
  if (!body) {
    return { isTask: true, taskTitle: '未命名任务', generation: null as number | null }
  }
  const generationMatch = body.match(/^(.*?)\s*·\s*第\s*(\d+)\s*代$/)
  if (!generationMatch) {
    return { isTask: true, taskTitle: body, generation: null as number | null }
  }
  const title = String(generationMatch[1] || '').trim() || '未命名任务'
  const generation = Number(generationMatch[2] || 0)
  return {
    isTask: true,
    taskTitle: title,
    generation: Number.isFinite(generation) && generation > 0 ? generation : null,
  }
}

const toSessionMeta = (session: Session): SessionMeta => {
  const parsed = parseTaskSessionName(session.name)
  return {
    ...session,
    isTask: parsed.isTask,
    taskTitle: parsed.taskTitle,
    generation: parsed.generation,
  }
}

const sessionMetaList = computed<SessionMeta[]>(() => props.sessionList.map(toSessionMeta))
const normalSessions = computed<SessionMeta[]>(() => sessionMetaList.value.filter(item => !item.isTask))
const normalSessionsTokenTotal = computed(() =>
  normalSessions.value.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0)
)
const taskSessionGroups = computed<TaskSessionGroup[]>(() => {
  const map = new Map<string, TaskSessionGroup>()
  for (const session of sessionMetaList.value) {
    if (!session.isTask) continue
    const groupKey = `task:${session.taskTitle}`
    const found = map.get(groupKey)
    if (!found) {
      map.set(groupKey, {
        key: groupKey,
        title: session.taskTitle || '未命名任务',
        sessions: [session],
        totalTokens: Number(session.totalTokens || 0),
      })
      continue
    }
    found.sessions.push(session)
    found.totalTokens += Number(session.totalTokens || 0)
  }
  return Array.from(map.values())
})

const groupKeyOfSession = (session: SessionMeta) => `task:${session.taskTitle}`

const currentSessionName = computed(() => {
  const row = props.sessionList.find(item => item.id === props.currentSessionId)
  return row?.name || '选择对话'
})

const sessionLineLabel = (session: SessionMeta) => {
  if (!session.isTask) return session.name || '未命名会话'
  if (session.generation) return `第${session.generation}代`
  return session.name || '未命名任务会话'
}

const toggleTaskGroup = (groupKey: string) => {
  const next = new Set(expandedTaskGroupKeys.value)
  if (next.has(groupKey)) next.delete(groupKey)
  else next.add(groupKey)
  expandedTaskGroupKeys.value = next
}

const isTaskGroupExpanded = (groupKey: string) => expandedTaskGroupKeys.value.has(groupKey)
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
  if (normalSessions.value.length > 0) {
    normalGroupOpen.value = true
    expandedTaskGroupKeys.value = new Set()
    return
  }
  normalGroupOpen.value = false
  const next = new Set<string>()
  const current = sessionMetaList.value.find(item => item.id === props.currentSessionId && item.isTask)
  if (current) {
    next.add(groupKeyOfSession(current))
  } else if (taskSessionGroups.value.length > 0) {
    next.add(taskSessionGroups.value[0].key)
  }
  expandedTaskGroupKeys.value = next
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
  <div ref="rootRef" class="relative flex items-center gap-2">
    <button
      class="min-w-[220px] max-w-[320px] px-3 py-2 text-xs rounded-lg border border-zinc-200 bg-white/90 text-zinc-700 dark:bg-zinc-800/80 dark:border-zinc-700 dark:text-zinc-200 flex items-center justify-between gap-2"
      @click="toggleOpen"
    >
      <span class="truncate text-left">{{ currentSessionName }}</span>
      <span class="text-zinc-400">▾</span>
    </button>

    <div v-if="open" class="absolute left-0 top-[calc(100%+6px)] z-20 w-[420px] max-w-[88vw] rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-700 shadow-lg p-2">
      <button
        class="w-full mb-2 px-2 py-1.5 text-left text-xs rounded border border-zinc-200 text-zinc-600 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300"
        @click="emit('create'); open = false"
      >
        + 新建对话
      </button>

      <div class="max-h-72 overflow-y-auto space-y-2">
        <div
          v-if="normalSessions.length > 0"
          class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-800/40"
        >
          <button
            class="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200"
            @click="normalGroupOpen = !normalGroupOpen"
          >
            <span class="truncate">普通对话 ({{ normalSessions.length }})</span>
            <span class="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">Token: {{ normalSessionsTokenTotal }}</span>
          </button>
          <div v-if="normalGroupOpen" class="px-1 pb-1 space-y-1">
            <div
              v-for="session in normalSessions"
              :key="session.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded border"
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
          </div>
        </div>

        <div
          v-for="group in taskSessionGroups"
          :key="group.key"
          class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/80 dark:bg-zinc-800/40"
        >
          <button
            class="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-zinc-700 dark:text-zinc-200"
            @click="toggleTaskGroup(group.key)"
          >
            <span class="truncate">任务: {{ group.title }} ({{ group.sessions.length }})</span>
            <span class="shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">Token: {{ group.totalTokens }}</span>
          </button>
          <div v-if="isTaskGroupExpanded(group.key)" class="px-1 pb-1 space-y-1">
            <div
              v-for="session in group.sessions"
              :key="session.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded border"
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
          </div>
        </div>

        <div
          v-if="normalSessions.length === 0 && taskSessionGroups.length === 0"
          class="text-xs text-zinc-500 dark:text-zinc-400 px-2 py-4 text-center border border-zinc-200 dark:border-zinc-700 rounded-lg"
        >
          暂无会话
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
