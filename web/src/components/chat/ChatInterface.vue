<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMessage } from '../../composables/useMessage'
import ChatHeader from './ChatHeader.vue'
import ChatConversationView from './ChatConversationView.vue'
import ChatInput from './ChatInput.vue'
import { parseChatResponseInline, type ActionBlock, type InlineContent as InlineContentType } from '../../utils/chatParser'

const { alert, confirm, prompt } = useMessage()

interface ChatMessage {
  id?: number
  role: 'user' | 'assistant' | 'system'
  content: string
  think?: string
  tags?: string
  created_at?: number
  session_id?: string
  session_name?: string
  model?: string
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  system_prompt?: string
  finish_reason?: string
  latency?: number
  blocks?: ActionBlock[]
  inlineContent?: InlineContentType[]
  display_text?: string
}

interface SessionItem {
  id: string
  name: string
  totalTokens?: number
}

interface PersistedBlockState {
  applied?: boolean
  result?: string
}

interface PersistedMessageActionState {
  blocks?: Record<string, PersistedBlockState>
  signatures?: Record<string, PersistedBlockState>
}

interface Props {
  adminModel?: string
  aiConfigId?: number
  aiKind?: 'assistant' | 'core'
  mcpAutoApprove?: boolean
  selectedFiles: string[]
  allFiles: string[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:selectedFiles', value: string[]): void
  (e: 'refreshFiles'): void
  (e: 'totalChatTokensUpdate', value: number): void
  (e: 'open-settings'): void
}>()
const aiKindValue = computed(() => props.aiKind || 'assistant')

const isFileSelectorOpen = ref(false)
const currentPath = ref('')
const chatInput = ref('')
const chatMessages = ref<ChatMessage[]>([])
const isTyping = ref(false)
const currentRunId = ref('')
const currentRunStatus = ref<'idle' | 'queued' | 'running' | 'completed' | 'error' | 'stopped'>('idle')
const currentRunPhase = ref<'idle' | 'generating' | 'waiting_mcp'>('idle')
const currentMcpTool = ref('')
const liveAssistantText = ref('')
const liveTargetText = ref('')
const liveCursor = ref(0)
let runLivePollTimer: number | null = null
let runHistoryPollTimer: number | null = null
let liveTypingFrame: number | null = null
let liveRenderLength = 0
let liveRenderVelocity = 0
let liveLastFrameTs = 0
let liveLastScrollTs = 0
let runPollEpoch = 0
let lastRealtimeTokenSyncAt = 0
const chatScrollRef = ref<HTMLElement | null>(null)
const currentSessionId = ref<string>('')
const sessionList = ref<SessionItem[]>([])
const appliedEdits = ref<Set<string>>(new Set())
const appliedSignatures = ref<Set<string>>(new Set())
const undoActions = ref<Record<string, { tool: string; arguments: Record<string, any> }>>({})
const actionResults = ref<Record<string, string>>({})
const actionResultsBySignature = ref<Record<string, string>>({})
const appliedEditsArray = computed(() => Array.from(appliedEdits.value))
const appliedSignaturesArray = computed(() => Array.from(appliedSignatures.value))
const isRunActive = computed(() => ['queued', 'running'].includes(currentRunStatus.value))
const runStatusText = computed(() => {
  if (!isRunActive.value) return ''
  if (currentRunPhase.value === 'waiting_mcp') {
    return currentMcpTool.value ? `等待 MCP: ${currentMcpTool.value}` : '等待 MCP 返回'
  }
  return '后端流式生成中'
})
const STATE_PREFIX = '__HS_MCP_STATE__='

const normalizedAllFiles = computed(() => props.allFiles.map(file => file.replace(/\\/g, '/')))
const normalizedSelectedFiles = computed(() => props.selectedFiles.map(file => file.replace(/\\/g, '/')))

const isTaskSessionName = (name: string) => /^任务[:：]\s*/.test(String(name || '').trim())

const pickPreferredSessionId = (items: SessionItem[]) => {
  if (!Array.isArray(items) || items.length === 0) return ''
  const normal = items.find(item => !isTaskSessionName(item.name || ''))
  return normal?.id || items[0].id
}

const queryForAi = (extra: Record<string, string> = {}) => {
  const query: Record<string, string> = { ai_kind: aiKindValue.value, ...extra }
  if (props.aiConfigId !== undefined) query.ai_config_id = String(props.aiConfigId)
  return new URLSearchParams(query).toString()
}

const splitTags = (raw?: string) => {
  const text = String(raw || '')
  const idx = text.indexOf(STATE_PREFIX)
  if (idx < 0) return { base: text.trim(), encoded: '' }
  const base = text.slice(0, idx).replace(/\s*\|\s*$/, '').trim()
  const encoded = text.slice(idx + STATE_PREFIX.length).trim()
  return { base, encoded }
}

const stableStringify = (value: any): string => {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

const simpleHash = (input: string) => {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i)
    hash |= 0
  }
  return String(hash >>> 0)
}

