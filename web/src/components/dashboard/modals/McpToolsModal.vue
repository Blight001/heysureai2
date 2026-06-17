<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getAuthToken } from '@/api/http'
import { saveIntrinsicProperties } from '@/api/librarian'
import { getMcpToolParamRows } from '@/utils/mcpTools'
import type { McpToolDefinition } from '@/types'

const props = defineProps<{
  show: boolean
  title: string
  items: McpToolDefinition[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const query = ref('')
const activeSource = ref<'server' | 'desktop' | 'browser'>('server')
const showIntro = ref(false)
const expandedToolName = ref('')

const SOURCE_LABELS: Record<string, string> = { server: '服务端', desktop: '桌面端', browser: '浏览器' }
const sourceOf = (tool: McpToolDefinition) => (tool.mcpSource || 'server')

const matchesQuery = (tool: McpToolDefinition) => {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  return [tool.name, tool.zhLabel, tool.zhDescription, tool.description]
    .some(value => String(value || '').toLowerCase().includes(q))
}

const sourceTabs = computed(() => {
  const counts: Record<string, number> = { server: 0, desktop: 0, browser: 0 }
  for (const tool of props.items || []) counts[sourceOf(tool)] = (counts[sourceOf(tool)] || 0) + 1
  return (['server', 'desktop', 'browser'] as const)
    .filter(key => counts[key] > 0)
    .map(key => ({ key, label: SOURCE_LABELS[key], count: counts[key] }))
})

// Tools of the active source, filtered by the search box, grouped by namespace.
const visibleGroups = computed(() =>
  groupByNamespace(
    (props.items || []).filter(tool => sourceOf(tool) === activeSource.value && matchesQuery(tool)),
  ),
)
const visibleCount = computed(() => visibleGroups.value.reduce((n, g) => n + g.tools.length, 0))

// Keep the active tab valid as items load / the modal reopens.
watch(
  () => [props.show, sourceTabs.value.map(t => t.key).join(',')],
  () => {
    if (props.show && !sourceTabs.value.some(t => t.key === activeSource.value)) {
      activeSource.value = sourceTabs.value[0]?.key || 'server'
    }
  },
  { immediate: true },
)

const toggleExpand = (tool: McpToolDefinition) => {
  if (editingToolName.value === tool.name) return
  expandedToolName.value = expandedToolName.value === tool.name ? '' : tool.name
}

const editingToolName = ref('')
const savingToolName = ref('')
const editError = ref('')
const editNotice = ref('')
const draftDescription = ref('')
const draftParams = ref<Array<{ name: string; description: string }>>([])

const introItems = [
  {
    key: 'MCP',
    title: '模型上下文协议',
    description: '模型通过 MCP 发现工具、读取说明并发起调用。这里展示的是当前页面可用的 MCP 工具集合。',
  },
  {
    key: 'list_tools',
    title: '查看工具列表',
    description: '用于先看有哪些工具可用，再决定是否展开某个 namespace 或某个具体工具。',
  },
  {
    key: 'describe_tool',
    title: '读取工具详情',
    description: '用于查看单个工具的用途、参数定义和参数说明，适合在正式调用前确认输入格式。',
  },
  {
    key: '权限范围',
    title: '当前可见范围',
    description: '这里只展示当前账号、角色或已连接设备允许使用的工具，不等于系统全部工具。',
  },
] as const

const groupByNamespace = (items: McpToolDefinition[]) => {
  const buckets = new Map<string, McpToolDefinition[]>()
  for (const tool of items) {
    const name = String(tool.name || '').trim()
    const namespace = name.includes('.') ? name.split('.', 1)[0] : 'other'
    buckets.set(namespace, [...(buckets.get(namespace) || []), tool])
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, tools]) => ({
      namespace,
      tools: [...tools].sort((a, b) => a.name.localeCompare(b.name)),
    }))
}

const editableTool = (tool: McpToolDefinition) => !tool.mcpSource || tool.mcpSource === 'server'

