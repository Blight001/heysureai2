<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import ChatMessageList from './ChatMessageList.vue'
import { parseChatResponseInline, type ActionBlock, type InlineContent as InlineContentType } from '@/utils/chatParser'
import { stripMcpCallBlocks } from '@/utils/mcpFormat'
import { listMcpTools } from '@/api/mcp'

const DEFAULT_MCP_DYNAMIC_RULE = '初始只向模型暴露 mcp.list_tools / mcp.describe_tool；mcp.describe_tool 成功后，后端才把被描述的目标工具 schema 加入下一轮请求。'

interface ConversationInputMessage {
  id?: number
  role?: string
  content: string
  think?: string
  display_text?: string
  inlineContent?: InlineContentType[]
  blocks?: ActionBlock[]
  tags?: string
  system_prompt?: string
  front_prompt_details?: string
  created_at?: number
}

interface ConversationMessage extends ConversationInputMessage {
  role: 'user' | 'assistant' | 'system'
}

const props = withDefaults(defineProps<{
  baseMessages: ConversationInputMessage[]
  sessionActive?: boolean
  showFrontPrompt?: boolean
  showFrontPromptPlaceholder?: boolean
  frontPromptText?: string
  frontPromptPlaceholder?: string
  thinkingIcon?: string
  mcpIcon?: string
  mcpSuccessIcon?: string
  mcpErrorIcon?: string
  mcpDynamicRule?: string
  aiConfigId?: number
  liveText?: string
  liveThinking?: string
  isTyping?: boolean
  stripMarkdownSymbols?: boolean
  readonly?: boolean
  appliedEdits?: string[]
  appliedSignatures?: string[]
  actionResults?: Record<string, string>
  actionResultsBySignature?: Record<string, string>
  recoverActionStateFromTags?: boolean
}>(), {
  sessionActive: false,
  showFrontPrompt: true,
  showFrontPromptPlaceholder: true,
  frontPromptText: '',
  frontPromptPlaceholder: '（当前会话尚未记录系统提示词，发送首条消息后显示实际 Prompt）',
  thinkingIcon: '🤔',
  mcpIcon: '🧰',
  mcpSuccessIcon: '🧰',
  mcpErrorIcon: '🧰',
  mcpDynamicRule: DEFAULT_MCP_DYNAMIC_RULE,
  liveText: '',
  liveThinking: '',
  isTyping: false,
  stripMarkdownSymbols: false,
  readonly: false,
  appliedEdits: () => [],
  appliedSignatures: () => [],
  actionResults: () => ({}),
  actionResultsBySignature: () => ({}),
  recoverActionStateFromTags: false,
})

const emit = defineEmits<{
  (e: 'delete', renderIdx: number, message: ConversationMessage | null): void
  (e: 'recall', renderIdx: number, message: ConversationMessage | null): void
  (e: 'apply', renderIdx: number, blockIdx: number, message: ConversationMessage | null): void
  (e: 'revert', renderIdx: number, blockIdx: number, message: ConversationMessage | null): void
}>()

const normalizeRole = (role?: string): 'user' | 'assistant' | 'system' => {
  const normalized = String(role || '').toLowerCase()
  if (normalized === 'user' || normalized === 'assistant' || normalized === 'system') return normalized
  return 'assistant'
}

const parseMcpToolNameFromMessage = (msg?: ConversationInputMessage | ConversationMessage | null) => {
  const text = String(msg?.display_text || msg?.content || '').trim()
  if (!text.startsWith('[MCP工具]')) return ''
  const match = text.match(/^工具[：:]\s*(.+)$/m)
  return String(match?.[1] || '').trim()
}

const stripMcpCallFormatText = (raw?: string) => {
  return stripMcpCallBlocks(raw)
}

const stripMcpCallInlineText = (items?: InlineContentType[]) => {
  if (!Array.isArray(items)) return items
  return items
    .map((item) => {
      if (item.type !== 'text') return item
      return { ...item, content: stripMcpCallFormatText(item.content) }
    })
    .filter((item) => item.type !== 'text' || String(item.content || '').trim())
}

const stripMcpCallFormatMessage = (msg: ConversationMessage) => {
  if (msg.role !== 'assistant') return msg
  const next = { ...msg }
  next.content = stripMcpCallFormatText(next.content)
  if (typeof next.display_text === 'string') next.display_text = stripMcpCallFormatText(next.display_text)
  if (typeof next.think === 'string') next.think = stripMcpCallFormatText(next.think)
  next.inlineContent = stripMcpCallInlineText(next.inlineContent)
  return next
}