const blockSignature = (block: ActionBlock) => {
  const raw = [
    block.type || '',
    block.tool || '',
    block.filename || '',
    block.command || '',
    block.search || '',
    block.replace || '',
    block.content || '',
    stableStringify(block.arguments || {}),
  ].join('|')
  return `sig_${simpleHash(raw)}`
}

const decodeStateFromTags = (raw?: string): PersistedMessageActionState | null => {
  const { encoded } = splitTags(raw)
  if (!encoded) return null
  try {
    const decoded = decodeURIComponent(encoded)
    const parsed = JSON.parse(decoded)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

const encodeTagsWithState = (baseTags: string, state: PersistedMessageActionState | null) => {
  const base = (baseTags || '').trim()
  if (!state?.blocks || Object.keys(state.blocks).length === 0) return base
  const encoded = encodeURIComponent(JSON.stringify(state))
  return base ? `${base} | ${STATE_PREFIX}${encoded}` : `${STATE_PREFIX}${encoded}`
}

const collectMessageState = (msg: ChatMessage): PersistedMessageActionState | null => {
  if (!msg.blocks || msg.blocks.length === 0) return null
  const blocks: Record<string, PersistedBlockState> = {}
  const signatures: Record<string, PersistedBlockState> = {}
  for (const block of msg.blocks) {
    const sig = blockSignature(block)
    const applied = appliedEdits.value.has(block.id) || appliedSignatures.value.has(sig)
    const result = actionResults.value[block.id] || actionResultsBySignature.value[sig]
    if (!applied && !result) continue
    const state = { applied, result }
    blocks[block.id] = state
    signatures[sig] = state
  }
  if (Object.keys(blocks).length === 0) return null
  return { blocks, signatures }
}

const persistMessageActionState = async (msg: ChatMessage) => {
  if (!msg.id) return
  const token = localStorage.getItem('token')
  if (!token) return
  const { base } = splitTags(msg.tags)
  const nextTags = encodeTagsWithState(base, collectMessageState(msg))
  if ((msg.tags || '') === nextTags) return
  const res = await fetch(`/api/chat/${msg.id}/tags`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tags: nextTags }),
  })
  if (res.ok) msg.tags = nextTags
  else console.warn('persistMessageActionState failed', res.status)
}

const persistMessageActionStateWhenReady = (msg: ChatMessage, attempts = 12) => {
  if (msg.id) {
    void persistMessageActionState(msg)
    return
  }
  if (attempts <= 0) return
  setTimeout(() => persistMessageActionStateWhenReady(msg, attempts - 1), 250)
}

const restoreActionStatesFromHistory = (messages: ChatMessage[]) => {
  appliedEdits.value = new Set()
  appliedSignatures.value = new Set()
  actionResults.value = {}
  actionResultsBySignature.value = {}
  undoActions.value = {}
  for (const msg of messages) {
    const state = decodeStateFromTags(msg.tags)
    const blocks = state?.blocks || {}
    const sigStates = state?.signatures || {}
    const msgBlockBySig: Record<string, string[]> = {}
    for (const block of msg.blocks || []) {
      const sig = blockSignature(block)
      if (!msgBlockBySig[sig]) msgBlockBySig[sig] = []
      msgBlockBySig[sig].push(block.id)
    }
    for (const [blockId, blockState] of Object.entries(blocks)) {
      if (blockState?.applied) appliedEdits.value.add(blockId)
      if (typeof blockState?.result === 'string' && blockState.result.trim()) {
        actionResults.value[blockId] = blockState.result
        appliedEdits.value.add(blockId)
      }
    }
    for (const [sig, blockState] of Object.entries(sigStates)) {
      const resolvedIds = msgBlockBySig[sig] || []
      if (blockState?.applied) appliedSignatures.value.add(sig)
      if (typeof blockState?.result === 'string' && blockState.result.trim()) {
        actionResultsBySignature.value[sig] = blockState.result
      }
      if (resolvedIds.length === 0) continue
      for (const resolvedId of resolvedIds) {
        if (blockState?.applied) appliedEdits.value.add(resolvedId)
        if (typeof blockState?.result === 'string' && blockState.result.trim()) {
          actionResults.value[resolvedId] = blockState.result
          appliedEdits.value.add(resolvedId)
        }
      }
    }
  }
}

const navigateTo = (folder: string) => {
  currentPath.value = currentPath.value === '' ? folder : `${currentPath.value}/${folder}`
}
const navigateBack = () => {
  const parts = currentPath.value.split('/')
  currentPath.value = parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}
