<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LibraryMcpFullView } from '@/api/librarian'
import { updateAiConfigFields } from '@/api/ai'
import { getMcpToolParamRows, getMcpToolZhLabel } from '@/utils/mcpTools'
import type { CatalogMcpTool } from '@/components/dashboard/modals/CatalogMcpScopeEditor.vue'

const props = withDefaults(defineProps<{
  catalog?: LibraryMcpFullView | null
  workshopDeviceId: string
  boundAiConfigId?: number | null
  boundAiName?: string
  governanceMcpTools?: string[]
  refreshKey?: string | number
}>(), {
  catalog: null,
  boundAiConfigId: null,
  boundAiName: '',
  governanceMcpTools: () => [],
})

const emit = defineEmits<{
  (e: 'governance-saved', tools: string[]): void
}>()

const flattenTools = (view: LibraryMcpFullView['governance'] | undefined): CatalogMcpTool[] => {
  const rows: CatalogMcpTool[] = []
  for (const category of view?.categories || []) {
    for (const tool of category.tools || []) {
      const name = String(tool.name || '').trim()
      if (!name) continue
      rows.push({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        destructive: tool.destructive,
      })
    }
  }
  return rows
}

const governanceToolRows = computed(() => flattenTools(props.catalog?.governance))
const governanceNames = computed(() => new Set(governanceToolRows.value.map(tool => tool.name)))