const findNextExecutedMcpTool = (nextMessages: ConversationMessage[]) => {
  for (const item of nextMessages.slice(0, 6)) {
    const tool = parseMcpToolNameFromMessage(item)
    if (tool) return tool
    if (item.role === 'user' || item.role === 'assistant') return ''
  }
  return ''
}

const hideExecutedMcpBlocks = (msg: ConversationMessage, nextMessages: ConversationMessage[] = []) => {
  if (msg.role !== 'assistant') return msg
  if (String(msg.tags || '').includes('mcp_assistant_call')) {
    return {
      ...msg,
      inlineContent: (msg.inlineContent || []).filter((item) => item.type !== 'block' || item.block?.type !== 'mcp'),
      blocks: (msg.blocks || []).filter((block) => block.type !== 'mcp'),
    }
  }
  const executedTool = findNextExecutedMcpTool(nextMessages)
  if (!executedTool) return msg
  const inlineContent = (msg.inlineContent || []).filter((item) => {
    if (item.type !== 'block' || item.block?.type !== 'mcp') return true
    return String(item.block.tool || '').trim() !== executedTool
  })
  const blocks = (msg.blocks || []).filter((block) => {
    if (block.type !== 'mcp') return true
    return String(block.tool || '').trim() !== executedTool
  })
  return { ...msg, inlineContent, blocks }
}

const normalizedMessages = computed<ConversationMessage[]>(() => {
  const parsed = (props.baseMessages || []).map((raw) => {
    const role = normalizeRole(raw?.role)
    const content = String(raw?.content || '')
    const hasParsed =
      (Array.isArray(raw?.inlineContent) && raw.inlineContent.length > 0)
      || typeof raw?.display_text === 'string'
      || typeof raw?.think === 'string'
    if (hasParsed) {
      return {
        ...raw,
        role,
      }
    }
    const parsed = parseChatResponseInline(content)
    return {
      ...raw,
      role,
      think: typeof raw?.think === 'string' ? raw.think : parsed.think,
      display_text: typeof raw?.display_text === 'string' ? raw.display_text : (parsed.displayText || content),
      blocks: Array.isArray(raw?.blocks) ? raw.blocks : parsed.blocks,
      inlineContent: Array.isArray(raw?.inlineContent) ? raw.inlineContent : parsed.inlineContent,
    }
  })
  return parsed
    .map((msg, idx) => stripMcpCallFormatMessage(hideExecutedMcpBlocks(msg, parsed.slice(idx + 1))))
    .filter((msg) => {
      if (msg.role !== 'assistant') return true
      return Boolean(
        String(msg.content || '').trim()
        || String(msg.display_text || '').trim()
        || String(msg.think || '').trim()
        || (Array.isArray(msg.inlineContent) && msg.inlineContent.length > 0)
      )
    })
})

const STATE_PREFIX = '__HS_MCP_STATE__='

const splitTags = (raw?: string) => {
  const text = String(raw || '')
  const idx = text.indexOf(STATE_PREFIX)
  if (idx < 0) return { base: text.trim(), encoded: '' }
  const base = text.slice(0, idx).replace(/\s*\|\s*$/, '').trim()
  const encoded = text.slice(idx + STATE_PREFIX.length).trim()
  return { base, encoded }
}

const decodeStateFromTags = (raw?: string): Record<string, any> | null => {
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
    block?.type || '',
    block?.tool || '',
    block?.filename || '',
    block?.command || '',
    block?.search || '',
    block?.replace || '',
    block?.content || '',
    stableStringify(block?.arguments || {}),
  ].join('|')
  return `sig_${simpleHash(raw)}`
}

