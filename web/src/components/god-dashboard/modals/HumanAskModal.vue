<script setup lang="ts">
import { ref, computed } from 'vue'
import type { HumanAskEvent } from '../useDashboardData'

interface Props {
  event: HumanAskEvent | null
  onAnswered: (requestId: string) => void
}

const props = defineProps<Props>()

const textAnswer = ref('')
const selectedOption = ref('')
const submitting = ref(false)
const error = ref('')

const isVisible = computed(() => !!props.event)

const kindLabel = computed(() => {
  if (!props.event) return ''
  if (props.event.kind === 'confirm') return '确认'
  if (props.event.kind === 'select') return '选择'
  return '文本回复'
})

const resetState = () => {
  textAnswer.value = ''
  selectedOption.value = ''
  submitting.value = false
  error.value = ''
}

const submitAnswer = async (answer: string) => {
  if (!props.event || submitting.value) return
  const trimmed = answer.trim()
  if (!trimmed) {
    error.value = '请输入或选择一个回答'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/human/answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_id: props.event.requestId, answer: trimmed }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as any).detail || `HTTP ${res.status}`)
    }
    resetState()
    props.onAnswered(props.event.requestId)
  } catch (err: any) {
    error.value = err?.message || '提交失败'
  } finally {
    submitting.value = false
  }
}

const cancelRequest = async () => {
  if (!props.event || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const token = localStorage.getItem('token')
    await fetch('/api/human/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ request_id: props.event.requestId, answer: '' }),
    })
    resetState()
    props.onAnswered(props.event.requestId)
  } catch (err: any) {
    error.value = err?.message || '取消失败'
  } finally {
    submitting.value = false
  }
}

const onSelectOption = (opt: string) => {
  selectedOption.value = opt
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="isVisible && event"
      class="fixed inset-0 z-[200] bg-black/60 flex items-center justify-center p-4"
    >
      <div class="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-2xl w-full max-w-md p-5">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">AI 提问</span>
          <span class="text-xs text-zinc-400">{{ kindLabel }}</span>
          <span v-if="event.aiConfigId" class="ml-auto text-xs text-zinc-400">AI #{{ event.aiConfigId }}</span>
        </div>

        <p class="text-sm text-zinc-800 dark:text-zinc-100 mb-4 leading-relaxed whitespace-pre-wrap">{{ event.prompt }}</p>

        <!-- confirm / select: option buttons -->
        <div v-if="event.kind === 'confirm' || event.kind === 'select'" class="flex flex-wrap gap-2 mb-4">
          <button
            v-for="opt in event.options"
            :key="opt"
            class="px-3 py-1.5 text-sm rounded-lg border transition-colors"
            :class="
              selectedOption === opt
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            "
            :disabled="submitting"
            @click="onSelectOption(opt)"
          >
            {{ opt }}
          </button>
        </div>

        <!-- text: textarea -->
        <div v-if="event.kind === 'text'" class="mb-4">
          <textarea
            v-model="textAnswer"
            rows="3"
            class="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-transparent dark:text-zinc-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="请输入你的回复…"
            :disabled="submitting"
          />
        </div>

        <p v-if="error" class="text-xs text-red-500 mb-3">{{ error }}</p>

        <div class="flex items-center gap-2 justify-end">
          <button
            class="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            :disabled="submitting"
            @click="cancelRequest"
          >
            忽略
          </button>
          <button
            class="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            :disabled="submitting || (event.kind !== 'text' && !selectedOption)"
            @click="event.kind === 'text' ? submitAnswer(textAnswer) : submitAnswer(selectedOption)"
          >
            {{ submitting ? '提交中…' : '提交' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
