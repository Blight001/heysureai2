<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMessage } from '@/composables/useMessage'
import ChatHeader from './ChatHeader.vue'
import ChatConversationView from './ChatConversationView.vue'
import ChatInput from './ChatInput.vue'
import { parseChatResponseInline, type ActionBlock, type InlineContent as InlineContentType } from '@/utils/chatParser'
import { isSameAssistantVisibleReply, normalizeAssistantReplyText } from '@/utils/chatReplyCompare'
import * as chatApi from '@/api/chat'
import { listAiConfigs } from '@/api/ai'
import { callMcpTool, listMcpTools } from '@/api/mcp'
import { getAuthToken } from '@/api/http'
import { renderGroupedMcpToolCatalog, stripPromptSection, type McpCatalogToolGroup } from '@/utils/mcpToolCatalog'

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
  mcpIcon?: string
  mcpDynamicRule?: string
  stripMarkdownSymbols?: boolean
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
const liveThinkingText = ref('')
const liveAssistantText = ref('')
const liveTargetText = ref('')
const liveCursor = ref(0)
const shownRunErrorIds = ref<Set<string>>(new Set())

// Runtime duration tracking for current AI run (total / MCP / deep-thinking)
const runStartTs = ref<number | null>(null)
const mcpElapsedMs = ref(0)
const thinkElapsedMs = ref(0)
const phaseEnterTs = ref<number | null>(null)
const lastRunDurations = ref<{ total: number; mcp: number; think: number } | null>(null)
const timeTick = ref(Date.now())
let timeTickTimer: number | null = null
let runLivePollTimer: number | null = null
let runHistoryPollTimer: number | null = null
let sessionSyncPollTimer: number | null = null
let liveTypingFrame: number | null = null
let liveRenderLength = 0
let liveRenderVelocity = 0
let liveLastFrameTs = 0
let liveLastScrollTs = 0
let runPollEpoch = 0
let sessionSyncPollEpoch = 0
let lastRealtimeTokenSyncAt = 0
let lastExternalRunCheckAt = 0
const chatScrollRef = ref<HTMLElement | null>(null)
const currentSessionId = ref<string>('')
const sessionList = ref<SessionItem[]>([])
const appliedEdits = ref<Set<string>>(new Set())
const appliedSignatures = ref<Set<string>>(new Set())
const undoActions = ref<Record<string, { tool: string; arguments: Record<string, any> }>>({})
const actionResults = ref<Record<string, string>>({})
const actionResultsBySignature = ref<Record<string, string>>({})
const configuredFrontPrompt = ref('')
const effectiveSystemPromptPreview = ref('')
const frontPromptPreviewError = ref('')
const frontPromptCopied = ref(false)
const frontPromptAvailableTools = ref<any[]>([])
const frontPromptToolGroups = ref<McpCatalogToolGroup[]>([])
const frontPromptToolScope = ref('')
const frontPromptToolMcpEnabled = ref<boolean | null>(null)
const frontPromptToolSchemaError = ref('')
const appliedEditsArray = computed(() => Array.from(appliedEdits.value))
const appliedSignaturesArray = computed(() => Array.from(appliedSignatures.value))
const isRunActive = computed(() => ['queued', 'running'].includes(currentRunStatus.value))
const latestRecordedSystemPrompt = computed(() => {
  for (let i = chatMessages.value.length - 1; i >= 0; i -= 1) {
    const prompt = String(chatMessages.value[i]?.system_prompt || '').trim()
    if (prompt) return prompt
  }
  return ''
})
const frontPromptBaseText = computed(() => {
  return effectiveSystemPromptPreview.value
    || latestRecordedSystemPrompt.value
    || configuredFrontPrompt.value
    || '运行时 Prompt 预览加载中或暂不可用'
})
const frontPromptBodyText = computed(() => stripPromptSection(frontPromptBaseText.value, '可用MCP工具'))
const frontPromptMcpCatalogText = computed(() => {
  if (frontPromptToolMcpEnabled.value === false) {
    return '- （MCP 未启用）'
  }
  const error = frontPromptToolSchemaError.value || frontPromptPreviewError.value
  if (error) return `- （工具目录加载失败：${error}）`
  if (frontPromptToolGroups.value.length > 0) {
    return renderGroupedMcpToolCatalog(frontPromptToolGroups.value)
  }
  const serverTools = frontPromptAvailableTools.value.filter(tool => (tool.mcpSource || 'server') === 'server')
  const deviceTools = frontPromptAvailableTools.value.filter(tool => (tool.mcpSource || 'server') !== 'server')
  return renderGroupedMcpToolCatalog([
    { groupKey: 'workspace', groupLabel: '工作区 MCP', groupKind: 'workspace', tools: serverTools },
    { groupKey: 'device:fallback', groupLabel: '端侧设备 MCP', groupKind: 'device', tools: deviceTools },
  ])
})
const frontPromptPreviewText = computed(() => [
  frontPromptBodyText.value,
  '',
  '[动态 MCP 说明]',
  frontPromptMcpCatalogText.value,
].join('\n'))
const copyFrontPrompt = async () => {
  const text = frontPromptPreviewText.value
  if (!text) return
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    frontPromptCopied.value = true
    window.setTimeout(() => {
      frontPromptCopied.value = false
    }, 1200)
  } catch (error) {
    console.warn('copy front prompt failed', error)
  }
}
const runStatusText = computed(() => {
  if (!isRunActive.value) return ''
  if (currentRunPhase.value === 'waiting_mcp') {
    return currentMcpTool.value ? `等待 MCP: ${currentMcpTool.value}` : '等待 MCP 返回'
  }
  return '后端流式生成中'
})