const recoveredActionState = computed(() => {
  if (!props.recoverActionStateFromTags) {
    return {
      appliedEdits: [] as string[],
      appliedSignatures: [] as string[],
      actionResults: {} as Record<string, string>,
      actionResultsBySignature: {} as Record<string, string>,
    }
  }

  const appliedEdits = new Set<string>()
  const appliedSignatures = new Set<string>()
  const actionResults: Record<string, string> = {}
  const actionResultsBySignature: Record<string, string> = {}

  for (const msg of normalizedMessages.value) {
    const state = decodeStateFromTags(msg.tags)
    const blockStates = (state?.blocks && typeof state.blocks === 'object') ? state.blocks : {}
    const signatureStates = (state?.signatures && typeof state.signatures === 'object') ? state.signatures : {}

    const msgBlockBySig: Record<string, string[]> = {}
    for (const block of msg.blocks || []) {
      const sig = blockSignature(block)
      if (!msgBlockBySig[sig]) msgBlockBySig[sig] = []
      msgBlockBySig[sig].push(String(block.id || ''))
    }

    for (const [blockId, blockStateRaw] of Object.entries(blockStates)) {
      const blockState = (blockStateRaw && typeof blockStateRaw === 'object') ? blockStateRaw as Record<string, any> : {}
      if (blockState.applied) appliedEdits.add(blockId)
      if (typeof blockState.result === 'string' && blockState.result.trim()) {
        actionResults[blockId] = blockState.result
        appliedEdits.add(blockId)
      }
    }

    for (const [sig, sigStateRaw] of Object.entries(signatureStates)) {
      const sigState = (sigStateRaw && typeof sigStateRaw === 'object') ? sigStateRaw as Record<string, any> : {}
      if (sigState.applied) appliedSignatures.add(sig)
      if (typeof sigState.result === 'string' && sigState.result.trim()) {
        actionResultsBySignature[sig] = sigState.result
      }
      const mappedIds = msgBlockBySig[sig] || []
      for (const blockId of mappedIds) {
        if (sigState.applied) appliedEdits.add(blockId)
        if (typeof sigState.result === 'string' && sigState.result.trim()) {
          actionResults[blockId] = sigState.result
        }
      }
    }
  }

  return {
    appliedEdits: Array.from(appliedEdits),
    appliedSignatures: Array.from(appliedSignatures),
    actionResults,
    actionResultsBySignature,
  }
})

const mergedAppliedEdits = computed(() => {
  return Array.from(new Set([...props.appliedEdits, ...recoveredActionState.value.appliedEdits]))
})

const mergedAppliedSignatures = computed(() => {
  return Array.from(new Set([...props.appliedSignatures, ...recoveredActionState.value.appliedSignatures]))
})

const mergedActionResults = computed(() => {
  return {
    ...recoveredActionState.value.actionResults,
    ...props.actionResults,
  }
})

const mergedActionResultsBySignature = computed(() => {
  return {
    ...recoveredActionState.value.actionResultsBySignature,
    ...props.actionResultsBySignature,
  }
})

const effectiveFrontPrompt = computed(() => {
  const explicit = String(props.frontPromptText || '').trim()
  if (explicit) return explicit
  for (let i = normalizedMessages.value.length - 1; i >= 0; i -= 1) {
    const prompt = String(normalizedMessages.value[i]?.system_prompt || '').trim()
    if (prompt) return prompt
  }
  return ''
})

const frontPromptToolSchemas = ref<any[]>([])
const frontPromptAvailableTools = ref<any[]>([])
const frontPromptToolScope = ref('')
const frontPromptToolMcpEnabled = ref<boolean | null>(null)
const frontPromptToolSchemaError = ref('')
const initialNativeToolNames = ['mcp.list_tools', 'mcp.describe_tool']

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

const loadFrontPromptToolSchemas = async () => {
  try {
    const response = await listMcpTools({ aiConfigId: props.aiConfigId })
    const tools = Array.isArray(response.tools) ? response.tools : []
    frontPromptToolSchemas.value = tools
      .filter((tool: any) => initialNativeToolNames.includes(String(tool?.name || '').trim()))
      .map(normalizePromptTool)
      .sort((a: any, b: any) => initialNativeToolNames.indexOf(a.name) - initialNativeToolNames.indexOf(b.name))
    const promptTools = Array.isArray(response.promptTools) ? response.promptTools : []
    const endpointToolDefs = Array.isArray(response.endpointToolDefs) ? response.endpointToolDefs : []
    frontPromptAvailableTools.value = sortPromptTools(promptTools.length > 0
      ? promptTools
      : [
          ...tools.map((tool: any) => ({ ...tool, mcpSource: 'server' })),
          ...endpointToolDefs,
        ])
    frontPromptToolScope.value = String(response.promptToolsScope || (props.aiConfigId ? 'current_ai' : 'all_current'))
    frontPromptToolMcpEnabled.value = typeof response.promptToolsMcpEnabled === 'boolean'
      ? response.promptToolsMcpEnabled
      : null
    frontPromptToolSchemaError.value = ''
  } catch (error: any) {
    frontPromptToolSchemas.value = []
    frontPromptAvailableTools.value = []
    frontPromptToolScope.value = ''
    frontPromptToolMcpEnabled.value = null
    frontPromptToolSchemaError.value = error?.message || 'MCP schema 加载失败'
  }
}

onMounted(() => {
  void loadFrontPromptToolSchemas()
})

watch(() => props.aiConfigId, () => {
  void loadFrontPromptToolSchemas()
})