const toggleFileSelection = (file: string) => {
  const fullPath = currentPath.value === '' ? file : `${currentPath.value}/${file}`
  if (normalizedAllFiles.value.includes(fullPath + '/')) {
    navigateTo(file)
    return
  }
  const newSelected = [...normalizedSelectedFiles.value]
  const idx = newSelected.indexOf(fullPath)
  if (idx > -1) newSelected.splice(idx, 1)
  else newSelected.push(fullPath)
  emit('update:selectedFiles', newSelected)
}
const handleRefreshFiles = () => emit('refreshFiles')

const scrollToBottom = async () => {
  await nextTick()
  if (chatScrollRef.value) {
    chatScrollRef.value.scrollTop = chatScrollRef.value.scrollHeight
  }
}

const LIVE_MIN_SPEED = 36
const LIVE_MAX_SPEED = 560
const LIVE_DAMPING = 12
const LIVE_SPEED_GAIN = 58
const LIVE_SCROLL_INTERVAL_MS = 84
const LIVE_STICKY_GAP_PX = 120

const applyLiveAssistantText = (text: string) => {
  liveAssistantText.value = text
}

const maybeAutoScrollDuringLive = (ts: number) => {
  const el = chatScrollRef.value
  if (!el) return
  if (ts - liveLastScrollTs < LIVE_SCROLL_INTERVAL_MS) return
  liveLastScrollTs = ts
  const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight)
  if (distanceFromBottom <= LIVE_STICKY_GAP_PX) {
    el.scrollTop = el.scrollHeight
  }
}

const stopLiveTypingLoop = () => {
  if (liveTypingFrame !== null) {
    window.cancelAnimationFrame(liveTypingFrame)
    liveTypingFrame = null
  }
  liveRenderVelocity = 0
  liveLastFrameTs = 0
}

const runLiveTypingFrame = (ts: number) => {
  const target = liveTargetText.value || ''
  const current = liveAssistantText.value || ''
  const frameDt = liveLastFrameTs > 0 ? Math.min(0.05, (ts - liveLastFrameTs) / 1000) : 1 / 60
  liveLastFrameTs = ts

  if (!target) {
    applyLiveAssistantText('')
    liveRenderLength = 0
    stopLiveTypingLoop()
    return
  }

  if (!target.startsWith(current)) {
    // Full sync fallback for rare non-prefix updates from backend snapshots.
    applyLiveAssistantText(target)
    liveRenderLength = target.length
    liveRenderVelocity = 0
    stopLiveTypingLoop()
    maybeAutoScrollDuringLive(ts)
    return
  }

  if (liveRenderLength < current.length) liveRenderLength = current.length
  const distance = Math.max(0, target.length - liveRenderLength)
  if (distance <= 0.0001) {
    applyLiveAssistantText(target)
    liveRenderLength = target.length
    liveRenderVelocity = 0
    stopLiveTypingLoop()
    maybeAutoScrollDuringLive(ts)
    return
  }

  const desiredVelocity = Math.min(LIVE_MAX_SPEED, LIVE_MIN_SPEED + Math.sqrt(distance) * LIVE_SPEED_GAIN)
  const smoothing = 1 - Math.exp(-LIVE_DAMPING * frameDt)
  liveRenderVelocity += (desiredVelocity - liveRenderVelocity) * smoothing
  const advance = Math.max(0.2, liveRenderVelocity * frameDt)
  liveRenderLength = Math.min(target.length, liveRenderLength + advance)

  const nextLen = Math.max(0, Math.floor(liveRenderLength))
  if (nextLen !== current.length || current !== target.slice(0, nextLen)) {
    applyLiveAssistantText(target.slice(0, nextLen))
  }
  maybeAutoScrollDuringLive(ts)
  liveTypingFrame = window.requestAnimationFrame(runLiveTypingFrame)
}

const updateLiveAssistantView = (text: string) => {
  const nextTarget = text || ''
  liveTargetText.value = nextTarget

  if (!nextTarget) {
    liveRenderLength = 0
    applyLiveAssistantText('')
    stopLiveTypingLoop()
    return
  }

  const current = liveAssistantText.value
  if (!nextTarget.startsWith(current) || liveRenderLength > nextTarget.length) {
    // Backend may occasionally send full text snapshots. Keep UI text coherent first.
    applyLiveAssistantText(nextTarget)
    liveRenderLength = nextTarget.length
    liveRenderVelocity = 0
  }

  if (liveTypingFrame === null && liveAssistantText.value !== liveTargetText.value) {
    liveTypingFrame = window.requestAnimationFrame(runLiveTypingFrame)
  }
}

