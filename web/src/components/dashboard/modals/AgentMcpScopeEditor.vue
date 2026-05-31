<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getAgentMcpScope, setAgentMcpScope, type AgentMcpScope } from '@/api/agents'
import { getMcpToolZhLabel } from '@/utils/mcpTools'

const props = defineProps<{
  agentId: string
  // Re-fetch whenever this changes (e.g. agent:list refresh tick).
  refreshKey?: string | number
}>()

const scope = ref<AgentMcpScope | null>(null)
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const detailOpen = ref(false)

const load = async () => {
  if (!props.agentId) return
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await getAgentMcpScope(props.agentId)
    scope.value = data
    selected.value = new Set(data.allowed || [])
  } catch (err: any) {
    scope.value = null
    error.value = err?.message || 'Agent MCP 权限加载失败'
  } finally {
    loading.value = false
  }
}

watch(() => [props.agentId, props.refreshKey], load, { immediate: true })

const capabilities = computed(() => scope.value?.capabilities || [])
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

const introItems = [
  {
    key: 'MCP',
    title: '模型上下文协议',
    description: 'AI 通过 MCP 发现工具、读取工具说明并按名称调用。这里展示的是当前设备对外暴露的 MCP 权限范围。',
  },
  {
    key: 'list_tools',
    title: '查看工具列表',
    description: '先看当前设备上报了哪些工具，再决定是否展开某个条目查看说明或调整权限。',
  },
  {
    key: 'describe_tool',
    title: '读取工具详情',
    description: '用于查看某个工具的用途、参数和说明。需要确认怎么调用时，先看工具详情。',
  },
  {
    key: 'scope',
    title: '权限范围',
    description: '这里只列出当前在线设备上报的工具；勾选状态表示当前 AI 是否允许使用它。',
  },
] as const

const browserIntro = (tool: string) => {
  if (tool.startsWith('browser_navigate') || tool.startsWith('browser_search') || tool.startsWith('browser_history_back') || tool.startsWith('browser_history_forward')) {
    return '浏览器导航类工具，用于打开页面、搜索、返回上一页或前进。'
  }
  if (['browser_screenshot', 'browser_get_content', 'browser_dom_snapshot', 'browser_extract', 'browser_find_text', 'browser_find_popups', 'browser_close_popup', 'browser_page_info'].includes(tool)) {
    return '浏览器页面类工具，用于截图、读取页面内容、提取数据或查看页面状态。'
  }
  if (['browser_click', 'browser_type', 'browser_scroll', 'browser_wait', 'browser_fill_form', 'browser_select', 'browser_hover', 'browser_right_click', 'browser_double_click', 'browser_drag', 'browser_press_key'].includes(tool)) {
    return '浏览器交互类工具，用于点击、输入、滚动、选择和拖拽页面元素。'
  }
  if (['browser_evaluate', 'browser_clipboard_write', 'browser_storage_get', 'browser_storage_set', 'browser_storage_remove', 'browser_storage_list'].includes(tool)) {
    return '浏览器数据类工具，用于执行脚本、读写剪贴板或浏览器存储。'
  }
  if (['browser_tab_list', 'browser_tab_open', 'browser_tab_close'].includes(tool)) {
    return '浏览器标签页类工具，用于查看、新开或关闭标签页。'
  }
  if (tool.startsWith('browser_session_')) {
    return '浏览器会话类工具，用于保存、恢复或删除当前浏览器上下文。'
  }
  if (tool.startsWith('browser_cookie_')) {
    return '浏览器 Cookie 类工具，用于查看、读取、写入或删除 Cookie。'
  }
  if (tool.startsWith('browser_profile_')) {
    return '浏览器配置类工具，用于查看或设置当前逻辑 profile。'
  }
  if (tool.startsWith('browser_file_upload')) {
    return '浏览器文件类工具，用于向网页上传文件内容。'
  }
  if (tool.startsWith('browser_download')) {
    return '浏览器下载类工具，用于发起下载并保存文件。'
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
  return '通用 MCP 工具。'
}

const toggle = (tool: string) => {
  const next = new Set(selected.value)
  if (next.has(tool)) next.delete(tool)
  else next.add(tool)
  selected.value = next
}

const selectAll = () => {
  selected.value = new Set(capabilities.value)
}

const save = async () => {
  if (!props.agentId || !canSave.value) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await setAgentMcpScope(props.agentId, Array.from(selected.value))
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
          {{ scope?.agentType === 'browser' ? '浏览器端 MCP 权限' : '软件端 MCP 权限' }}
        </div>
        <div class="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
          {{ scope?.agentName || agentId }}
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
                {{ scope?.agentName || agentId }} · {{ capabilities.length }} 个工具
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
            <div class="mb-3 rounded-lg border border-indigo-200/80 bg-indigo-50/70 px-3 py-2 dark:border-indigo-900/60 dark:bg-indigo-950/20">
              <div class="mb-2 flex items-center justify-between gap-2">
                <div class="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">基础 MCP 介绍</div>
                <div class="text-[10px] text-indigo-500 dark:text-indigo-400">先看概念，再看权限</div>
              </div>
              <div class="grid grid-cols-1 gap-1.5 md:grid-cols-3">
                <div
                  v-for="item in introItems"
                  :key="item.key"
                  class="flex h-full items-start gap-2 rounded-md border border-indigo-100 bg-white/70 px-2.5 py-2 dark:border-indigo-900/40 dark:bg-zinc-950/50"
                >
                  <div class="min-w-[88px] shrink-0 font-mono text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">
                    {{ item.key }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-[11px] font-medium text-zinc-800 dark:text-zinc-100">{{ item.title }}</div>
                    <div class="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">{{ item.description }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-1.5 md:grid-cols-3">
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
                  <span class="block text-[10px] font-mono font-semibold break-all" :title="`${label(tool)} (${tool})`">{{ label(tool) }}</span>
                  <span class="mt-0.5 block text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {{ basicToolIntro(tool) }}
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
                :disabled="allSelected"
                @click="selectAll"
              >
                全选
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
