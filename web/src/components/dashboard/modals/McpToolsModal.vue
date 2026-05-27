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

const sections = computed(() => {
  const rows = props.items || []
  return [
    { key: 'server', title: '服务端 MCP', items: rows.filter(tool => !tool.mcpSource || tool.mcpSource === 'server') },
    { key: 'desktop', title: '桌面端 MCP', items: rows.filter(tool => tool.mcpSource === 'desktop') },
    { key: 'browser', title: '浏览器 MCP', items: rows.filter(tool => tool.mcpSource === 'browser') },
  ].map(section => ({
    ...section,
    groups: groupByNamespace(section.items),
  })).filter(section => section.items.length > 0)
})

const editingToolName = ref('')
const savingToolName = ref('')
const editError = ref('')
const editNotice = ref('')
const draftDescription = ref('')
const draftParams = ref<Array<{ name: string; description: string }>>([])

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
  <Transition name="fade">
    <div v-if="props.show" class="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center" @click="emit('close')">
      <div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 w-[560px] max-h-[75vh] p-4 overflow-auto" @click.stop>
        <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3">{{ props.title }} 的 MCP 工具说明</div>
        <div v-if="editNotice" class="mb-3 text-xs text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900 rounded-lg px-3 py-2">
          {{ editNotice }}
        </div>
        <div v-if="editError" class="mb-3 text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900 rounded-lg px-3 py-2">
          {{ editError }}
        </div>
        <div class="space-y-3">
          <div v-for="section in sections" :key="section.key" class="space-y-2">
            <div class="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">{{ section.title }}</div>
            <details
              v-for="group in section.groups"
              :key="`${section.key}-${group.namespace}`"
              :open="group.tools.some(tool => editingToolName === tool.name) || undefined"
              class="group rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/70 dark:bg-zinc-800/40 overflow-hidden"
            >
              <summary class="list-none cursor-pointer px-3 py-2 border-b border-zinc-200 dark:border-zinc-700 select-none">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-2">
                    <span class="text-zinc-400 transition-transform group-open:rotate-90">›</span>
                    <span class="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-200">工具总栏目：{{ group.namespace }}</span>
                  </div>
                  <span class="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">{{ group.tools.length }} 个工具</span>
                </div>
              </summary>
              <div class="divide-y divide-zinc-200 dark:divide-zinc-700">
                <div
                  v-for="tool in group.tools"
                  :key="`${tool.mcpSource || 'server'}-${tool.name}`"
                  class="p-2.5"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="text-xs font-semibold text-zinc-800 dark:text-zinc-100 break-all">{{ tool.zhLabel || tool.name }}</div>
                      <div class="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 break-all mt-0.5">{{ tool.name }}</div>
                    </div>
                    <div class="shrink-0 flex flex-wrap justify-end items-center gap-1">
                      <span
                        v-for="tag in (tool.zhTags || [])"
                        :key="`${tool.mcpSource || 'server'}-${tool.name}-${tag}`"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 text-zinc-600 dark:border-zinc-600 dark:text-zinc-300"
                      >
                        {{ tag }}
                      </span>
                      <button
                        v-if="editableTool(tool) && editingToolName !== tool.name"
                        type="button"
                        class="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                        @click.stop.prevent="startEditTool(tool)"
                      >
                        编辑
                      </button>
                    </div>
                  </div>
                  <textarea
                    v-if="editingToolName === tool.name"
                    v-model="draftDescription"
                    rows="3"
                    class="mt-2 w-full resize-y text-[11px] leading-relaxed text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900/70 p-2 rounded border border-zinc-200 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:focus:ring-indigo-800"
                  />
                  <div v-else class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">{{ tool.zhDescription || '暂无说明' }}</div>
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
                    <div v-if="getMcpToolParamRows(tool).length === 0" class="text-[11px] text-zinc-500 dark:text-zinc-400">
                      无参数
                    </div>
                  </div>
                  <div v-if="editingToolName === tool.name" class="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded border border-zinc-200 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      :disabled="savingToolName === tool.name"
                      @click="cancelEditTool"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded bg-indigo-600 text-xs text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                      :disabled="savingToolName === tool.name"
                      @click="saveTool(tool)"
                    >
                      {{ savingToolName === tool.name ? '保存中…' : '保存' }}
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </div>
          <div v-if="props.items.length === 0" class="text-xs text-zinc-500">暂无可用工具</div>
        </div>
      </div>
    </div>
  </Transition>
</template>