const governanceAllowed = ref<Set<string>>(new Set())
const initialGovernance = ref<Set<string>>(new Set())
const toolDefs = ref<Record<string, { description?: string; input_schema?: Record<string, any>; destructive?: boolean }>>({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const detailOpen = ref(false)

const governanceSelected = computed(() =>
  (props.governanceMcpTools || []).filter(name => governanceNames.value.has(name)),
)

const syncGovernance = () => {
  governanceAllowed.value = new Set(governanceSelected.value)
}

const load = async () => {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const defs: Record<string, { description?: string; input_schema?: Record<string, any>; destructive?: boolean }> = {}
    for (const tool of governanceToolRows.value) {
      defs[tool.name] = {
        description: tool.description,
        input_schema: tool.inputSchema,
        destructive: tool.destructive,
      }
    }
    toolDefs.value = defs
    syncGovernance()
    initialGovernance.value = new Set(governanceAllowed.value)
  } catch (err: any) {
    error.value = err?.message || '图书馆 MCP 权限加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.refreshKey, props.governanceMcpTools?.join('|'), props.catalog?.total],
  load,
  { immediate: true },
)

const capabilities = computed(() => governanceToolRows.value.map(tool => tool.name))

const selectedCount = computed(() =>
  capabilities.value.filter(name => governanceAllowed.value.has(name)).length,
)

const allSelected = computed(() =>
  capabilities.value.length > 0 && capabilities.value.every(name => governanceAllowed.value.has(name)),
)

const setsEqual = (a: Set<string>, b: Set<string>) => {
  if (a.size !== b.size) return false
  for (const name of a) if (!b.has(name)) return false
  return true
}

const dirty = computed(() => !setsEqual(governanceAllowed.value, initialGovernance.value))

const toggle = (name: string) => {
  if (!props.boundAiConfigId) return
  const next = new Set(governanceAllowed.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  governanceAllowed.value = next
}

const toggleSelectAll = () => {
  if (allSelected.value) {
    governanceAllowed.value = new Set()
    return
  }
  if (props.boundAiConfigId) {
    governanceAllowed.value = new Set(governanceToolRows.value.map(tool => tool.name))
  }
}

const toolRow = (name: string) => governanceToolRows.value.find(tool => tool.name === name)

const toolDescription = (name: string) => {
  const def = toolDefs.value[name]
  const row = toolRow(name)
  return String(def?.description || row?.description || '').trim() || '（无描述）'
}

const toolParams = (name: string) => getMcpToolParamRows({
  name,
  description: toolDescription(name),
  inputSchema: toolDefs.value[name]?.input_schema || toolRow(name)?.inputSchema || {},
  destructive: !!(toolDefs.value[name]?.destructive || toolRow(name)?.destructive),
})

const save = async () => {
  if (!capabilities.value.length) return
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const cfgId = Number(props.boundAiConfigId)
    if (Number.isFinite(cfgId) && cfgId > 0) {
      const base = new Set(
        (props.governanceMcpTools || []).map(name => String(name || '').trim()).filter(Boolean),
      )
      for (const name of governanceNames.value) base.delete(name)
      for (const name of governanceAllowed.value) base.add(name)
      const merged = [...base].sort((a, b) => a.localeCompare(b))
      const savedCfg = await updateAiConfigFields(cfgId, { mcp_tools: JSON.stringify(merged) })
      let persisted = merged
      try {
        const parsed = JSON.parse(String(savedCfg?.mcp_tools || '[]'))
        if (Array.isArray(parsed)) {
          persisted = parsed.map(item => String(item || '').trim()).filter(Boolean)
        }
      } catch {
        persisted = merged
      }
      governanceAllowed.value = new Set(
        persisted.filter(name => governanceNames.value.has(name)),
      )
      initialGovernance.value = new Set(governanceAllowed.value)
      emit('governance-saved', persisted)
    }

    notice.value = '已保存'
    detailOpen.value = false
  } catch (err: any) {
    error.value = err?.message || '保存失败'
  } finally {
    saving.value = false
  }
}

const label = (name: string) => getMcpToolZhLabel(name)
const subtitle = computed(() => props.boundAiName || props.workshopDeviceId)
const canEditGovernance = computed(() => !!props.boundAiConfigId)
</script>

<template>
  <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-2.5">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">图书馆 MCP 权限</div>
        <div class="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
          {{ subtitle }}
          <span v-if="capabilities.length"> · {{ selectedCount }} / {{ capabilities.length }}</span>
        </div>
      </div>
      <button
        v-if="capabilities.length"
        type="button"
        class="shrink-0 text-[10px] px-2 py-0.5 rounded border border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50 dark:bg-zinc-900 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
        @click="detailOpen = true"
      >
        查看详情
      </button>
    </div>

    <div v-if="loading" class="mt-2 text-[10px] text-zinc-400">加载中…</div>
    <div v-else-if="error" class="mt-2 text-[10px] text-rose-500">{{ error }}</div>
    <template v-else>
      <div v-if="!capabilities.length" class="mt-2 text-[10px] text-zinc-400">暂无工具</div>
      <div v-if="!canEditGovernance" class="mt-1.5 text-[10px] text-amber-600 dark:text-amber-300">
        分配 AI 成员后可勾选治理类工具
      </div>
      <div v-if="notice" class="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-300">{{ notice }}</div>
    </template>

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="detailOpen"
          class="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-4"
          @click="detailOpen = false"
        >
          <div
            class="flex w-full max-w-5xl max-h-[86vh] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            @click.stop
          >
            <div class="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">MCP 权限详情</div>
                <div class="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                  {{ subtitle }} · {{ capabilities.length }} 个工具
                </div>
              </div>
              <button
                type="button"
                class="rounded border border-zinc-200 px-2 py-1 text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                @click="detailOpen = false"
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
                  :class="governanceAllowed.has(tool)
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200'
                    : 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300'"
                >
                  <input
                    type="checkbox"
                    class="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-500"
                    :checked="governanceAllowed.has(tool)"
                    :disabled="!canEditGovernance"
                    @change="toggle(tool)"
                  />
                  <span class="min-w-0">
                    <span class="flex items-center gap-1.5 text-[10px] font-mono font-semibold break-all" :title="`${label(tool)} (${tool})`">
                      {{ label(tool) }}
                      <span
                        v-if="toolRow(tool)?.destructive || toolDefs[tool]?.destructive"
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
                  :disabled="capabilities.length === 0 || !canEditGovernance"
                  @click="toggleSelectAll"
                >
                  {{ allSelected ? '全不选' : '全选' }}
                </button>
                <button
                  type="button"
                  :disabled="saving || !dirty || !canEditGovernance"
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
  </div>
</template>