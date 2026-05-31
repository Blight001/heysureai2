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

const toggle = (tool: string) => {
  const next = new Set(selected.value)
  if (next.has(tool)) next.delete(tool)
  else next.add(tool)
  selected.value = next
}

const toggleAll = () => {
  selected.value = allSelected.value ? new Set() : new Set(capabilities.value)
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
</script>

<template>
  <div class="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-800/40 p-2.5">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
          {{ scope?.agentType === 'browser' ? '浏览器端 MCP 权限' : scope?.agentType === 'linux' ? 'Linux MCP 权限' : '软件端 MCP 权限' }}
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
          class="text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          @click="toggleAll"
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
    </div>

    <div v-if="loading" class="mt-2 text-[10px] text-zinc-400">加载中…</div>
    <div v-else-if="error" class="mt-2 text-[10px] text-rose-500">{{ error }}</div>
    <template v-else>
      <div v-if="capabilities.length === 0" class="mt-2 text-[10px] text-zinc-400">
        该设备未上报任何工具。
      </div>
      <div v-else class="mt-2 flex flex-wrap gap-1">
        <label
          v-for="tool in capabilities"
          :key="tool"
          class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border cursor-pointer select-none"
          :class="selected.has(tool)
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200'
            : 'border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400'"
        >
          <input
            type="checkbox"
            class="h-3 w-3"
            :checked="selected.has(tool)"
            @change="toggle(tool)"
          />
          <span class="truncate max-w-[140px]" :title="`${label(tool)} (${tool})`">{{ label(tool) }}</span>
        </label>
      </div>
      <div v-if="notice" class="mt-1.5 text-[10px] text-emerald-600 dark:text-emerald-300">{{ notice }}</div>
    </template>
  </div>
</template>