const startEditTool = (tool: McpToolDefinition) => {
  if (!editableTool(tool)) return
  editingToolName.value = tool.name
  expandedToolName.value = tool.name
  editError.value = ''
  editNotice.value = ''
  draftDescription.value = String(tool.zhDescription || tool.description || '')
  draftParams.value = getMcpToolParamRows(tool).map(param => ({
    name: param.name,
    description: param.description || '',
  }))
}

const cancelEditTool = () => {
  editingToolName.value = ''
  editError.value = ''
  draftDescription.value = ''
  draftParams.value = []
}

const updateDraftParam = (name: string, description: string) => {
  draftParams.value = draftParams.value.map(param =>
    param.name === name ? { ...param, description } : param,
  )
}

const draftParamDescription = (name: string) =>
  draftParams.value.find(param => param.name === name)?.description ?? ''

const saveTool = async (tool: McpToolDefinition) => {
  savingToolName.value = tool.name
  editError.value = ''
  editNotice.value = ''
  try {
    await saveIntrinsicProperties(getAuthToken(), [{
      name: tool.name,
      description: draftDescription.value,
      parameters: draftParams.value,
    }])
    tool.description = draftDescription.value
    tool.zhDescription = draftDescription.value
    const schema = (tool.inputSchema && typeof tool.inputSchema === 'object') ? tool.inputSchema : {}
    const properties = (schema.properties && typeof schema.properties === 'object')
      ? schema.properties as Record<string, any>
      : {}
    for (const param of draftParams.value) {
      if (properties[param.name] && typeof properties[param.name] === 'object') {
        properties[param.name].description = param.description
      }
    }
    editingToolName.value = ''
    editNotice.value = `${tool.name} 已保存`
  } catch (err) {
    editError.value = (err as Error).message || '保存失败'
  } finally {
    savingToolName.value = ''
  }
}

