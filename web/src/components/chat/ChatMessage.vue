<script setup lang="ts">
import ChatCollapsible from './ChatCollapsible.vue'
import InlineContent from './InlineContent.vue'
import type { InlineContent as InlineContentType } from '@/utils/chatParser'
import { computed, ref } from 'vue'
import { stripMarkdownFormatting } from '@/utils/chatMarkdown'
import { parseMcpToolBubbleDetails } from '@/utils/mcpFormat'

const emit = defineEmits<{
  (e: 'delete', idx: number): void
  (e: 'recall', idx: number): void
  (e: 'apply', msgIdx: number, blockIdx: number): void
  (e: 'revert', msgIdx: number, blockIdx: number): void
}>()

const props = defineProps<{
  message: {
    role: 'user' | 'assistant' | 'system'
    content: string
    think?: string
    display_text?: string
    inlineContent?: InlineContentType[]
    front_prompt_details?: string
    id?: number
    created_at?: number
  }
  appliedEdits: string[]
  appliedSignatures: string[]
  actionResults: Record<string, string>
  actionResultsBySignature: Record<string, string>
  idx: number
  readonly?: boolean
  plainTextMode?: boolean
  mcpIcon?: string
  embedded?: boolean
  thinkOnly?: boolean
  hideThink?: boolean
  timeLabel?: string
}>()

const isFrontPromptMessage = computed(() => {
  if (props.message.role !== 'system') return false
  const text = String(props.message.display_text || props.message.content || '')
  return text.startsWith('[前置 Prompt]')
})

const isSystemNoticeMessage = computed(() => {
  if (props.message.role !== 'user' && props.message.role !== 'system') return false
  const text = String(props.message.display_text || props.message.content || '').trim()
  return text.startsWith('[系统提示]') || text.startsWith('【任务完成回执】')
})

const isTaskCompleteNotice = computed(() => {
  const text = String(props.message.display_text || props.message.content || '').trim()
  return text.startsWith('【任务完成回执】')
    || text.includes('任务已通过 `plan.finish` 收尾')
    || text.includes('本任务对话已自动锁定')
})

const isRunErrorNotice = computed(() => {
  const text = String(props.message.display_text || props.message.content || '').trim()
  return props.message.role === 'system' && text.startsWith('[AI 对话出错]')
})

const isMcpToolMessage = computed(() => {
  const text = String(props.message.display_text || props.message.content || '').trim()
  return props.message.role === 'system' && text.startsWith('[MCP工具]')
})

const isPlainAssistantMessage = computed(() => {
  return props.message.role === 'assistant'
})

const mcpToolSummary = computed(() => {
  const text = String(props.message.display_text || props.message.content || '').trim()
  const tool = String(text.match(/^工具[：:]\s*(.+)$/m)?.[1] || 'MCP 工具').trim()
  const status = String(text.match(/^状态[：:]\s*(.+)$/m)?.[1] || '').trim()
  return { tool, status }
})

// Trailing "[截图] <url>" marker the backend appends to screenshot MCP bubbles.
const SCREENSHOT_MARKER_RE = /\n*\[截图\]\s*\n\s*(\S+)\s*$/

const mcpImageUrl = computed(() => {
  const text = String(props.message.display_text || props.message.content || '')
  return String(text.match(SCREENSHOT_MARKER_RE)?.[1] || '').trim()
})

const mcpToolSections = computed(() => {
  const text = String(props.message.display_text || props.message.content || '').trim()
  return parseMcpToolBubbleDetails(text, mcpToolSummary.value.tool)
})

const copiedTarget = ref('')
const frontPromptDetailsOpen = ref(false)

const userMessageCopyText = computed(() => {
  return String(props.message.display_text || props.message.content || '')
})

const copyText = async (text: string, target: string) => {
  const value = String(text || '')
  if (!value) return
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    copiedTarget.value = target
    window.setTimeout(() => {
      if (copiedTarget.value === target) copiedTarget.value = ''
    }, 1200)
  } catch (error) {
    console.warn('copy failed', error)
  }
}

const normalizedInlineContent = computed<InlineContentType[]>(() => {
  if (Array.isArray(props.message.inlineContent) && props.message.inlineContent.length > 0) {
    return props.message.inlineContent
  }
  const text = String(props.message.display_text || props.message.content || '')
  if (!text) return []
  return [{ type: 'text', content: text }]
})

