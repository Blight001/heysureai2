<script setup lang="ts">
import { computed, ref } from 'vue'

interface Props {
  show: boolean
  globalMcpCallMethod: string
  globalMcpFormatErrorHint: string
  defaultStartTaskPrompt: string
  defaultResumeTaskPrompt: string
  defaultSupervisionPrompt: string
  defaultSupervisionIdleSeconds: number
  defaultInheritanceNotice: string
  themeMode: 'light' | 'dark'
  fontSize: 'sm' | 'md' | 'lg'
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'update:show', value: boolean): void
  (e: 'update:globalMcpCallMethod', value: string): void
  (e: 'update:globalMcpFormatErrorHint', value: string): void
  (e: 'update:defaultStartTaskPrompt', value: string): void
  (e: 'update:defaultResumeTaskPrompt', value: string): void
  (e: 'update:defaultSupervisionPrompt', value: string): void
  (e: 'update:defaultSupervisionIdleSeconds', value: number): void
  (e: 'update:defaultInheritanceNotice', value: string): void
  (e: 'update:themeMode', value: 'light' | 'dark'): void
  (e: 'update:fontSize', value: 'sm' | 'md' | 'lg'): void
  (e: 'viewAllMcp'): void
  (e: 'save'): void
}>()

const themeModeValue = computed({
  get: () => props.themeMode,
  set: value => emit('update:themeMode', value)
})

const fontSizeValue = computed({
  get: () => props.fontSize,
  set: value => emit('update:fontSize', value)
})

const globalMcpCallMethodValue = computed({
  get: () => props.globalMcpCallMethod,
  set: value => emit('update:globalMcpCallMethod', value)
})

const globalMcpFormatErrorHintValue = computed({
  get: () => props.globalMcpFormatErrorHint,
  set: value => emit('update:globalMcpFormatErrorHint', value)
})

const defaultStartTaskPromptValue = computed({
  get: () => props.defaultStartTaskPrompt,
  set: value => emit('update:defaultStartTaskPrompt', value)
})

const defaultResumeTaskPromptValue = computed({
  get: () => props.defaultResumeTaskPrompt,
  set: value => emit('update:defaultResumeTaskPrompt', value)
})

const defaultSupervisionPromptValue = computed({
  get: () => props.defaultSupervisionPrompt,
  set: value => emit('update:defaultSupervisionPrompt', value)
})

const defaultSupervisionIdleSecondsValue = computed({
  get: () => Number(props.defaultSupervisionIdleSeconds || 25),
  set: value => emit('update:defaultSupervisionIdleSeconds', Number(value) || 25)
})

const defaultInheritanceNoticeValue = computed({
  get: () => props.defaultInheritanceNotice,
  set: value => emit('update:defaultInheritanceNotice', value)
})

const activeConfigSection = ref<'' | 'mcp' | 'task'>('')

const toggleConfigSection = (name: 'mcp' | 'task') => {
  activeConfigSection.value = activeConfigSection.value === name ? '' : name
}
</script>