const frontPromptDetails = computed(() => {
  const prompt = effectiveFrontPrompt.value
  const details = {
    prompt_source: prompt ? 'message.system_prompt' : 'placeholder',
    prompt,
    mcp_schema_mode: 'dynamic_native_tools',
    initial_native_tools: frontPromptToolSchemas.value.length > 0
      ? frontPromptToolSchemas.value
      : initialNativeToolNames.map(name => ({ name })),
    current_available_tools_scope: frontPromptToolScope.value || (props.aiConfigId ? 'current_ai' : 'all_current'),
    current_ai_config_id: props.aiConfigId ?? null,
    current_mcp_enabled: frontPromptToolMcpEnabled.value,
    current_available_tools_count: frontPromptAvailableTools.value.length,
    current_available_tools: frontPromptAvailableTools.value,
    dynamic_rule: String(props.mcpDynamicRule || DEFAULT_MCP_DYNAMIC_RULE),
    schema_error: frontPromptToolSchemaError.value || undefined,
  }
  return JSON.stringify(details, null, 2)
})

const frontPromptMessage = computed<ConversationMessage | null>(() => {
  if (!props.showFrontPrompt || !props.sessionActive) return null
  const prompt = effectiveFrontPrompt.value
  if (!prompt && !props.showFrontPromptPlaceholder) return null
  const content = prompt
    ? `[前置 Prompt]\n${prompt}`
    : `[前置 Prompt]\n${props.frontPromptPlaceholder}`
  return {
    id: -2,
    role: 'system',
    content,
    display_text: content,
    front_prompt_details: frontPromptDetails.value,
  }
})

const liveAssistantMessage = computed<ConversationMessage | null>(() => {
  const text = stripMcpCallFormatText(props.liveText)
  if (!text.trim()) return null
  const think = stripMcpCallFormatText(props.liveThinking)
  return {
    id: -1,
    role: 'assistant',
    content: text,
    display_text: text,
    think: think || undefined,
  }
})

const typingThinkingText = computed(() => {
  return String(props.liveText || '').trim() ? '' : props.liveThinking
})

const renderMessages = computed<ConversationMessage[]>(() => {
  const base = [...normalizedMessages.value]
  if (frontPromptMessage.value) base.unshift(frontPromptMessage.value)
  const liveMessage = liveAssistantMessage.value
  if (liveMessage) {
    const liveText = String(liveMessage.display_text || liveMessage.content || '').trim()
    let latestUserIndex = -1
    for (let i = base.length - 1; i >= 0; i -= 1) {
      if (base[i].role === 'user') {
        latestUserIndex = i
        break
      }
    }
    for (let i = base.length - 1; i > latestUserIndex; i -= 1) {
      if (base[i].role !== 'assistant') continue
      const persistedText = stripMcpCallFormatText(
        base[i].display_text || base[i].content,
      ).trim()
      const sameReply = persistedText === liveText
        || (Math.min(persistedText.length, liveText.length) >= 12
          && (persistedText.startsWith(liveText) || liveText.startsWith(persistedText)))
      if (sameReply) base.splice(i, 1)
      break
    }
    base.push(liveMessage)
  }
  return base
})

const onDelete = (idx: number) => {
  emit('delete', idx, renderMessages.value[idx] || null)
}

const onRecall = (idx: number) => {
  emit('recall', idx, renderMessages.value[idx] || null)
}

const onApply = (msgIdx: number, blockIdx: number) => {
  emit('apply', msgIdx, blockIdx, renderMessages.value[msgIdx] || null)
}

const onRevert = (msgIdx: number, blockIdx: number) => {
  emit('revert', msgIdx, blockIdx, renderMessages.value[msgIdx] || null)
}
</script>

<template>
  <ChatMessageList
    :messages="renderMessages"
    :appliedEdits="mergedAppliedEdits"
    :appliedSignatures="mergedAppliedSignatures"
    :actionResults="mergedActionResults"
    :actionResultsBySignature="mergedActionResultsBySignature"
    :isTyping="isTyping"
    :thinkingText="typingThinkingText"
    :stripMarkdownSymbols="stripMarkdownSymbols"
    :isEmpty="renderMessages.length === 0"
    :readonly="readonly"
    :thinkingIcon="thinkingIcon"
    :mcpIcon="mcpIcon"
    :mcpSuccessIcon="mcpSuccessIcon"
    :mcpErrorIcon="mcpErrorIcon"
    @delete="onDelete"
    @recall="onRecall"
    @apply="onApply"
    @revert="onRevert"
  />
</template>