const frontPromptDetailsText = computed(() => {
  return String(props.message.front_prompt_details || '')
})

const renderedThinkText = computed(() => {
  const think = String(props.message.think || '')
  if (!props.plainTextMode) return think
  return stripMarkdownFormatting(think)
})

const segmentTimeLabel = computed(() => String(props.timeLabel || '').trim())
</script>

<template>
  <div
    class="flex flex-col gap-1.5"
    :class="[
      (isFrontPromptMessage || isTaskCompleteNotice) ? 'items-center' : ((props.message.role === 'user' && !isSystemNoticeMessage) ? 'items-end' : 'items-start'),
      isMcpToolMessage ? '!mt-0.5' : '',
      props.embedded ? '!gap-1' : ''
    ]"
  >
    <div
      class="group relative"
      :class="props.embedded ? 'w-full max-w-full' : (isPlainAssistantMessage ? 'max-w-[95%] sm:max-w-[92%]' : 'max-w-[95%] sm:max-w-[85%]')"
    >
      <!-- Think Block — Codex-style: dim/italic body on a quiet left rail -->
      <div v-if="renderedThinkText && !props.hideThink" class="mb-1">
        <ChatCollapsible
          details-class="group/think"
          summary-class="flex items-center gap-1 py-0.5 text-[11px] leading-4 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 cursor-pointer select-none transition-colors"
          body-class="mt-1 ml-1 pl-2.5 border-l border-zinc-200 dark:border-zinc-700/80 text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed italic whitespace-pre-wrap"
        >
          <template #summary>
            <span class="chat-collapsible-arrow text-[10px] leading-none">➣</span>
            <span class="font-medium tracking-wide">深度思考</span>
            <span v-if="segmentTimeLabel" class="segment-time-badge">{{ segmentTimeLabel }}</span>
          </template>
          {{ renderedThinkText }}
        </ChatCollapsible>
      </div>
      
      <!-- Main Content -->
      <div
        v-if="!props.thinkOnly"
        :class="[
          isPlainAssistantMessage
            ? 'px-0 py-1 border-0 bg-transparent text-zinc-800 shadow-none hover:shadow-none dark:text-zinc-200'
          : (props.message.role === 'user' && !isSystemNoticeMessage)
            ? 'bg-indigo-600 border-indigo-500 text-white rounded-tr-sm shadow-indigo-200/50 dark:shadow-none'
            : isTaskCompleteNotice
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 rounded-xl dark:bg-emerald-500/15 dark:border-emerald-500/40 dark:text-emerald-200'
            : isSystemNoticeMessage
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 rounded-tl-sm dark:bg-emerald-500/15 dark:border-emerald-500/40 dark:text-emerald-200'
            : isFrontPromptMessage
              ? 'bg-violet-50 border-violet-200 text-zinc-800 dark:bg-violet-500/15 dark:border-violet-500/40 dark:text-zinc-100'
            : isRunErrorNotice
              ? 'bg-rose-50 border-rose-300 text-rose-800 rounded-tl-sm dark:bg-rose-500/15 dark:border-rose-500/40 dark:text-rose-200'
            : isMcpToolMessage
              ? 'text-sky-700 dark:text-sky-300'
            : props.message.role === 'system'
                ? 'bg-zinc-100 border-zinc-200 text-zinc-700 font-mono text-xs dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300'
                : 'bg-white border-zinc-200 text-zinc-800 rounded-tl-sm shadow-sm dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-200',
          (isPlainAssistantMessage || isMcpToolMessage) ? '' : 'px-4 py-3 rounded-2xl border hover:shadow-md',
          isFrontPromptMessage ? 'front-prompt-bubble' : ''
        ]"
      >
        
        <button
          v-if="isFrontPromptMessage && frontPromptDetailsText"
          class="front-prompt-detail-button"
          @click.stop="frontPromptDetailsOpen = true"
        >
          详情
        </button>

        <!-- Delete & Recall Buttons (hover 显示) -->
        <div v-if="!props.readonly && props.message.role === 'user' && !isSystemNoticeMessage" class="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <!-- Copy Button -->
          <button
            @click.stop="copyText(userMessageCopyText, `user-${props.idx}`)"
            class="w-6 h-6 rounded-full bg-zinc-600 text-white flex items-center justify-center shadow-md hover:bg-zinc-700 transition-colors"
            :title="copiedTarget === `user-${props.idx}` ? '已复制' : '复制用户消息'"
          >
            <svg v-if="copiedTarget !== `user-${props.idx}`" xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 8h10v10H8z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 16H5a2 2 0 01-2-2V5a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <!-- Recall Button (仅用户消息显示) -->
          <button 
            @click.stop="emit('recall', props.idx)"
            class="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-md hover:bg-amber-600 transition-colors"
            title="撤回此消息及之后所有对话"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <!-- Delete Button -->
          <button 
            @click.stop="emit('delete', props.idx)"
            class="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-md hover:bg-red-600 transition-colors"
            title="删除此消息"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div
          v-if="isMcpToolMessage"
          class="text-[13px] leading-snug"
        >
          <a
            v-if="mcpImageUrl"
            :href="mcpImageUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="mcp-screenshot-link"
            title="点击查看原图"
          >
            <img :src="mcpImageUrl" alt="截图" class="mcp-screenshot" loading="lazy" />
          </a>
          <ChatCollapsible
            details-class="mcp-details group/mcp"
            summary-class="flex items-center gap-2 whitespace-nowrap cursor-pointer select-none leading-5 py-0.5 text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
            body-class="relative mt-1 ml-0.5 pl-2.5 border-l border-zinc-200 dark:border-zinc-700/80"
          >
            <template #summary>
              <span
                class="chat-collapsible-status-dot shrink-0 h-1.5 w-1.5 rounded-full"
                :class="mcpToolSummary.status === '失败' ? 'bg-rose-500' : 'bg-emerald-500'"
              ></span>
              <span class="shrink-0 text-[11px] font-medium text-inherit">{{ mcpToolSummary.status === '失败' ? '调用失败' : '已调用' }}</span>
              <span class="min-w-0 truncate font-mono text-[11px] text-inherit">{{ mcpToolSummary.tool }}</span>
              <span v-if="segmentTimeLabel" class="segment-time-badge ml-auto">{{ segmentTimeLabel }}</span>
            </template>
              <button
                class="absolute right-0 top-0 w-6 h-6 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center justify-center transition-colors"
                :title="copiedTarget === `mcp-${props.idx}` ? '已复制' : '复制全部 MCP 信息'"
                @click.stop.prevent="copyText(mcpToolSections.copyText, `mcp-${props.idx}`)"
              >
                <svg v-if="copiedTarget !== `mcp-${props.idx}`" xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 8h10v10H8z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 16H5a2 2 0 01-2-2V5a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <div class="mcp-detail-doc max-h-72 overflow-y-auto pr-8 font-mono text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
                <template v-if="mcpToolSections.params">
                  <div class="mcp-detail-line">[参数]</div>
                  <pre class="mcp-detail-body">{{ mcpToolSections.params }}</pre>
                </template>
                <template v-if="mcpToolSections.result">
                  <div class="mcp-detail-line">[结果]</div>
                  <pre class="mcp-detail-body">{{ mcpToolSections.result }}</pre>
                </template>
                <template v-if="mcpToolSections.error">
                  <div class="mcp-detail-line mcp-detail-line-error">[错误]</div>
                  <pre class="mcp-detail-body mcp-detail-body-error">{{ mcpToolSections.error }}</pre>
                </template>
              </div>
          </ChatCollapsible>
        </div>
        <div
          v-else
          class="whitespace-pre-wrap text-[13px] leading-relaxed"
          :class="[
            (props.message.role === 'user' && !isSystemNoticeMessage) ? 'text-white' : '',
            isFrontPromptMessage ? 'text-left w-full front-prompt-content' : ''
          ]"
        >
          <template v-if="normalizedInlineContent.length > 0">
            <InlineContent 
              :content="normalizedInlineContent"
              :mcpIcon="props.mcpIcon"
              :appliedEdits="props.appliedEdits"
              :appliedSignatures="props.appliedSignatures"
              :actionResults="props.actionResults"
              :actionResultsBySignature="props.actionResultsBySignature"
              :plainTextMode="props.plainTextMode"
              @apply="(blockIdx) => emit('apply', props.idx, blockIdx)"
              @revert="(blockIdx) => emit('revert', props.idx, blockIdx)"
            />
          </template>
        </div>
      </div>
    </div>

    <div
      v-if="isFrontPromptMessage && frontPromptDetailsOpen"
      class="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4 backdrop-blur-sm"
      @click.self="frontPromptDetailsOpen = false"
    >
      <div class="front-prompt-detail-modal">
        <div class="front-prompt-detail-header">
          <div>
            <div class="text-sm font-bold text-zinc-900 dark:text-zinc-100">MCP 工具目录</div>
            <div class="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">按工作区与端侧设备分组的 MCP 工具简表。</div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="front-prompt-detail-action"
              :title="copiedTarget === `front-prompt-details-${props.idx}` ? '已复制' : '复制详情'"
              @click.stop="copyText(frontPromptDetailsText, `front-prompt-details-${props.idx}`)"
            >
              {{ copiedTarget === `front-prompt-details-${props.idx}` ? '已复制' : '复制' }}
            </button>
            <button class="front-prompt-detail-close" @click="frontPromptDetailsOpen = false">×</button>
          </div>
        </div>
        <pre class="front-prompt-detail-pre">{{ frontPromptDetailsText }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.front-prompt-bubble {
  position: relative;
  height: 14rem;
  overflow-y: auto;
  overflow-x: hidden;
}

.front-prompt-content {
  min-height: 100%;
}

.mcp-detail-doc {
  white-space: pre-wrap;
  word-break: break-word;
}

.mcp-detail-line {
  margin: 0;
  font-weight: 500;
  color: rgb(82 82 91);
}

.mcp-detail-line-error {
  color: rgb(190 18 60);
}

.dark .mcp-detail-line {
  color: rgb(212 212 216);
}

.dark .mcp-detail-line-error {
  color: rgb(251 113 133);
}

.mcp-detail-body {
  margin: 0 0 0.35rem;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

.mcp-detail-body-error {
  color: rgb(190 18 60);
}

.dark .mcp-detail-body {
  color: rgb(161 161 170);
}

.dark .mcp-detail-body-error {
  color: rgb(251 113 133);
}

.mcp-screenshot-link {
  display: inline-block;
  margin-bottom: 6px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgb(228 228 231);
  background: rgb(244 244 245);
}

.dark .mcp-screenshot-link {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27);
}

.mcp-screenshot {
  display: block;
  max-width: min(420px, 100%);
  max-height: 320px;
  width: auto;
  height: auto;
  object-fit: contain;
  cursor: zoom-in;
}

.segment-time-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 0 0.45rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.8);
  color: rgb(100 116 139);
  font-size: 10px;
  line-height: 1.3;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.dark .segment-time-badge {
  border-color: rgba(71, 85, 105, 0.65);
  background: rgba(24, 24, 27, 0.85);
  color: rgb(148 163 184);
}