const clearLiveAssistantView = () => {
  applyLiveAssistantText('')
  liveTargetText.value = ''
  liveCursor.value = 0
  liveRenderLength = 0
  liveLastScrollTs = 0
  stopLiveTypingLoop()
}

const stopRunPolling = () => {
  runPollEpoch += 1
  if (runLivePollTimer !== null) window.clearTimeout(runLivePollTimer)
  if (runHistoryPollTimer !== null) window.clearTimeout(runHistoryPollTimer)
  runLivePollTimer = null
  runHistoryPollTimer = null
}

const upsertHistoryMessages = async (incoming: ChatMessage[]) => {
  if (!incoming.length) return
  const existingIds = new Set(chatMessages.value.map(m => m.id).filter(Boolean))
  const liveText = (liveTargetText.value || '').trim()
  for (const msg of incoming) {
    if (msg.id && existingIds.has(msg.id)) continue
    const normalizedMsgContent = String(msg.content || '').trim()
    if (liveText && msg.role === 'assistant' && normalizedMsgContent === liveText) {
      if (isRunActive.value) {
        // Running stage: keep a single live bubble, don't duplicate with persisted history.
        continue
      }
      if (liveAssistantText.value.trim()) {
        // End stage: persisted message arrived, clear live bubble first to avoid a visual flash.
        clearLiveAssistantView()
      }
    }
    if (msg.id && msg.role === 'assistant' && normalizedMsgContent) {
      const localIdx = chatMessages.value.findIndex(item =>
        !item.id
        && item.role === 'assistant'
        && String(item.content || '').trim() === normalizedMsgContent)
      if (localIdx >= 0) {
        chatMessages.value.splice(localIdx, 1)
      }
    }
    const parsed = parseChatResponseInline(msg.content)
    chatMessages.value.push({
      ...msg,
      display_text: parsed.displayText,
      think: msg.think || parsed.think,
      blocks: parsed.blocks,
      inlineContent: parsed.inlineContent,
    })
  }
  restoreActionStatesFromHistory(chatMessages.value)
  await scrollToBottom()
}

const getLastMessageId = () => {
  const ids = chatMessages.value.map(m => Number(m.id || 0)).filter(v => Number.isFinite(v) && v > 0)
  if (!ids.length) return 0
  return Math.max(...ids)
}

const hasAssistantMessageWithContent = (content: string) => {
  const normalized = String(content || '').trim()
  if (!normalized) return false
  return chatMessages.value.some(msg =>
    msg.role === 'assistant'
    && String(msg.content || '').trim() === normalized)
}

const appendLiveAssistantAsLocalMessage = async (text: string) => {
  const content = String(text || '')
  if (!content.trim()) return
  if (hasAssistantMessageWithContent(content)) return
  const parsed = parseChatResponseInline(content)
  chatMessages.value.push({
    role: 'assistant',
    content,
    created_at: Date.now(),
    display_text: parsed.displayText,
    think: parsed.think,
    blocks: parsed.blocks,
    inlineContent: parsed.inlineContent,
  })
  await scrollToBottom()
}

const waitMs = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

