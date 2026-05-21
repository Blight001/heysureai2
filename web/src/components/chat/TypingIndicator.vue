<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  isTyping: boolean
  thinkingText?: string
}>()

const thinkingViewportRef = ref<HTMLElement | null>(null)
const thinkingTextRef = ref<HTMLElement | null>(null)
let thinkingRaf = 0
let thinkingOffset = 0
let lastThinkingText = ''

const stopThinkingMotion = () => {
  if (thinkingRaf) {
    window.cancelAnimationFrame(thinkingRaf)
    thinkingRaf = 0
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

  thinkingOffset = Math.min(
    maxScroll,
    thinkingOffset + thinkingScrollSpeed(String(props.thinkingText || '').length, maxScroll),
  )
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

watch(
  () => props.thinkingText,
  async (value) => {
    const nextText = String(value || '').trim()
    if (!nextText) {
      lastThinkingText = ''
      stopThinkingMotion()
      thinkingOffset = 0
      if (thinkingViewportRef.value) thinkingViewportRef.value.scrollTop = 0
      return
    }

    const shouldContinue = !!lastThinkingText
      && nextText.length >= lastThinkingText.length
      && nextText.startsWith(lastThinkingText)
    await nextTick()
    startThinkingMotion(!shouldContinue)
    lastThinkingText = nextText
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopThinkingMotion()
})
</script>

<template>
  <div v-if="isTyping" class="flex justify-start">
    <div class="thinking-text w-full max-w-[92%] min-w-0 text-sm text-zinc-500 dark:text-zinc-400">
      <div>正在思考中<span class="thinking-dots" aria-hidden="true"></span></div>
      <div v-if="String(props.thinkingText || '').trim()" class="thinking-window mt-1">
        <div
          ref="thinkingViewportRef"
          class="thinking-viewport"
          :title="props.thinkingText"
        >
          <p ref="thinkingTextRef" class="thinking-content">
            {{ props.thinkingText }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.2s steps(4, end) infinite;
}

.thinking-window {
  position: relative;
  height: 4.25em;
  min-height: 4.25em;
  max-height: 4.25em;
  max-width: 100%;
  overflow: hidden;
}

.thinking-viewport {
  height: 100%;
  overflow: hidden;
  line-height: 1.4167;
  max-width: 100%;
}

.thinking-window::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 1;
  background: linear-gradient(
    to top,
    rgb(124 58 237 / 0),
    rgb(88 28 135 / 0.12) 42%,
    rgb(24 24 27 / 0.32)
  );
  backdrop-filter: blur(1.5px);
  mask-image: linear-gradient(to top, transparent, rgb(0 0 0 / 0.35) 34%, black 100%);
}

.thinking-content {
  margin: 0;
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

:global(.dark) .thinking-window::before {
  background: linear-gradient(
    to top,
    rgb(124 58 237 / 0),
    rgb(88 28 135 / 0.18) 42%,
    rgb(0 0 0 / 0.46)
  );
}

@keyframes thinking-dots {
  0%,
  20% {
    content: '';
  }

  40% {
    content: '.';
  }

  60% {
    content: '..';
  }

  80%,
  100% {
    content: '...';
  }
}
</style>