<template>
  <Transition name="fade">
    <div v-if="show" class="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center backdrop-blur-sm" @click="emit('update:show', false)">
      <div class="bg-white rounded-2xl shadow-xl w-[560px] max-h-[90vh] overflow-y-auto p-6 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800" @click.stop>
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <span>⚙️</span> 系统全能设置
          </h3>
          <button @click="emit('update:show', false)" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="space-y-6">
          <div class="p-4 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <h4 class="text-sm font-semibold text-zinc-800 mb-3 dark:text-zinc-100 flex items-center gap-2">🎨 界面偏好</h4>
            <div class="grid grid-cols-2 gap-6">
              <div>
                <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">主题模式</div>
                <div class="flex gap-2">
                  <button v-for="mode in (['light', 'dark'] as const)" :key="mode" @click="themeModeValue = mode" class="flex-1 px-3 py-1.5 rounded-lg border text-xs transition-all" :class="themeModeValue === mode ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'">
                    {{ mode === 'light' ? '✨ 亮色' : '🌙 暗色' }}
                  </button>
                </div>
              </div>
              <div>
                <div class="text-xs text-zinc-500 mb-2 dark:text-zinc-400">文字大小</div>
                <div class="flex gap-1">
                  <button v-for="size in (['sm', 'md', 'lg'] as const)" :key="size" @click="fontSizeValue = size" class="flex-1 px-2 py-1.5 rounded-lg border text-xs transition-all" :class="fontSizeValue === size ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400'">
                    {{ size === 'sm' ? '小' : size === 'md' ? '中' : '大' }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="p-4 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <button
              class="w-full flex items-center justify-between text-left"
              @click="toggleConfigSection('mcp')"
            >
              <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">🧰 MCP 配置</h4>
              <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ activeConfigSection === 'mcp' ? '收起' : '展开' }}</span>
            </button>
            <Transition name="section-collapse">
              <div v-show="activeConfigSection === 'mcp'" class="mt-3 space-y-4 section-collapse-body">
                <div class="flex items-center justify-end">
                  <button
                    class="px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 text-xs font-medium hover:bg-indigo-100 dark:border-indigo-500/40 dark:text-indigo-300 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20"
                    @click="emit('viewAllMcp')"
                  >
                    查看当前全部MCP
                  </button>
                </div>
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">全局 MCP 调用规范</div>
                  <textarea
                    v-model="globalMcpCallMethodValue"
                    rows="14"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs leading-relaxed font-mono"
                    placeholder="粘贴全局 MCP 调用方法模板，例如包含 <mcp-call> ... </mcp-call>、Available MCP tools include: {MCP} 和 Rules"
                  ></textarea>
                </div>
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">MCP 格式错误提示</div>
                  <textarea
                    v-model="globalMcpFormatErrorHintValue"
                    rows="10"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs leading-relaxed"
                    placeholder="当检测到 AI 试图调用 MCP 但格式错误时，自动回注的系统提示文案。可使用 {details}、{format_error_count} 等占位符。"
                  ></textarea>
                </div>
              </div>
            </Transition>
          </div>

          <div class="p-4 bg-zinc-50 rounded-xl dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
            <button
              class="w-full flex items-center justify-between text-left"
              @click="toggleConfigSection('task')"
            >
              <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">🧭 默认任务提示词</h4>
              <span class="text-xs text-zinc-500 dark:text-zinc-400">{{ activeConfigSection === 'task' ? '收起' : '展开' }}</span>
            </button>
            <Transition name="section-collapse">
              <div v-show="activeConfigSection === 'task'" class="mt-3 space-y-3 section-collapse-body">
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">启动执行任务提示词</div>
                  <textarea
                    v-model="defaultStartTaskPromptValue"
                    rows="2"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"
                  ></textarea>
                </div>
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">继续被暂停任务提示词</div>
                  <textarea
                    v-model="defaultResumeTaskPromptValue"
                    rows="2"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"
                  ></textarea>
                </div>
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">任务监督提示词（AI 未标记完成时自动追问）</div>
                  <textarea
                    v-model="defaultSupervisionPromptValue"
                    rows="2"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"
                  ></textarea>
                </div>
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">AI 停止思考超过多久后提醒（秒）</div>
                  <input
                    v-model.number="defaultSupervisionIdleSecondsValue"
                    type="number"
                    min="5"
                    max="3600"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"
                  />
                  <p class="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">当任务 run 停止后，超过该时长且未调用 task.complete，系统会自动发起监督追问。</p>
                </div>
                <div>
                  <div class="text-xs text-zinc-500 mb-1 dark:text-zinc-400">传承提示文案（阈值默认使用上方 Token 上限）</div>
                  <textarea
                    v-model="defaultInheritanceNoticeValue"
                    rows="2"
                    class="w-full px-3 py-2 rounded-xl border border-zinc-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 transition-all text-xs"
                  ></textarea>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <div class="mt-8 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
          <button @click="emit('save'); emit('update:show', false)" class="px-6 py-2 bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 rounded-xl text-sm font-bold hover:opacity-90 active:scale-95 transition-all shadow-lg">完成</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.section-collapse-enter-active,
.section-collapse-leave-active {
  transition: max-height 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease, transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
}

.section-collapse-enter-from,
.section-collapse-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-6px);
}

.section-collapse-enter-to,
.section-collapse-leave-from {
  max-height: 1200px;
  opacity: 1;
  transform: translateY(0);
}

.section-collapse-body {
  will-change: max-height, opacity, transform;
}
</style>