.front-prompt-detail-button {
  position: sticky;
  top: 0;
  float: right;
  z-index: 2;
  margin: -2px -2px 8px 12px;
  padding: 3px 8px;
  border: 1px solid rgba(124, 58, 237, 0.28);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  color: rgb(109 40 217);
  font-size: 11px;
  font-weight: 700;
}

.dark .front-prompt-detail-button {
  background: rgba(24, 24, 27, 0.92);
  border-color: rgba(167, 139, 250, 0.35);
  color: rgb(196 181 253);
}

.front-prompt-detail-modal {
  width: min(860px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgb(228 228 231);
  border-radius: 14px;
  background: white;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.22);
}

.dark .front-prompt-detail-modal {
  border-color: rgb(63 63 70);
  background: rgb(24 24 27);
}

.front-prompt-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid rgb(228 228 231);
}

.dark .front-prompt-detail-header {
  border-bottom-color: rgb(63 63 70);
}

.front-prompt-detail-action,
.front-prompt-detail-close {
  border: 1px solid rgb(228 228 231);
  border-radius: 8px;
  background: rgb(250 250 250);
  color: rgb(63 63 70);
  font-size: 12px;
  font-weight: 700;
}

.front-prompt-detail-action {
  padding: 6px 10px;
}

.front-prompt-detail-close {
  width: 30px;
  height: 30px;
  font-size: 20px;
  line-height: 1;
}

.dark .front-prompt-detail-action,
.dark .front-prompt-detail-close {
  border-color: rgb(63 63 70);
  background: rgb(39 39 42);
  color: rgb(228 228 231);
}

.front-prompt-detail-pre {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 14px 16px;
  background: rgb(9 9 11);
  color: rgb(244 244 245);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
