<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

defineProps<{
  detailsClass?: string
  summaryClass?: string
  bodyClass?: string
}>()

const open = ref(false)
const innerRef = ref<HTMLElement | null>(null)
const contentHeight = ref(0)

let resizeObserver: ResizeObserver | null = null

const measureContentHeight = () => innerRef.value?.scrollHeight ?? 0

const syncOpenHeight = () => {
  if (!open.value) return
  contentHeight.value = measureContentHeight()
}

const expand = async () => {
  open.value = true
  await nextTick()
  contentHeight.value = 0
  requestAnimationFrame(() => {
    contentHeight.value = measureContentHeight()
  })
}

const collapse = async () => {
  contentHeight.value = measureContentHeight()
  await nextTick()
  requestAnimationFrame(() => {
    open.value = false
    contentHeight.value = 0
  })
}

const toggle = () => {
  if (open.value) void collapse()
  else void expand()
}

const onSummaryKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggle()
  }
}

onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !innerRef.value) return
  resizeObserver = new ResizeObserver(() => syncOpenHeight())
  resizeObserver.observe(innerRef.value)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div :class="['chat-collapsible', detailsClass, { 'is-open': open }]">
    <div
      :class="['chat-collapsible-summary', summaryClass]"
      role="button"
      tabindex="0"
      :aria-expanded="open"
      @click="toggle"
      @keydown="onSummaryKeydown"
    >
      <slot name="summary" />
    </div>
    <div
      class="chat-collapsible-content"
      :style="{ height: `${contentHeight}px` }"
    >
      <div ref="innerRef" :class="['chat-collapsible-body', bodyClass]">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-collapsible-summary {
  outline: none;
}

.chat-collapsible-summary:focus-visible {
  border-radius: 4px;
  box-shadow: 0 0 0 2px rgb(129 140 248 / 0.45);
}

.chat-collapsible-content {
  overflow: hidden;
  transition: height 0.34s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: height;
}

.chat-collapsible-body {
  opacity: 0;
  transform: translateY(-8px);
  transition:
    opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.34s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-collapsible.is-open .chat-collapsible-body {
  opacity: 1;
  transform: translateY(0);
  transition-delay: 0.06s;
}

.chat-collapsible:not(.is-open) .chat-collapsible-body {
  transition-delay: 0s;
  transition-duration: 0.16s;
}

.chat-collapsible :deep(.chat-collapsible-arrow) {
  display: inline-block;
  transition: transform 0.34s cubic-bezier(0.4, 0, 0.2, 1);
  transform-origin: center;
}

.chat-collapsible.is-open :deep(.chat-collapsible-arrow) {
  transform: rotate(90deg);
}

.chat-collapsible :deep(.chat-collapsible-status-dot) {
  transition: transform 0.34s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-collapsible.is-open :deep(.chat-collapsible-status-dot) {
  transform: scale(1.12);
}

@media (prefers-reduced-motion: reduce) {
  .chat-collapsible-content,
  .chat-collapsible-body,
  .chat-collapsible :deep(.chat-collapsible-arrow),
  .chat-collapsible :deep(.chat-collapsible-status-dot) {
    transition: none !important;
  }

  .chat-collapsible-body {
    opacity: 1;
    transform: none;
  }

  .chat-collapsible:not(.is-open) .chat-collapsible-content {
    display: none;
  }
}
</style>