watch(() => props.show, (show) => {
  if (!show) {
    editingToolName.value = ''
    savingToolName.value = ''
    editError.value = ''
    editNotice.value = ''
    draftDescription.value = ''
    draftParams.value = []
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="props.show" class="fixed inset-0 z-[600] bg-black/40 flex items-center justify-center" @click="emit('close')">
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 w-[560px] max-h-[75vh] p-4 overflow-auto" @click.stop>
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">{{ props.title }} 的 MCP 工具</div>
            <button
              type="button"
              class="shrink-0 h-4 w-4 rounded-full border border-zinc-300 text-[10px] leading-none text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
              title="MCP 是什么？"
              @click="showIntro = !showIntro"
            >?</button>
          </div>
        </div>

        <!-- collapsed by default; the "?" toggles it -->
        <div v-if="showIntro" class="mb-3 rounded-lg border border-indigo-200/80 bg-indigo-50/70 px-3 py-2.5 dark:border-indigo-900/60 dark:bg-indigo-950/20 space-y-1.5">
          <div
            v-for="item in introItems"
            :key="item.key"
            class="flex items-start gap-2"
          >
            <div class="min-w-[84px] shrink-0 font-mono text-[10px] font-semibold text-indigo-700 dark:text-indigo-300">{{ item.key }}</div>
            <div class="min-w-0">
              <div class="text-[11px] font-medium text-zinc-800 dark:text-zinc-100">{{ item.title }}</div>
              <div class="mt-0.5 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">{{ item.description }}</div>
            </div>
          </div>
        </div>

        <!-- search -->
        <input
          v-model="query"
          type="search"
          placeholder="搜索工具名或说明…"
          class="mb-2 w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
        />

        <!-- source tabs -->
        <div v-if="sourceTabs.length > 1" class="mb-2 flex gap-1">
          <button
            v-for="tab in sourceTabs"
            :key="tab.key"
            type="button"
            class="rounded-lg px-3 py-1 text-xs font-medium border"
            :class="activeSource === tab.key
              ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300'
              : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800'"
            @click="activeSource = tab.key; expandedToolName = ''"
          >{{ tab.label }} <span class="opacity-60">{{ tab.count }}</span></button>
        </div>

        <div v-if="editNotice" class="mb-2 text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
          {{ editNotice }}
        </div>
        <div v-if="editError" class="mb-2 text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
          {{ editError }}
        </div>

        <!-- tool list: name + one-line desc; click a row to expand params / edit -->
        <div class="space-y-3">
          <div v-for="group in visibleGroups" :key="group.namespace" class="space-y-1">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500 px-0.5">{{ group.namespace }}</div>
            <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700 overflow-hidden">
                <div
                  v-for="tool in group.tools"
                  :key="`${tool.mcpSource || 'server'}-${tool.name}`"
                  class="px-3 py-2"
                >
                  <div class="flex items-center justify-between gap-2 cursor-pointer" @click="toggleExpand(tool)">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-zinc-400 text-[10px] transition-transform" :class="expandedToolName === tool.name ? 'rotate-90' : ''">›</span>
                        <span class="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate">{{ tool.zhLabel || tool.name }}</span>
                      </div>
                      <div v-if="expandedToolName !== tool.name" class="ml-4 text-[10px] text-zinc-500 dark:text-zinc-400 truncate">{{ tool.zhDescription || tool.name }}</div>
                    </div>
                    <button
                      v-if="editableTool(tool) && editingToolName !== tool.name"
                      type="button"
                      class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                      @click.stop="startEditTool(tool)"
                    >编辑</button>
                  </div>
                  <!-- expanded details -->
                  <div v-if="expandedToolName === tool.name" class="mt-2 ml-4">
                    <div class="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 break-all mb-1">{{ tool.name }}</div>
                    <div class="flex flex-wrap gap-1 mb-1">
                      <span
                        v-for="tag in (tool.zhTags || [])"
                        :key="`${tool.mcpSource || 'server'}-${tool.name}-${tag}`"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400"
                      >{{ tag }}</span>
                    </div>
                    <textarea
                      v-if="editingToolName === tool.name"
                      v-model="draftDescription"
                      rows="3"
                      class="w-full resize-y text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-2 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                    />
                    <div v-else class="text-[11px] text-zinc-600 dark:text-zinc-300">{{ tool.zhDescription || '暂无说明' }}</div>
                    <div class="mt-2 space-y-1">
                      <div
                        v-for="param in getMcpToolParamRows(tool)"
                        :key="`${tool.mcpSource || 'server'}-${tool.name}-${param.name}`"
                        class="text-[11px] px-2 py-1 rounded border border-zinc-200/80 dark:border-zinc-700/80 bg-white/80 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-300"
                      >
                        <div>
                          <span class="font-mono text-zinc-800 dark:text-zinc-100">{{ param.name }}</span>
                          <span class="mx-1 text-zinc-400">:</span>
                          <span class="font-mono">{{ param.type }}</span>
                          <span :class="param.required ? 'text-rose-600 dark:text-rose-300' : 'text-zinc-500 dark:text-zinc-400'">
                            {{ param.required ? ' (必填)' : ' (可选)' }}
                          </span>
                        </div>
                        <textarea
                          v-if="editingToolName === tool.name"
                          :value="draftParamDescription(param.name)"
                          rows="2"
                          class="mt-1 w-full resize-y text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                          @input="updateDraftParam(param.name, ($event.target as HTMLTextAreaElement).value)"
                        />
                        <span v-else-if="param.description" class="text-zinc-500 dark:text-zinc-400"> - {{ param.description }}</span>
                      </div>
                      <div v-if="getMcpToolParamRows(tool).length === 0" class="text-[11px] text-zinc-400">无参数</div>
                    </div>
                    <div v-if="editingToolName === tool.name" class="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        :disabled="savingToolName === tool.name"
                        @click="cancelEditTool"
                      >取消</button>
                      <button
                        type="button"
                        class="px-3 py-1.5 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                        :disabled="savingToolName === tool.name"
                        @click="saveTool(tool)"
                      >{{ savingToolName === tool.name ? '保存中…' : '保存' }}</button>
                    </div>
                  </div>
                </div>
            </div>
          </div>
          <div v-if="visibleCount === 0" class="text-xs text-zinc-500 py-6 text-center">没有匹配的工具</div>
        </div>
      </div>
      </div>
    </Transition>
  </Teleport>
</template>
