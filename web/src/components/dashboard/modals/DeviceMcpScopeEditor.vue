<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getDeviceMcpScope, setDeviceMcpScope, type DeviceMcpScope } from '@/api/devices'
import { getMcpToolParamRows, getMcpToolZhLabel } from '@/utils/mcpTools'

const props = defineProps<{
  deviceId: string
  // Re-fetch whenever this changes (e.g. device:list refresh tick).
  refreshKey?: string | number
}>()

const scope = ref<DeviceMcpScope | null>(null)
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const detailOpen = ref(false)

const load = async () => {
  if (!props.deviceId) return
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await getDeviceMcpScope(props.deviceId)
    scope.value = data
    selected.value = new Set(data.allowed || [])
  } catch (err: any) {
    scope.value = null
    error.value = err?.message || 'Agent MCP 权限加载失败'
  } finally {
    loading.value = false
  }
}

watch(() => [props.deviceId, props.refreshKey], load, { immediate: true })

const capabilities = computed(() => scope.value?.capabilities || [])
const scopeTitle = computed(() => {
  if (scope.value?.deviceType === 'toolbox') return '工具箱 MCP 权限'
  if (scope.value?.deviceType === 'workshop') return '图书馆 MCP 权限'
  if (scope.value?.deviceType === 'browser') return '浏览器端 MCP 权限'
  if (scope.value?.deviceType === 'android') return '安卓端 MCP 权限'
  return '软件端 MCP 权限'
})
// Scope is keyed per individual agent, so it can be configured even before the
// device is assigned an AI. Saving only needs a connected agent that reports
// tools.
const canSave = computed(() => capabilities.value.length > 0)
const allSelected = computed(() =>
  capabilities.value.length > 0 && capabilities.value.every(t => selected.value.has(t)),
)
const dirty = computed(() => {
  const base = new Set(scope.value?.allowed || [])
  if (base.size !== selected.value.size) return true
  for (const t of selected.value) if (!base.has(t)) return true
  return false
})

// 分类与扩展端 BROWSER_TOOL_CATEGORIES 保持一致。页面交互类已合并为 browser_action
// （点击/双击/右键/滚动/输入/按键），页面级导航（跳转 URL/前进后退/列出标签）并入
// browser_tab，状态管理类合并为 browser_cookie / browser_storage / browser_session /
// browser_profile（均带 action 参数）。下面同时兼容历史的按动词拆分旧名。
const browserIntro = (tool: string) => {
  if (['browser_tab', 'browser_navigate', 'browser_history'].includes(tool) || tool.startsWith('browser_history_') || tool.startsWith('browser_tab_')) {
    return '浏览器导航类工具，用于管理标签页、打开页面、跳转 URL、前进或后退。'
  }
  if (['browser_observe', 'browser_screenshot', 'browser_find_text', 'browser_performance', 'browser_network_log', 'browser_iframe_list'].includes(tool)) {
    return '浏览器观察类工具，用于观察可交互元素、截图、查看页面结构与状态。'
  }
  if (['browser_action', 'browser_click', 'browser_double_click', 'browser_right_click', 'browser_type', 'browser_press_key', 'browser_scroll', 'browser_wait', 'browser_drag'].includes(tool)) {
    return '浏览器交互类工具，用于点击、双击、右键、输入、滚动、按键与拖拽。'
  }
  if (['browser_evaluate', 'browser_extract', 'browser_clipboard_write', 'browser_file_upload', 'browser_download'].includes(tool)) {
    return '浏览器数据类工具，用于执行脚本、提取数据、读写剪贴板、上传或下载文件。'
  }
  if (['browser_cookie', 'browser_storage', 'browser_session', 'browser_profile'].includes(tool) || /^browser_(cookie|storage|session|profile)_/.test(tool)) {
    return '浏览器状态类工具，用于管理 Cookie、本地存储、会话快照与逻辑 profile。'
  }
  return '浏览器能力工具，用于当前页面或标签页相关的自动化操作。'
}

const basicToolIntro = (tool: string) => {
  const name = String(tool || '').trim()
  if (!name) return '未命名工具'
  if (name.startsWith('browser_')) return browserIntro(name)
  if (name.startsWith('desktop_')) return '桌面端工具，用于控制本机环境或桌面应用。'
  if (name.startsWith('fs_')) return '文件系统工具，用于查看、读取或写入工作区文件。'
  if (name.startsWith('shell_')) return '终端工具，用于执行命令行指令。'
  if (name.startsWith('git_')) return 'Git 工具，用于查看差异或处理版本库状态。'
  if (name.startsWith('keyboard_') || name.startsWith('mouse_')) return '键鼠输入工具，用于模拟键盘或鼠标操作。'
  if (name.startsWith('screen_')) return '屏幕工具，用于截屏或读取屏幕信息。'
  if (name.startsWith('clipboard_')) return '剪贴板工具，用于读取或写入系统剪贴板。'
  if (name.startsWith('window_')) return '窗口工具，用于列出、聚焦或关闭窗口。'
  if (name.startsWith('process_')) return '进程工具，用于列出或结束系统进程。'
  if (name.startsWith('touch.')) return '手机触控工具，用于点击、滑动、长按或返回/主屏/最近任务。'
  if (name.startsWith('screen.')) return '手机屏幕工具，用于截屏或录屏。'
  if (name === 'input.text') return '手机输入工具，用于向当前聚焦的输入框写入文本。'
  return '通用 MCP 工具。'
}