const durationDisplay = computed(() => {
  timeTick.value // reactive dependency for live updates
  let total = 0
  let mcp = mcpElapsedMs.value
  let think = thinkElapsedMs.value
  if (runStartTs.value != null) {
    total = Date.now() - runStartTs.value
    if (currentRunPhase.value === 'waiting_mcp' && phaseEnterTs.value != null) {
      mcp += Date.now() - phaseEnterTs.value
    } else if (currentRunPhase.value === 'generating' && phaseEnterTs.value != null) {
      think += Date.now() - phaseEnterTs.value
    }
  } else if (lastRunDurations.value) {
    total = lastRunDurations.value.total
    mcp = lastRunDurations.value.mcp
    think = lastRunDurations.value.think
  }
  if (total <= 0 && mcp <= 0 && think <= 0) return ''
  const fmt = (ms: number) => {
    const s = Math.max(0, ms) / 1000
    return (s < 10 ? s.toFixed(1) : Math.round(s).toString()) + 's'
  }
  return `总 ${fmt(total)} · MCP ${fmt(mcp)} · 深思 ${fmt(think)}`
})

function startTimeTicker() {
  if (timeTickTimer != null) return
  timeTickTimer = window.setInterval(() => {
    timeTick.value = Date.now()
  }, 200)
}
function stopTimeTicker() {
  if (timeTickTimer != null) {
    window.clearInterval(timeTickTimer)
    timeTickTimer = null
  }
}

function applyPhaseDelta() {
  if (phaseEnterTs.value == null) return
  const delta = Date.now() - phaseEnterTs.value
  const ph = currentRunPhase.value
  if (ph === 'waiting_mcp') {
    mcpElapsedMs.value += delta
  } else if (ph === 'generating') {
    thinkElapsedMs.value += delta
  }
}

function resetRunTimers() {
  runStartTs.value = null
  mcpElapsedMs.value = 0
  thinkElapsedMs.value = 0
  phaseEnterTs.value = null
}

function startRunTimers() {
  resetRunTimers()
  const now = Date.now()
  runStartTs.value = now
  phaseEnterTs.value = now
  lastRunDurations.value = null
  startTimeTicker()
}

function finalizeRunTimers() {
  applyPhaseDelta()
  if (runStartTs.value != null) {
    const total = Date.now() - runStartTs.value
    lastRunDurations.value = {
      total,
      mcp: mcpElapsedMs.value,
      think: thinkElapsedMs.value,
    }
  }
  runStartTs.value = null
  phaseEnterTs.value = null
  // keep lastRunDurations so UI can still show the record briefly
}

function updatePhase(newPhase: 'idle' | 'generating' | 'waiting_mcp') {
  if (newPhase === currentRunPhase.value) return
  applyPhaseDelta()
  currentRunPhase.value = newPhase
  if (newPhase === 'idle') {
    phaseEnterTs.value = null
  } else {
    phaseEnterTs.value = Date.now()
  }
}

const STATE_PREFIX = '__HS_MCP_STATE__='

const normalizedAllFiles = computed(() => props.allFiles.map(file => file.replace(/\\/g, '/')))
const normalizedSelectedFiles = computed(() => props.selectedFiles.map(file => file.replace(/\\/g, '/')))

const isTaskSessionName = (name: string) => /^任务[:：]\s*/.test(String(name || '').trim())

const pickPreferredSessionId = (items: SessionItem[]) => {
  if (!Array.isArray(items) || items.length === 0) return ''
  const normal = items.find(item => !isTaskSessionName(item.name || ''))
  return normal?.id || items[0].id
}