const loadSessions = async () => {
  const token = localStorage.getItem('token')
  if (!token) return
  const res = await fetch(`/api/chat/sessions?${queryForAi()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.ok) {
    const rows = await res.json()
    sessionList.value = (Array.isArray(rows) ? rows : []).map((row: any) => ({
      id: String(row?.id || ''),
      name: String(row?.name || '未命名会话'),
      totalTokens: Number(row?.total_tokens || 0),
    }))
    if (!currentSessionId.value && sessionList.value.length > 0) {
      currentSessionId.value = pickPreferredSessionId(sessionList.value)
    }
  }
}

const createSession = async (nameInput?: string) => {
  let name = nameInput
  if (!name) {
    name = await prompt({ message: '输入新对话名称:', placeholder: '例如: 需求拆解' }) || ''
  }
  if (!name.trim()) return
  const token = localStorage.getItem('token')
  if (!token) return
  const res = await fetch('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name,
      ai_config_id: props.aiConfigId,
      ai_kind: aiKindValue.value,
    }),
  })
  if (!res.ok) return
  const session = await res.json()
  await loadSessions()
  currentSessionId.value = session.id
  chatMessages.value = []
}

const createSessionFromButton = async () => {
  await createSession()
}

const deleteSession = async (sid: string) => {
  if (!(await confirm({ message: '确定删除这个对话记录吗？', type: 'warning' }))) return
  const token = localStorage.getItem('token')
  if (!token) return
  const res = await fetch(`/api/chat/sessions/${sid}?${queryForAi()}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return
  await loadSessions()
  if (currentSessionId.value === sid) {
    currentSessionId.value = pickPreferredSessionId(sessionList.value)
    if (currentSessionId.value) await loadChatHistory(currentSessionId.value)
    else chatMessages.value = []
  }
}

const renameSession = async (sid: string) => {
  const current = sessionList.value.find(item => item.id === sid)
  const name = (await prompt({
    message: '输入新的对话名称:',
    placeholder: current?.name || '未命名会话',
    defaultValue: current?.name || '',
  }) || '').trim()
  if (!name) return
  const token = localStorage.getItem('token')
  if (!token) return
  const res = await fetch(`/api/chat/sessions/${sid}?${queryForAi()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    alert({ message: '会话重命名失败', type: 'error' })
    return
  }
  await loadSessions()
}

const loadTotalTokens = async () => {
  const token = localStorage.getItem('token')
  if (!token) return 0
  const res = await fetch(`/api/chat/total-tokens?${queryForAi()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return 0
  const data = await res.json()
  emit('totalChatTokensUpdate', data.total_tokens || 0)
  return data.total_tokens || 0
}

const refreshTokensDuringRunIfNeeded = async (force = false) => {
  const now = Date.now()
  if (!force && now - lastRealtimeTokenSyncAt < 1000) return
  lastRealtimeTokenSyncAt = now
  await loadTotalTokens()
}

const loadChatHistory = async (sid: string) => {
  const token = localStorage.getItem('token')
  if (!token || !sid) return
  const res = await fetch(`/api/chat/history?${queryForAi({ session_id: sid })}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return
  const history = await res.json()
  chatMessages.value = history.map((msg: ChatMessage) => {
    const parsed = parseChatResponseInline(msg.content)
    return {
      ...msg,
      display_text: parsed.displayText,
      think: msg.think || parsed.think,
      blocks: parsed.blocks,
      inlineContent: parsed.inlineContent,
    }
  })
  restoreActionStatesFromHistory(chatMessages.value)
  currentSessionId.value = sid
  await loadTotalTokens()
  await scrollToBottom()
  await checkActiveRun()
}

const fetchRunHistoryIncrementalOnce = async () => {
  if (!currentSessionId.value) return
  const token = localStorage.getItem('token')
  if (!token) return
  const afterId = getLastMessageId()
  const historyRes = await fetch(`/api/chat/history?${queryForAi({ session_id: currentSessionId.value, after_id: String(afterId) })}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!historyRes.ok) return
  const incremental = await historyRes.json()
  await upsertHistoryMessages(incremental)
}

const ensureFinalAssistantMessage = async (epoch: number) => {
  const finalText = String(liveTargetText.value || '').trim()
  if (!finalText) return
  if (hasAssistantMessageWithContent(finalText)) return

  // Backend write and history visibility can lag slightly after run completes.
  for (let i = 0; i < 8; i += 1) {
    if (epoch !== runPollEpoch) return
    await waitMs(120)
    await fetchRunHistoryIncrementalOnce()
    if (hasAssistantMessageWithContent(finalText)) return
  }

  // Fallback: keep user-visible continuity even if history persistence is delayed.
  await appendLiveAssistantAsLocalMessage(liveTargetText.value)
}

const pollRunHistory = async (epoch: number) => {
  if (epoch !== runPollEpoch) return
  try {
    await fetchRunHistoryIncrementalOnce()
  } finally {
    if (epoch === runPollEpoch && isRunActive.value) {
      runHistoryPollTimer = window.setTimeout(() => { void pollRunHistory(epoch) }, 900)
    }
  }
}

const pollRunLive = async (epoch: number) => {
  if (epoch !== runPollEpoch) return
  if (!currentRunId.value) return
  const token = localStorage.getItem('token')
  if (!token) return
  try {
    const runRes = await fetch(`/api/chat/run/status/${currentRunId.value}?after=${liveCursor.value}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!runRes.ok) {
      currentRunStatus.value = 'error'
      isTyping.value = false
      clearLiveAssistantView()
      return
    }
    const run = await runRes.json()
    currentRunStatus.value = run.status || 'running'
    currentRunPhase.value = (run.live_phase || 'generating')
    currentMcpTool.value = String(run.current_tool || '')
    const delta = String(run.live_delta || '')
    if (delta) {
      updateLiveAssistantView(liveTargetText.value + delta)
    } else {
      updateLiveAssistantView(String(run.live_text || ''))
    }
    if (Number.isFinite(Number(run.live_len))) {
      liveCursor.value = Number(run.live_len)
    } else {
      liveCursor.value = liveTargetText.value.length
    }
    if (['completed', 'error', 'stopped'].includes(currentRunStatus.value)) {
      isTyping.value = false
      currentRunPhase.value = 'idle'
      currentMcpTool.value = ''
      await pollRunHistory(epoch)
      await ensureFinalAssistantMessage(epoch)
      clearLiveAssistantView()
      await loadTotalTokens()
      return
    }
    await refreshTokensDuringRunIfNeeded()
  } catch {
    // ignore transient errors and keep polling
  } finally {
    if (epoch === runPollEpoch && isRunActive.value) {
      runLivePollTimer = window.setTimeout(() => { void pollRunLive(epoch) }, 90)
    }
  }
}

const startRunPolling = () => {
  stopRunPolling()
  lastRealtimeTokenSyncAt = 0
  const epoch = runPollEpoch
  liveCursor.value = liveTargetText.value.length
  void pollRunLive(epoch)
  void pollRunHistory(epoch)
}

const checkActiveRun = async () => {
  if (!currentSessionId.value) return
  const token = localStorage.getItem('token')
  if (!token) return
  const res = await fetch(`/api/chat/run/active?${queryForAi({ session_id: currentSessionId.value })}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return
  const data = await res.json()
  if (!data?.run?.run_id) return
  currentRunId.value = data.run.run_id
  currentRunStatus.value = data.run.status || 'running'
  currentRunPhase.value = (data.run.live_phase || 'generating')
  currentMcpTool.value = String(data.run.current_tool || '')
  updateLiveAssistantView(String(data.run.live_text || ''))
  liveCursor.value = Number(data.run.live_len || String(data.run.live_text || '').length || 0)
  isTyping.value = ['queued', 'running'].includes(currentRunStatus.value)
  if (isTyping.value) {
    startRunPolling()
  }
}

const stopCurrentRun = async () => {
  if (!currentRunId.value) return
  const token = localStorage.getItem('token')
  if (!token) return
  try {
    const res = await fetch(`/api/chat/run/${currentRunId.value}/stop`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(String(err?.detail || '终止失败'))
    }
    stopRunPolling()
    isTyping.value = false
    currentRunStatus.value = 'stopped'
    currentRunPhase.value = 'idle'
    currentMcpTool.value = ''
    clearLiveAssistantView()
    await fetchRunHistoryIncrementalOnce()
    await loadTotalTokens()
  } catch (err: any) {
    alert({ message: `终止失败: ${String(err?.message || '未知错误')}`, type: 'error' })
  }
}

const resolveHistoryIndexFromRenderedMessage = (renderMsg: { id?: number } | null) => {
  if (!renderMsg) return -1
  const messageId = Number(renderMsg.id || 0)
  if (!Number.isFinite(messageId) || messageId <= 0) return -1
  return chatMessages.value.findIndex(item => Number(item.id || 0) === messageId)
}

const deleteMessage = async (idx: number) => {
  if (idx < 0) return
  const msg = chatMessages.value[idx]
  if (!msg.id) {
    chatMessages.value.splice(idx, 1)
    return
  }
  if (!(await confirm({ message: '确定要删除这条消息吗？', type: 'warning' }))) return
  const token = localStorage.getItem('token')
  if (!token) return
  const res = await fetch(`/api/chat/${msg.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  if (res.ok) {
    chatMessages.value.splice(idx, 1)
    alert({ message: '消息已删除', type: 'success' })
  }
}

const recallMessage = async (idx: number) => {
  if (idx < 0) return
  const msg = chatMessages.value[idx]
  if (!msg.id) return
  if (!(await confirm({ message: '确定撤回此消息吗？将删除它之后的对话。', type: 'warning' }))) return
  const token = localStorage.getItem('token')
  if (!token) return
  const res = await fetch(`/api/chat/recall/${msg.id}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return
  const data = await res.json()
  chatMessages.value.splice(idx)
  chatInput.value = data.recall_content || msg.content
}

const onConversationDelete = async (_renderIdx: number, message: { id?: number } | null) => {
  const idx = resolveHistoryIndexFromRenderedMessage(message)
  await deleteMessage(idx)
}

const onConversationRecall = async (_renderIdx: number, message: { id?: number } | null) => {
  const idx = resolveHistoryIndexFromRenderedMessage(message)
  await recallMessage(idx)
}

const onConversationApply = async (_renderIdx: number, blockIdx: number, message: { id?: number } | null) => {
  const idx = resolveHistoryIndexFromRenderedMessage(message)
  await executeAction(idx, blockIdx)
}

const onConversationRevert = async (_renderIdx: number, blockIdx: number, message: { id?: number } | null) => {
  const idx = resolveHistoryIndexFromRenderedMessage(message)
  await revertAction(idx, blockIdx)
}

const safeJson = (value: unknown, maxLen = 8000) => {
  let text = ''
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value ?? '')
  }
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}\n...<truncated>`
}

const buildMcpDisplayResult = (block: ActionBlock, data: any) => {
  const toolName = block.tool || ''
  const result = safeJson(data?.result ?? data?.mcp?.result ?? data, 12000)
  return [`工具: ${toolName}`, '', result].join('\n')
}

const executeAction = async (msgIdx: number, blockIdx: number) => {
  if (msgIdx < 0) return
  const msg = chatMessages.value[msgIdx]
  if (!msg) return
  if (!msg.blocks) return
  const block = msg.blocks[blockIdx]
  if (!block) return
  const token = localStorage.getItem('token')
  if (!token) return

  if (block.type === 'mcp') {
    if (appliedEdits.value.has(block.id)) return
    const res = await fetch('/api/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool: block.tool, arguments: block.arguments || {}, ai_config_id: props.aiConfigId }),
    })
    const data = await res.json()
    if (!res.ok) {
      alert({ message: data.detail || `工具执行失败: ${block.tool || 'unknown'}`, type: 'error' })
      return
    }
    appliedEdits.value.add(block.id)
    appliedSignatures.value.add(blockSignature(block))
    actionResults.value[block.id] = buildMcpDisplayResult(block, data)
    actionResultsBySignature.value[blockSignature(block)] = actionResults.value[block.id]
    const undo = data?.result?.undo || data?.mcp?.result?.undo
    if (undo?.tool && undo?.arguments) undoActions.value[block.id] = undo
    persistMessageActionStateWhenReady(msg)
    await loadTotalTokens()
    return
  }

  let res: Response
  {
    res = await fetch('/api/chat/execute-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: block.type,
        filename: block.filename,
        search: block.search,
        replace: block.replace,
        content: block.content,
        command: block.command,
        ai_config_id: props.aiConfigId,
      }),
    })
  }

  const data = await res.json()
  if (!res.ok) {
    alert({ message: data.detail || '工具执行失败', type: 'error' })
    return
  }
  appliedEdits.value.add(block.id)
  appliedSignatures.value.add(blockSignature(block))
  const undo = data?.result?.undo || data?.mcp?.result?.undo
  if (undo?.tool && undo?.arguments) undoActions.value[block.id] = undo
  actionResults.value[block.id] = safeJson(data, 12000)
  actionResultsBySignature.value[blockSignature(block)] = actionResults.value[block.id]
  persistMessageActionStateWhenReady(msg)
  await loadTotalTokens()
}

const revertAction = async (msgIdx: number, blockIdx: number) => {
  if (msgIdx < 0) return
  const msg = chatMessages.value[msgIdx]
  if (!msg) return
  if (!msg.blocks) return
  const block = msg.blocks[blockIdx]
  if (!block || block.type !== 'mcp') return
  const undo = undoActions.value[block.id]
  if (!undo) return
  const token = localStorage.getItem('token')
  if (!token) return
  const res = await fetch('/api/mcp/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...undo, ai_config_id: props.aiConfigId }),
  })
  if (!res.ok) return
  appliedEdits.value.delete(block.id)
  appliedSignatures.value.delete(blockSignature(block))
  delete undoActions.value[block.id]
  delete actionResults.value[block.id]
  delete actionResultsBySignature.value[blockSignature(block)]
  persistMessageActionStateWhenReady(msg)
  await loadTotalTokens()
}

const sendChat = async (overrideContent?: string, options: { silent?: boolean } = {}) => {
  const content = (overrideContent ?? chatInput.value).trim()
  const silent = !!options.silent
  if (silent) return
  if (!content || isTyping.value || !currentSessionId.value) return
  const token = localStorage.getItem('token')
  if (!token) return

  let contextStr = ''

  if (props.selectedFiles.length > 0) {
    const res = await fetch('/api/chat/file-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filenames: props.selectedFiles }),
    })
    if (res.ok) {
      const contents = await res.json()
      contextStr += '\n### Selected Files Content:\n'
      for (const [filename, text] of Object.entries(contents)) {
        contextStr += `\nFile: \`${filename}\`\n\`\`\`\n${text}\n\`\`\`\n`
      }
    }
  }

  const currentSessionName = sessionList.value.find(s => s.id === currentSessionId.value)?.name || '未命名会话'
  const selectedFileNote = props.selectedFiles.length > 0
    ? `\n\n[已附加文件]\n${props.selectedFiles.map(path => `- ${path}`).join('\n')}`
    : ''
  const visibleUserContent = `${content}${selectedFileNote}`
  const fullContentWithContext = contextStr ? `${visibleUserContent}\n\n${contextStr}` : visibleUserContent
  chatInput.value = ''
  isTyping.value = true
  currentRunStatus.value = 'queued'
  currentRunPhase.value = 'generating'
  currentMcpTool.value = ''
  clearLiveAssistantView()

  try {
    const startRes = await fetch('/api/chat/run/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        visible_content: visibleUserContent,
        model_content: fullContentWithContext,
        session_id: currentSessionId.value,
        session_name: currentSessionName,
        ai_config_id: props.aiConfigId,
        ai_kind: aiKindValue.value,
      }),
    })
    if (!startRes.ok) {
      const data = await startRes.json().catch(() => ({}))
      throw new Error(data?.detail || 'run start failed')
    }
    const started = await startRes.json()
    currentRunId.value = started.run_id
    await loadChatHistory(currentSessionId.value)
    startRunPolling()
  } catch (err: any) {
    isTyping.value = false
    currentRunStatus.value = 'error'
    currentRunPhase.value = 'idle'
    currentMcpTool.value = ''
    const text = String(err?.message || '')
    if (text.includes('already active')) {
      alert({ message: '当前会话已有进行中的任务，正在接入运行状态。', type: 'warning' })
      await checkActiveRun()
    } else {
      alert({ message: `发送失败: ${text || '未知错误'}`, type: 'error' })
    }
  }
}