const toolDefinition = (tool: string) => scope.value?.toolDefs?.[tool] || {}

const toolDescription = (tool: string) => {
  return String(toolDefinition(tool).description || '').trim() || basicToolIntro(tool)
}

const toolParams = (tool: string) => getMcpToolParamRows({
  name: tool,
  description: toolDescription(tool),
  inputSchema: toolDefinition(tool).input_schema || {},
  destructive: !!toolDefinition(tool).destructive,
})

const toggle = (tool: string) => {
  const next = new Set(selected.value)
  if (next.has(tool)) next.delete(tool)
  else next.add(tool)
  selected.value = next
}

const toggleSelectAll = () => {
  selected.value = allSelected.value ? new Set() : new Set(capabilities.value)
}

const save = async () => {
  if (!props.deviceId || !canSave.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await setDeviceMcpScope(props.deviceId, Array.from(selected.value))
    scope.value = data
    selected.value = new Set(data.allowed || [])
    notice.value = '已保存'
  } catch (err: any) {
    error.value = err?.message || 'Agent MCP 权限保存失败'
  } finally {
    saving.value = false
  }
}

const label = (tool: string) => getMcpToolZhLabel(tool)

const openDetail = () => {
  detailOpen.value = true
}

const closeDetail = () => {
  detailOpen.value = false
}
</script>

<template>
  <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-2.5">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
          {{ scopeTitle }}
        </div>
        <div class="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
          {{ scope?.agentName || deviceId }}
          <span v-if="capabilities.length"> · {{ selected.size }} / {{ capabilities.length }}</span>
        </div>
      </div>
      <div class="shrink-0 flex items-center gap-1.5">
        <button
          v-if="capabilities.length"
          type="button"
          class="text-[10px] px-2 py-0.5 rounded border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
          @click="openDetail"
        >
          查看详情
        </button>
      </div>
    </div>

    <div v-if="loading" class="mt-2 text-[10px] text-zinc-400">加载中…</div>
    <div v-else-if="error" class="mt-2 text-[10px] text-rose-500">{{ error }}</div>
    <template v-else>
      <div v-if="capabilities.length === 0" class="mt-2 text-[10px] text-zinc-400">
        该设备未上报任何工具。
      </div>
      <div v-if="notice" class="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-300">{{ notice }}</div>
    </template>
  </div>

  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="detailOpen"
        class="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4"
        @click="closeDetail"
      >
        <div
          class="flex w-full max-w-5xl max-h-[86vh] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          @click.stop
        >
          <div class="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <div class="min-w-0">
              <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">MCP 权限详情</div>
              <div class="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                {{ scope?.agentName || deviceId }} · {{ capabilities.length }} 个工具
              </div>
            </div>
            <button
              type="button"
              class="rounded border border-zinc-200 px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              @click="closeDetail"
            >
              关闭
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto p-4">
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label
                v-for="tool in capabilities"
                :key="tool"
                class="flex h-full items-start gap-2 rounded-lg border px-2.5 py-2 cursor-pointer select-none transition-colors"
                :class="selected.has(tool)
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200'
                  : 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300'"
              >
                <input
                  type="checkbox"
                  class="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-500"
                  :checked="selected.has(tool)"
                  @change="toggle(tool)"
                />
                <span class="min-w-0">
                  <span class="flex items-center gap-1.5 text-[10px] font-mono font-semibold break-all" :title="`${label(tool)} (${tool})`">
                    {{ label(tool) }}
                    <span
                      v-if="toolDefinition(tool).destructive"
                      class="rounded bg-amber-100 px-1 py-0.5 font-sans text-[9px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                    >
                      写入/变更
                    </span>
                  </span>
                  <span class="mt-1 block text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                    {{ toolDescription(tool) }}
                  </span>
                  <span v-if="toolParams(tool).length" class="mt-1.5 block border-t border-zinc-200/80 pt-1.5 dark:border-zinc-700/80">
                    <span class="mb-1 block text-[9px] font-medium text-zinc-400">参数</span>
                    <span
                      v-for="param in toolParams(tool)"
                      :key="param.name"
                      class="mb-1 block text-[9px] leading-relaxed text-zinc-500 last:mb-0 dark:text-zinc-400"
                    >
                      <span class="font-mono font-semibold text-zinc-700 dark:text-zinc-200">{{ param.name }}</span>
                      <span> · {{ param.type }} · {{ param.required ? '必填' : '选填' }}</span>
                      <span v-if="param.description">：{{ param.description }}</span>
                    </span>
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div class="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                class="text-[10px] px-2 py-0.5 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                :disabled="capabilities.length === 0"
                @click="toggleSelectAll"
              >
                {{ allSelected ? '全不选' : '全选' }}
              </button>
              <button
                type="button"
                :disabled="!canSave || saving || !dirty"
                class="text-[10px] px-2 py-0.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40"
                @click="save"
              >
                {{ saving ? '...' : '保存' }}
              </button>
            </div>
            <div v-if="notice" class="mt-2 text-[10px] text-emerald-600 dark:text-emerald-300">{{ notice }}</div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
