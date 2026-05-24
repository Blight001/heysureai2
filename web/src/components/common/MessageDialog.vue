<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useMessage } from '@/composables/useMessage'

const { state } = useMessage()
const promptValue = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

watch(() => state.show, (newVal) => {
  if (newVal) {
    promptValue.value = state.defaultValue || ''
    if (state.dialogType === 'prompt') {
      nextTick(() => {
        inputRef.value?.focus()
      })
    }
  }
})

const handleConfirm = () => {
  if (state.dialogType === 'prompt') {
    state.resolve(promptValue.value)
  } else if (state.dialogType === 'confirm') {
    state.resolve(true)
  } else {
    state.resolve(void 0)
  }
  state.show = false
}

const handleCancel = () => {
  if (state.dialogType === 'confirm' || state.dialogType === 'prompt') {
    state.resolve(state.dialogType === 'confirm' ? false : null)
  }
  state.show = false
}

const getIcon = () => {
  switch (state.type) {
    case 'success':
      return {
        class: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
        path: 'M5 13l4 4L19 7'
      }
    case 'warning':
      return {
        class: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
        path: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
      }
    case 'error':
      return {
        class: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
        path: 'M6 18L18 6M6 6l12 12'
      }
    default:
      return {
        class: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
        path: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
      }
  }
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div v-if="state.show" class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-zinc-900/40 backdrop-blur-sm transition-opacity" @click="handleCancel"></div>

      <!-- Modal Content -->
      <div class="relative bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-sm border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div class="p-6">
          <div class="flex items-start space-x-4">
            <!-- Icon -->
            <div :class="['flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center', getIcon().class]">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIcon().path" />
              </svg>
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <h3 class="text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate mb-1">
                {{ state.title }}
              </h3>
              <p class="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed whitespace-pre-wrap">
                {{ state.message }}
              </p>

              <!-- Prompt Input -->
              <div v-if="state.dialogType === 'prompt'" class="mt-4">
                <input
                  ref="inputRef"
                  v-model="promptValue"
                  type="text"
                  :placeholder="state.placeholder"
                  class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                  @keyup.enter="handleConfirm"
                  @keyup.esc="handleCancel"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="bg-zinc-50 dark:bg-zinc-900/50 px-6 py-4 flex flex-row-reverse gap-3 border-t border-zinc-100 dark:border-zinc-800/50">
          <button
            @click="handleConfirm"
            class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm shadow-indigo-200 dark:shadow-none min-w-[5rem]"
          >
            {{ state.confirmText }}
          </button>
          <button
            v-if="state.dialogType !== 'alert'"
            @click="handleCancel"
            class="px-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors min-w-[5rem]"
          >
            {{ state.cancelText }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
