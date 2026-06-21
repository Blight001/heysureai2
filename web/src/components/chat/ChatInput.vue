<script setup lang="ts">
import FileSelector from './FileSelector.vue'
import { computed } from 'vue'

const props = defineProps<{
  modelValue: string
  isTyping: boolean
  isFileSelectorOpen: boolean
  allFiles: string[]
  selectedFiles: string[]
  currentPath: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send'): void
  (e: 'toggleFileSelector'): void
  (e: 'closeFileSelector'): void
  (e: 'navigateTo', path: string): void
  (e: 'navigateBack'): void
  (e: 'toggleFile', file: string): void
  (e: 'clearFiles'): void
  (e: 'refreshFiles'): void
}>()

const inputValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 触屏设备（手机/平板）上回车应换行，由发送按钮触发发送，避免软键盘回车误发
const isCoarsePointer = typeof window !== 'undefined' && !!window.matchMedia
  && window.matchMedia('(pointer: coarse)').matches

const handleKeydown = (e: KeyboardEvent) => {
  if (isCoarsePointer) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    emit('send')
  }
}

const handleInput = (e: Event) => {
  const target = e.target as HTMLTextAreaElement
  target.style.height = 'auto'
  target.style.height = Math.max(40, Math.min(target.scrollHeight, 120)) + 'px'
  emit('update:modelValue', target.value)
}
</script>

<template>
  <div class="flex gap-2 items-center pt-2 border-t border-zinc-100 dark:border-zinc-800">
    <div class="relative">
      <button 
        @click="emit('toggleFileSelector')"
        class="h-10 px-3 text-xs rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 hover:text-indigo-600 hover:border-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-all flex items-center justify-center gap-1.5 min-w-[80px] shadow-sm"
      >
        <span class="text-sm">📁</span> <span class="font-medium">{{ selectedFiles.length }}</span>
      </button>
      
      <FileSelector 
        :isOpen="isFileSelectorOpen"
        :allFiles="allFiles"
        :selectedFiles="selectedFiles"
        :currentPath="currentPath"
        @close="emit('closeFileSelector')"
        @navigate="emit('navigateTo', $event)"
        @navigateBack="emit('navigateBack')"
        @toggle="emit('toggleFile', $event)"
        @clear="emit('clearFiles')"
        @refresh="emit('refreshFiles')"
      />
    </div>

    <div class="flex-1">
      <textarea 
        v-model="inputValue"
        rows="1"
        class="chat-input-textarea w-full px-3 py-[9px] text-sm leading-5 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all shadow-sm resize-none overflow-hidden h-10 min-h-[40px] max-h-[120px] box-border" 
        placeholder="给主脑发送指令..." 
        @keydown="handleKeydown" 
        @input="handleInput"
      ></textarea>
    </div>
    <button 
      class="h-10 px-3 rounded-xl text-white transition-all shadow-sm flex items-center justify-center"
      :class="inputValue.trim() && !isTyping ? 'bg-indigo-600 hover:bg-indigo-500 hover:shadow active:scale-95' : 'bg-zinc-300 dark:bg-zinc-700 cursor-not-allowed'"
      @click="emit('send')" 
      :disabled="!inputValue.trim() || isTyping"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
        <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
      </svg>
    </button>
  </div>
</template>