const chatCtx = computed<chatApi.AiContext>(() => ({
  aiKind: aiKindValue.value,
  aiConfigId: props.aiConfigId,
}))

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
  if (!getAuthToken()) return
  const { base } = splitTags(msg.tags)
  const nextTags = encodeTagsWithState(base, collectMessageState(msg))
  if ((msg.tags || '') === nextTags) return
  try {
    await chatApi.patchChatMessageTags(msg.id, nextTags)
    msg.tags = nextTags
  } catch (err) {
    console.warn('persistMessageActionState failed', err)
  }
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
const handleToggleFileSelector = () => {
  const nextOpen = !isFileSelectorOpen.value
  isFileSelectorOpen.value = nextOpen
  if (nextOpen && props.allFiles.length === 0) {
    emit('refreshFiles')
  }
}

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
  const current = liveAssistantText.value || ''
  liveTargetText.value = nextTarget

  if (!nextTarget) {
    applyLiveAssistantText('')
    liveRenderLength = 0
    stopLiveTypingLoop()
    return
  }

  if (!nextTarget.startsWith(current)) {
    applyLiveAssistantText('')
    liveRenderLength = 0
    liveRenderVelocity = 0
  } else {
    liveRenderLength = Math.min(
      nextTarget.length,
      Math.max(liveRenderLength, current.length),
    )
  }

  if (liveTypingFrame === null) {
    liveLastFrameTs = 0
    liveTypingFrame = window.requestAnimationFrame(runLiveTypingFrame)
  }
}