const initializeSessions = async () => {
  stopRunPolling()
  currentRunId.value = ''
  currentRunStatus.value = 'idle'
  currentRunPhase.value = 'idle'
  currentMcpTool.value = ''
  clearLiveAssistantView()
  isTyping.value = false
  await loadSessions()
  if (sessionList.value.length === 0) {
    await createSession('默认会话')
  } else if (!currentSessionId.value) {
    currentSessionId.value = pickPreferredSessionId(sessionList.value)
  }
  if (currentSessionId.value) {
    await loadChatHistory(currentSessionId.value)
    await checkActiveRun()
  }
}

watch(() => props.aiConfigId, async () => {
  stopRunPolling()
  chatMessages.value = []
  currentSessionId.value = ''
  currentRunPhase.value = 'idle'
  currentMcpTool.value = ''
  clearLiveAssistantView()
  await initializeSessions()
}, { immediate: false })

watch(currentSessionId, async (sid, oldSid) => {
  if (!sid || sid === oldSid) return
  stopRunPolling()
  currentRunId.value = ''
  currentRunStatus.value = 'idle'
  currentRunPhase.value = 'idle'
  currentMcpTool.value = ''
  clearLiveAssistantView()
  isTyping.value = false
  await checkActiveRun()
})

onMounted(async () => {
  await initializeSessions()
})

