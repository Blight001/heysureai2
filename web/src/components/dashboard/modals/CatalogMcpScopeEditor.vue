<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getMcpToolParamRows, getMcpToolZhLabel } from '@/utils/mcpTools'

export interface CatalogMcpTool {
  name: string
  description?: string
  inputSchema?: Record<string, any>
  destructive?: boolean
}

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  tools: CatalogMcpTool[]
  selected?: string[]
  readonly?: boolean
  onSave?: (tools: string[]) => Promise<void> | void
}>(), {
  subtitle: '',
  selected: () => [],
  readonly: false,
})

const selectedSet = ref<Set<string>>(new Set())
const saving = ref(false)
const notice = ref('')
const error = ref('')
const detailOpen = ref(false)

const capabilities = computed(() =>
  props.tools
    .map(tool => String(tool.name || '').trim())
    .filter(Boolean),
)

const syncSelected = () => {
  selectedSet.value = new Set(
    (props.selected || []).map(name => String(name || '').trim()).filter(Boolean),
  )
}

watch(() => props.selected?.join('|'), syncSelected, { immediate: true })

const allSelected = computed(() =>
  capabilities.value.length > 0 && capabilities.value.every(name => selectedSet.value.has(name)),
)

const dirty = computed(() => {
  const base = new Set((props.selected || []).map(name => String(name || '').trim()).filter(Boolean))
  if (base.size !== selectedSet.value.size) return true
  for (const name of selectedSet.value) if (!base.has(name)) return true
  return false
})

const toolByName = (name: string) => props.tools.find(tool => tool.name === name)

const toolDescription = (name: string) => {
  const tool = toolByName(name)
  return String(tool?.description || '').trim() || '（无描述）'
}

const toolParams = (name: string) => getMcpToolParamRows({
  name,
  description: toolDescription(name),
  inputSchema: toolByName(name)?.inputSchema || {},
  destructive: !!toolByName(name)?.destructive,
})

const toggle = (tool: string) => {
  if (props.readonly) return
  const next = new Set(selectedSet.value)
  if (next.has(tool)) next.delete(tool)
  else next.add(tool)
  selectedSet.value = next
}

const toggleSelectAll = () => {
  if (props.readonly) return
  selectedSet.value = allSelected.value ? new Set() : new Set(capabilities.value)
}

const save = async () => {
  if (props.readonly || !capabilities.value.length) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const merged = [...selectedSet.value].sort((a, b) => a.localeCompare(b))
    if (props.onSave) await props.onSave(merged)
    notice.value = '已保存'
    detailOpen.value = false
  } catch (err: any) {
    error.value = err?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

const label = (tool: string) => getMcpToolZhLabel(tool)

const openDetail = () => { detailOpen.value = true }
const closeDetail = () => { detailOpen.value = false }
</script>

<template>
  <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-2.5">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{{ title }}</div>
        <div class="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
          {{ subtitle }}
          <span v-if="capabilities.length"> · {{ selectedSet.size }} / {{ capabilities.length }}</span>
        </div>
      </div>
      <button
        v-if="capabilities.length"
        type="button"
        class="shrink-0 text-[10px] px-2 py-0.5 rounded border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
        @click="openDetail"
      >
        查看详情
      </button>
    </div>
    <div v-if="capabilities.length === 0" class="mt-2 text-[10px] text-zinc-400">暂无工具</div>
    <div v-if="notice" class="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-300">{{ notice }}</div>
    <div v-if="error" class="mt-1.5 text-[10px] text-rose-500">{{ error }}</div>
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
                {{ subtitle || title }} · {{ capabilities.length }} 个工具
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
              <component
                :is="readonly ? 'div' : 'label'"
                v-for="tool in capabilities"
                :key="tool"
                class="flex h-full items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors"
                :class="[
                  readonly
                    ? 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300'
                    : selectedSet.has(tool)
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700 cursor-pointer select-none dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200'
                      : 'border-zinc-200 bg-white text-zinc-600 cursor-pointer select-none dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300',
                ]"
              >
                <input
                  v-if="!readonly"
                  type="checkbox"
                  class="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-500"
                  :checked="selectedSet.has(tool)"
                  @change="toggle(tool)"
                />
                <span class="min-w-0">
                  <span class="flex items-center gap-1.5 text-[10px] font-mono font-semibold break-all" :title="`${label(tool)} (${tool})`">
                    {{ label(tool) }}
                    <span
                      v-if="toolByName(tool)?.destructive"
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
              </component>
            </div>
          </div>

          <div v-if="!readonly" class="border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
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
                :disabled="saving || !dirty"
                class="text-[10px] px-2 py-0.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40"
                @click="save"
              >
                {{ saving ? '...' : '保存' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>