const clearLiveAssistantView = () => {
  applyLiveAssistantText('')
  liveThinkingText.value = ''
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

const stopSessionSyncPolling = () => {
  sessionSyncPollEpoch += 1
  if (sessionSyncPollTimer !== null) window.clearTimeout(sessionSyncPollTimer)
  sessionSyncPollTimer = null
}

const upsertHistoryMessages = async (incoming: ChatMessage[]) => {
  if (!incoming.length) return
  const existingIds = new Set(chatMessages.value.map(m => m.id).filter(Boolean))
  const liveVisible = normalizeAssistantReplyText(liveTargetText.value)
  for (const msg of incoming) {
    if (msg.id && existingIds.has(msg.id)) continue
    const msgVisible = normalizeAssistantReplyText(msg.content)
    if (msg.role === 'assistant' && msgVisible) {
      const duplicateIdx = chatMessages.value.findIndex(item =>
        item.role === 'assistant'
        && isSameAssistantVisibleReply(item.display_text || item.content, msgVisible))
      if (duplicateIdx >= 0) {
        const existing = chatMessages.value[duplicateIdx]
        if (msg.id && !existing.id) {
          chatMessages.value.splice(duplicateIdx, 1)
        } else {
          if (
            liveVisible
            && isSameAssistantVisibleReply(msgVisible, liveVisible)
            && !isRunActive.value
            && liveAssistantText.value.trim()
          ) {
            clearLiveAssistantView()
          }
          continue
        }
      }
      if (
        liveVisible
        && isSameAssistantVisibleReply(msgVisible, liveVisible)
        && !isRunActive.value
        && liveAssistantText.value.trim()
      ) {
        clearLiveAssistantView()
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
  const normalized = normalizeAssistantReplyText(content)
  if (!normalized) return false
  return chatMessages.value.some(msg =>
    msg.role === 'assistant'
    && isSameAssistantVisibleReply(msg.display_text || msg.content, normalized))
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

const appendRunErrorNotice = async (runId: string, message: string) => {
  const key = runId || `unknown_${Date.now()}`
  if (shownRunErrorIds.value.has(key)) return
  shownRunErrorIds.value.add(key)
  const content = [
    '[AI 对话出错]',
    String(message || '').trim() || '后端运行失败，但没有返回具体错误信息。',
  ].join('\n')
  const fallbackMsg: ChatMessage = {
    role: 'system',
    content,
    created_at: Date.now(),
    display_text: content,
  }
  const localIndex = chatMessages.value.push(fallbackMsg) - 1
  await scrollToBottom()

  if (!getAuthToken() || !currentSessionId.value) return
  try {
    const currentSessionName = sessionList.value.find(s => s.id === currentSessionId.value)?.name || '未命名会话'
    const saved = await chatApi.saveChatMessage({
      role: 'system',
      content,
      tags: `run_error:${key}`,
      ai_config_id: props.aiConfigId,
      ai_kind: aiKindValue.value,
      session_id: currentSessionId.value,
      session_name: currentSessionName,
      total_tokens: 0,
    })
    chatMessages.value.splice(localIndex, 1, {
      ...saved,
      display_text: saved.content,
    })
  } catch (err) {
    console.warn('persist run error notice failed', err)
  }
}

const loadSessions = async () => {
  if (!getAuthToken()) return
  let rows
  try {
    rows = await chatApi.listChatSessions(chatCtx.value)
  } catch {
    return
  }
  sessionList.value = (Array.isArray(rows) ? rows : []).map((row: any) => ({
    id: String(row?.id || ''),
    name: String(row?.name || '未命名会话'),
    totalTokens: Number(row?.total_tokens || 0),
  }))
  if (!currentSessionId.value && sessionList.value.length > 0) {
    currentSessionId.value = pickPreferredSessionId(sessionList.value)
  }
}

const createSession = async (nameInput?: string) => {
  let name = nameInput
  if (!name) {
    name = await prompt({ message: '输入新对话名称:', placeholder: '例如: 需求拆解' }) || ''
  }
  if (!name.trim()) return
  if (!getAuthToken()) return
  let session
  try {
    session = await chatApi.createChatSession(chatCtx.value, name)
  } catch {
    return
  }
  await loadSessions()
  currentSessionId.value = session.id
  chatMessages.value = []
}

const createSessionFromButton = async () => {
  await createSession()
}

const deleteSession = async (sid: string) => {
  if (!(await confirm({ message: '确定删除这个对话记录吗？', type: 'warning' }))) return
  if (!getAuthToken()) return
  try {
    await chatApi.deleteChatSession(chatCtx.value, sid)
  } catch {
    return
  }
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
  if (!getAuthToken()) return
  try {
    await chatApi.renameChatSession(chatCtx.value, sid, name)
  } catch {
    alert({ message: '会话重命名失败', type: 'error' })
    return
  }
  await loadSessions()
}

const loadTotalTokens = async () => {
  if (!getAuthToken()) return 0
  let data
  try {
    data = await chatApi.getChatTotalTokens(chatCtx.value)
  } catch {
    return 0
  }
  emit('totalChatTokensUpdate', data.total_tokens || 0)
  return data.total_tokens || 0
}

const loadConfiguredFrontPrompt = async () => {
  configuredFrontPrompt.value = ''
  if (!getAuthToken()) return
  if (props.aiConfigId === undefined || props.aiConfigId === null) return
  let rows
  try {
    rows = await listAiConfigs()
  } catch {
    return
  }
  const cfg = (Array.isArray(rows) ? rows : []).find((row: any) => Number(row?.id) === Number(props.aiConfigId))
  configuredFrontPrompt.value = String(cfg?.prompt || '').trim()
}

const loadEffectiveSystemPromptPreview = async () => {
  effectiveSystemPromptPreview.value = ''
  frontPromptPreviewError.value = ''
  if (!getAuthToken()) return
  try {
    const data = await chatApi.getSystemPromptPreview(chatCtx.value, {
      sessionId: currentSessionId.value || undefined,
    })
    effectiveSystemPromptPreview.value = String(data?.prompt || '').trim()
  } catch (error: any) {
    frontPromptPreviewError.value = error?.message || 'Prompt 预览加载失败'
  }
}

const normalizePromptTool = (tool: any) => ({
  name: String(tool?.name || '').trim(),
  description: String(tool?.description || '').trim(),
  inputSchema: (tool?.inputSchema && typeof tool.inputSchema === 'object') ? tool.inputSchema : {},
  destructive: !!tool?.destructive,
  mcpSource: tool?.mcpSource || 'server',
  allowedForCurrentAi: tool?.allowedForCurrentAi !== false,
})

const sortPromptTools = (items: any[]) =>
  [...items]
    .map(normalizePromptTool)
    .filter(tool => tool.name)
    .sort((a, b) => {
      const sourceRank: Record<string, number> = { server: 0, desktop: 1, browser: 2 }
      const ar = sourceRank[a.mcpSource] ?? 9
      const br = sourceRank[b.mcpSource] ?? 9
      if (ar !== br) return ar - br
      return a.name.localeCompare(b.name)
    })

const normalizePromptToolGroup = (group: any): McpCatalogToolGroup => ({
  groupKey: String(group?.groupKey || '').trim(),
  groupLabel: String(group?.groupLabel || '').trim(),
  groupKind: group?.groupKind === 'device' ? 'device' : 'workspace',
  deviceId: String(group?.deviceId || '').trim() || undefined,
  deviceType: String(group?.deviceType || '').trim() || undefined,
  tools: sortPromptTools(Array.isArray(group?.tools) ? group.tools : []),
})

const loadFrontPromptToolSchemas = async () => {
  frontPromptAvailableTools.value = []
  frontPromptToolGroups.value = []
  frontPromptToolScope.value = ''
  frontPromptToolMcpEnabled.value = null
  frontPromptToolSchemaError.value = ''
  if (!getAuthToken()) return
  try {
    const response = await listMcpTools({ aiConfigId: props.aiConfigId })
    const tools = Array.isArray(response.tools) ? response.tools : []
    const promptTools = Array.isArray(response.promptTools) ? response.promptTools : []
    const endpointToolDefs = Array.isArray(response.endpointToolDefs) ? response.endpointToolDefs : []
    frontPromptAvailableTools.value = sortPromptTools(promptTools.length > 0
      ? promptTools
      : [
          ...tools.map((tool: any) => ({ ...tool, mcpSource: 'server' })),
          ...endpointToolDefs,
        ])
    const groups = Array.isArray(response.promptToolGroups) ? response.promptToolGroups : []
    frontPromptToolGroups.value = groups
      .map(normalizePromptToolGroup)
      .filter(group => group.groupLabel)
    frontPromptToolScope.value = String(response.promptToolsScope || (props.aiConfigId ? 'current_ai' : 'all_current'))
    frontPromptToolMcpEnabled.value = typeof response.promptToolsMcpEnabled === 'boolean'
      ? response.promptToolsMcpEnabled
      : null
  } catch (error: any) {
    frontPromptToolSchemaError.value = error?.message || 'MCP schema 加载失败'
  }
}

const mapHistoryMessages = (history: ChatMessage[]) => {
  return history.map((msg: ChatMessage) => {
    const parsed = parseChatResponseInline(msg.content)
    return {
      ...msg,
      display_text: parsed.displayText,
      think: msg.think || parsed.think,
      blocks: parsed.blocks,
      inlineContent: parsed.inlineContent,
    }
  })
}

const isConversationEditToolMessage = (msg: ChatMessage) => {
  return String(msg.tags || '') === 'mcp_tool_call'
    && String(msg.content || '').includes('工具: conversation.edit')
    && String(msg.content || '').includes('状态: 成功')
}

const isConversationClearToolMessage = (msg: ChatMessage) => {
  return isConversationEditToolMessage(msg)
    && String(msg.content || '').includes('"action": "clear"')
}

const reloadCurrentHistorySnapshot = async () => {
  if (!getAuthToken() || !currentSessionId.value) return
  let history
  try {
    history = await chatApi.getChatHistory(chatCtx.value, currentSessionId.value)
  } catch {
    return
  }
  chatMessages.value = mapHistoryMessages(history)
  restoreActionStatesFromHistory(chatMessages.value)
  await loadTotalTokens()
  await scrollToBottom()
}

const refreshTokensDuringRunIfNeeded = async (force = false) => {
  const now = Date.now()
  if (!force && now - lastRealtimeTokenSyncAt < 1000) return
  lastRealtimeTokenSyncAt = now
  await loadTotalTokens()
}

const loadChatHistory = async (sid: string) => {
  if (!getAuthToken() || !sid) return
  let history
  try {
    history = await chatApi.getChatHistory(chatCtx.value, sid)
  } catch {
    return
  }
  chatMessages.value = mapHistoryMessages(history)
  restoreActionStatesFromHistory(chatMessages.value)
  currentSessionId.value = sid
  await loadTotalTokens()
  await scrollToBottom()
  await checkActiveRun()
  startSessionSyncPolling()
  await loadEffectiveSystemPromptPreview()
}

const fetchRunHistoryIncrementalOnce = async () => {
  if (!currentSessionId.value) return
  if (!getAuthToken()) return
  let incremental
  try {
    incremental = await chatApi.getChatHistory(chatCtx.value, currentSessionId.value, {
      afterId: getLastMessageId(),
    })
  } catch {
    return
  }
  const hasConversationEdit = Array.isArray(incremental) && incremental.some(isConversationEditToolMessage)
  const shouldReloadSnapshot = Array.isArray(incremental) && incremental.some(isConversationClearToolMessage)
  await upsertHistoryMessages(incremental)
  if (hasConversationEdit) await loadSessions()
  if (shouldReloadSnapshot) {
    await reloadCurrentHistorySnapshot()
  }
}

const deleteSessions = async (sessionIds: string[]) => {
  const ids = Array.from(new Set(sessionIds.map(id => String(id || '').trim()).filter(Boolean)))
  if (ids.length === 0) return
  if (!(await confirm({ message: `确定删除选中的 ${ids.length} 个对话记录吗？`, type: 'warning' }))) return
  if (!getAuthToken()) return
  const deleted = new Set<string>()
  for (const sid of ids) {
    try {
      await chatApi.deleteChatSession(chatCtx.value, sid)
      deleted.add(sid)
    } catch {
      // keep deleting the rest
    }
  }
  await loadSessions()
  if (deleted.has(currentSessionId.value)) {
    currentSessionId.value = pickPreferredSessionId(sessionList.value)
    if (currentSessionId.value) await loadChatHistory(currentSessionId.value)
    else chatMessages.value = []
  }
  if (deleted.size > 0) {
    alert({ message: `已删除 ${deleted.size} 个对话记录`, type: 'success' })
  }
}

const pollSessionSync = async (epoch: number) => {
  if (epoch !== sessionSyncPollEpoch) return
  try {
    if (currentSessionId.value && getAuthToken()) {
      if (!isRunActive.value) {
        await fetchRunHistoryIncrementalOnce()
      }
      const now = Date.now()
      if (!isRunActive.value && now - lastExternalRunCheckAt > 1500) {
        lastExternalRunCheckAt = now
        await checkActiveRun()
      }
    }
  } finally {
    if (epoch === sessionSyncPollEpoch) {
      sessionSyncPollTimer = window.setTimeout(() => { void pollSessionSync(epoch) }, 1200)
    }
  }
}

const startSessionSyncPolling = () => {
  stopSessionSyncPolling()
  if (!currentSessionId.value || !getAuthToken()) return
  lastExternalRunCheckAt = 0
  const epoch = sessionSyncPollEpoch
  void pollSessionSync(epoch)
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
  if (!getAuthToken()) return
  let run
  try {
    run = await chatApi.getRunStatus(currentRunId.value, liveCursor.value)
  } catch (err: any) {
    currentRunStatus.value = 'error'
    isTyping.value = false
    finalizeRunTimers()
    clearLiveAssistantView()
    stopTimeTicker()
    await appendRunErrorNotice(currentRunId.value, err?.message || '状态查询失败')
    return
  }
  try {
    currentRunStatus.value = run.status || 'running'
    const incomingPhase = (run.live_phase || 'generating') as 'idle' | 'generating' | 'waiting_mcp'
    // support resumed runs: initialize total time from server started_at if available
    if (run.started_at && runStartTs.value == null) {
      lastRunDurations.value = null
      runStartTs.value = Math.floor(Number(run.started_at) * 1000)
      phaseEnterTs.value = Date.now()
      startTimeTicker()
    }
    if (incomingPhase !== currentRunPhase.value) {
      applyPhaseDelta()
      currentRunPhase.value = incomingPhase
      if (incomingPhase !== 'idle') phaseEnterTs.value = Date.now()
    }
    currentMcpTool.value = String(run.current_tool || '')
    const delta = String(run.live_delta || '')
    liveThinkingText.value = String(run.live_reasoning || '')
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
      finalizeRunTimers()
      currentRunPhase.value = 'idle'
      currentMcpTool.value = ''
      await pollRunHistory(epoch)
      await ensureFinalAssistantMessage(epoch)
      clearLiveAssistantView()
      if (currentRunStatus.value === 'error') {
        await appendRunErrorNotice(currentRunId.value, String(run.error_message || '后端运行失败，但没有返回具体错误信息。'))
      }
      await loadTotalTokens()
      stopTimeTicker()
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
  if (!getAuthToken()) return
  let data
  try {
    data = await chatApi.getActiveRun(chatCtx.value, currentSessionId.value)
  } catch {
    return
  }
  if (!data?.run?.run_id) return
  currentRunId.value = data.run.run_id
  currentRunStatus.value = data.run.status || 'running'
  const incomingPhase = (data.run.live_phase || 'generating') as 'idle' | 'generating' | 'waiting_mcp'
  // initialize timers for resumed active run using server start if possible
  if (runStartTs.value == null) {
    lastRunDurations.value = null
    if (data.run.started_at) {
      runStartTs.value = Math.floor(Number(data.run.started_at) * 1000)
    } else {
      runStartTs.value = Date.now()
    }
    phaseEnterTs.value = Date.now()
    startTimeTicker()
  }
  if (incomingPhase !== currentRunPhase.value) {
    applyPhaseDelta()
    currentRunPhase.value = incomingPhase
    if (incomingPhase !== 'idle') phaseEnterTs.value = Date.now()
  }
  currentMcpTool.value = String(data.run.current_tool || '')
  liveThinkingText.value = String(data.run.live_reasoning || '')
  updateLiveAssistantView(String(data.run.live_text || ''))
  liveCursor.value = Number(data.run.live_len || String(data.run.live_text || '').length || 0)
  isTyping.value = ['queued', 'running'].includes(currentRunStatus.value)
  if (isTyping.value) {
    startRunPolling()
  }
}

const stopCurrentRun = async () => {
  if (!currentRunId.value) return
  if (!getAuthToken()) return
  try {
    await chatApi.stopRun(currentRunId.value)
    stopRunPolling()
    isTyping.value = false
    currentRunStatus.value = 'stopped'
    finalizeRunTimers()
    currentRunPhase.value = 'idle'
    currentMcpTool.value = ''
    clearLiveAssistantView()
    await fetchRunHistoryIncrementalOnce()
    await loadTotalTokens()
    stopTimeTicker()
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
  if (!getAuthToken()) return
  try {
    await chatApi.deleteChatMessage(msg.id)
    chatMessages.value.splice(idx, 1)
    alert({ message: '消息已删除', type: 'success' })
  } catch {
    // best-effort
  }
}

const recallMessage = async (idx: number) => {
  if (idx < 0) return
  const msg = chatMessages.value[idx]
  if (!msg.id) return
  if (!(await confirm({ message: '确定撤回此消息吗？将删除它之后的对话。', type: 'warning' }))) return
  if (!getAuthToken()) return
  let data
  try {
    data = await chatApi.recallChatMessage(msg.id)
  } catch {
    return
  }
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

const isMcpCallFailed = (data: any) => {
  return data?.success === false
    || data?.mcp?.success === false
    || data?.result?.success === false
    || data?.mcp?.result?.success === false
}

const buildMcpDisplayResult = (_block: ActionBlock, data: any) => {
  const result = safeJson(data?.result ?? data?.mcp?.result ?? data, 12000)
  if (!isMcpCallFailed(data)) return result
  const errorMessage = String(
    data?.error
    || data?.mcp?.error
    || data?.result?.error
    || data?.mcp?.result?.error
    || '未知错误',
  ).trim()
  return `错误: ${errorMessage}\n\n${result}`
}

const executeAction = async (msgIdx: number, blockIdx: number) => {
  if (msgIdx < 0) return
  const msg = chatMessages.value[msgIdx]
  if (!msg) return
  if (!msg.blocks) return
  const block = msg.blocks[blockIdx]
  if (!block) return
  if (!getAuthToken()) return

  if (block.type === 'mcp') {
    if (appliedEdits.value.has(block.id)) return
    let data
    try {
      data = await callMcpTool({
        tool: block.tool || '',
        arguments: block.arguments || {},
        ai_config_id: props.aiConfigId,
      })
    } catch (err: any) {
      alert({ message: err?.message || `工具执行失败: ${block.tool || 'unknown'}`, type: 'error' })
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

  let data
  try {
    data = await chatApi.executeChatAction({
      action: block.type,
      filename: block.filename,
      search: block.search,
      replace: block.replace,
      content: block.content,
      command: block.command,
      ai_config_id: props.aiConfigId,
    })
  } catch (err: any) {
    alert({ message: err?.message || '工具执行失败', type: 'error' })
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
  if (!getAuthToken()) return
  try {
    await callMcpTool({ ...undo, ai_config_id: props.aiConfigId })
  } catch {
    return
  }
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
  if (!getAuthToken()) return

  let contextStr = ''

  if (props.selectedFiles.length > 0) {
    try {
      const contents = await chatApi.getChatFileContent(props.selectedFiles)
      contextStr += '\n### Selected Files Content:\n'
      for (const [filename, text] of Object.entries(contents)) {
        contextStr += `\nFile: \`${filename}\`\n\`\`\`\n${text}\n\`\`\`\n`
      }
    } catch {
      // best-effort: continue without file context
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
  currentMcpTool.value = ''
  clearLiveAssistantView()
  startRunTimers()
  updatePhase('generating')

  try {
    const started = await chatApi.startRun({
      visible_content: visibleUserContent,
      model_content: fullContentWithContext,
      session_id: currentSessionId.value,
      session_name: currentSessionName,
      ai_config_id: props.aiConfigId,
      ai_kind: aiKindValue.value,
    })
    currentRunId.value = started.run_id
    await loadChatHistory(currentSessionId.value)
    startRunPolling()
  } catch (err: any) {
    isTyping.value = false
    currentRunStatus.value = 'error'
    finalizeRunTimers()
    currentRunPhase.value = 'idle'
    currentMcpTool.value = ''
    stopTimeTicker()
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
  stopTimeTicker()
  resetRunTimers()
  lastRunDurations.value = null
  currentRunId.value = ''
  currentRunStatus.value = 'idle'
  currentRunPhase.value = 'idle'
  currentMcpTool.value = ''
  clearLiveAssistantView()
  isTyping.value = false
  await loadConfiguredFrontPrompt()
  await loadFrontPromptToolSchemas()
  await loadSessions()
  if (sessionList.value.length === 0) {
    await createSession('默认会话')
  } else if (!currentSessionId.value) {
    currentSessionId.value = pickPreferredSessionId(sessionList.value)
  }
  if (currentSessionId.value) {
    await loadChatHistory(currentSessionId.value)
  }
  await loadEffectiveSystemPromptPreview()
}

watch(() => props.aiConfigId, async () => {
  stopRunPolling()
  stopSessionSyncPolling()
  stopTimeTicker()
  resetRunTimers()
  lastRunDurations.value = null
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
  stopSessionSyncPolling()
  stopTimeTicker()
  resetRunTimers()
  lastRunDurations.value = null
  currentRunId.value = ''
  currentRunStatus.value = 'idle'
  currentRunPhase.value = 'idle'
  currentMcpTool.value = ''
  clearLiveAssistantView()
  isTyping.value = false
  await checkActiveRun()
  startSessionSyncPolling()
  await loadEffectiveSystemPromptPreview()
})

onMounted(async () => {
  await initializeSessions()
})

onBeforeUnmount(() => {
  stopRunPolling()
  stopSessionSyncPolling()
  stopTimeTicker()
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
        @batch-delete="deleteSessions"
        @rename="renameSession"
      />
      <div class="flex items-center gap-2">
        <span v-if="runStatusText" class="text-[11px] text-emerald-600 dark:text-emerald-400">{{ runStatusText }}</span>
        <span
          v-if="durationDisplay"
          class="text-[10px] px-1.5 py-px rounded border text-emerald-700/80 dark:text-emerald-300/70 border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10"
        >{{ isRunActive ? durationDisplay : ('上次 ' + durationDisplay) }}</span>
        <button
          v-if="isRunActive"
          class="shrink-0 text-xs px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/20"
          @click="stopCurrentRun"
        >
          终止
        </button>
        <div class="relative group/front-prompt">
          <button
            class="shrink-0 text-xs px-2 py-1 rounded border border-violet-200 text-violet-600 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/20"
            type="button"
          >
            前置 Prompt
          </button>
          <div
            class="absolute right-0 top-full z-[80] hidden w-[min(42rem,calc(100vw-2rem))] pt-2 group-hover/front-prompt:block"
          >
            <div class="max-h-[28rem] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              <div class="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                <div class="text-xs font-semibold text-zinc-700 dark:text-zinc-200">前置 Prompt</div>
                <button
                  class="shrink-0 rounded border border-zinc-200 px-2 py-1 text-[11px] text-zinc-600 hover:border-violet-300 hover:text-violet-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-violet-500 dark:hover:text-violet-300"
                  type="button"
                  @click.stop="copyFrontPrompt"
                >
                  {{ frontPromptCopied ? '已复制' : '复制' }}
                </button>
              </div>
              <pre class="max-h-[24rem] overflow-auto whitespace-pre-wrap break-words p-3 text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-300">{{ frontPromptPreviewText }}</pre>
            </div>
          </div>
        </div>
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
        :frontPromptText="configuredFrontPrompt"
        :showFrontPrompt="false"
        :frontPromptPlaceholder="'（当前会话尚未记录系统提示词，发送首条消息后显示实际 Prompt）'"
        :mcpIcon="props.mcpIcon"
        :mcpDynamicRule="props.mcpDynamicRule"
        :aiConfigId="props.aiConfigId"
        :sessionId="currentSessionId"
        :liveText="liveAssistantText"
        :liveTargetText="liveTargetText"
        :liveThinking="liveThinkingText"
        :livePhase="currentRunPhase"
        :appliedEdits="appliedEditsArray"
        :appliedSignatures="appliedSignaturesArray"
        :actionResults="actionResults"
        :actionResultsBySignature="actionResultsBySignature"
        :isTyping="isTyping"
        :stripMarkdownSymbols="!!props.stripMarkdownSymbols"
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
      @toggleFileSelector="handleToggleFileSelector"
      @closeFileSelector="isFileSelectorOpen = false"
      @navigateTo="navigateTo"
      @navigateBack="navigateBack"
      @toggleFile="toggleFileSelection"
      @clearFiles="emit('update:selectedFiles', [])"
      @refreshFiles="handleRefreshFiles"
    />
  </div>
</template>