onBeforeUnmount(() => {
  stopRunPolling()
  clearLiveAssistantView()
})
</script>

<template>
  <div class="flex flex-col h-full gap-3">
    <div class="flex items-center justify-between gap-2">
      <ChatHeader
        :currentSessionId="currentSessionId"
        :sessionList="sessionList"
        @change="loadChatHistory"
        @create="createSessionFromButton"
        @delete="deleteSession"
        @rename="renameSession"
      />
      <div class="flex items-center gap-2">
        <span v-if="isRunActive" class="text-[11px] text-emerald-600 dark:text-emerald-400">{{ runStatusText }}</span>
        <button
          v-if="isRunActive"
          class="shrink-0 text-xs px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20"
          @click="stopCurrentRun"
        >
          终止
        </button>
        <button
          class="shrink-0 text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-300"
          @click="emit('open-settings')"
        >
          设置
        </button>
      </div>
    </div>

    <div ref="chatScrollRef" class="flex-1 overflow-y-auto">
      <ChatConversationView
        :baseMessages="chatMessages"
        :sessionActive="!!currentSessionId"
        :frontPromptPlaceholder="'（当前会话尚未记录系统提示词，发送首条消息后显示实际 Prompt）'"
        :liveText="liveAssistantText"
        :appliedEdits="appliedEditsArray"
        :appliedSignatures="appliedSignaturesArray"
        :actionResults="actionResults"
        :actionResultsBySignature="actionResultsBySignature"
        :isTyping="isTyping"
        @delete="onConversationDelete"
        @recall="onConversationRecall"
        @apply="onConversationApply"
        @revert="onConversationRevert"
      />
    </div>

    <ChatInput
      v-model="chatInput"
      :isTyping="isTyping"
      :isFileSelectorOpen="isFileSelectorOpen"
      :allFiles="allFiles"
      :selectedFiles="selectedFiles"
      :currentPath="currentPath"
      @send="sendChat"
      @toggleFileSelector="isFileSelectorOpen = !isFileSelectorOpen"
      @closeFileSelector="isFileSelectorOpen = false"
      @navigateTo="navigateTo"
      @navigateBack="navigateBack"
      @toggleFile="toggleFileSelection"
      @clearFiles="emit('update:selectedFiles', [])"
      @refreshFiles="handleRefreshFiles"
    />
  </div>
</template>
