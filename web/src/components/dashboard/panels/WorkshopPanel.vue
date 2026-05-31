<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { ConnectedAgent } from '@/composables/dashboard/useDashboardData'
import { assignAgentAi } from '@/api/agents'
import AgentMcpScopeEditor from '../modals/AgentMcpScopeEditor.vue'

interface Agent {
  id: string
  name: string
  role: 'admin' | 'worker'
  aiConfigId?: number
  status: 'learning' | 'working' | 'reproducing' | 'dead'
  platform: string
  currentTask?: string
  currentTaskTitle?: string
  currentTaskStatus?: string
  projectName?: string
  runtimeStatus?: string
  runtimeTool?: string
}

interface Props {
  devices: ConnectedAgent[]
  agents: Agent[]
}

const props = defineProps<Props>()

const memberByConfigId = computed(() => {
  const map = new Map<number, Agent>()
  for (const agent of props.agents || []) {
    const id = Number(agent.aiConfigId)
    if (Number.isFinite(id) && id > 0) map.set(id, agent)
  }
  return map
})

// AI members the operator can assign to a device (those backed by a real config).
const assignableMembers = computed(() =>
  (props.agents || [])
    .filter(a => Number.isFinite(Number(a.aiConfigId)) && Number(a.aiConfigId) > 0)
    .map(a => ({ aiConfigId: Number(a.aiConfigId), name: a.name })),
)

// Per-device dropdown selection (stored as strings for native <select>) plus
// busy/error state.
const selection = reactive<Record<string, string>>({})
const busy = reactive<Record<string, boolean>>({})
const errors = reactive<Record<string, string>>({})

// Current dropdown value: an explicit pick if the operator changed it, else the
// device's existing binding.
const selectionFor = (device: ConnectedAgent): string => {
  if (device.id in selection) return selection[device.id]
  const id = Number(device.aiConfigId)
  return Number.isFinite(id) && id > 0 ? String(id) : ''
}

const onSelect = (device: ConnectedAgent, event: Event) => {
  selection[device.id] = (event.target as HTMLSelectElement).value
}

const assign = async (device: ConnectedAgent) => {
  const chosen = selectionFor(device)
  const cfgId = chosen === '' ? null : Number(chosen)
  busy[device.id] = true
  errors[device.id] = ''
  try {
    // The server broadcasts an updated agent:list, so the card refreshes itself.
    await assignAgentAi(device.id, cfgId)
  } catch (err: any) {
    errors[device.id] = err?.message || '分配失败'
  } finally {
    busy[device.id] = false
  }
}

const unassign = async (device: ConnectedAgent) => {
  selection[device.id] = ''
  busy[device.id] = true
  errors[device.id] = ''
  try {
    await assignAgentAi(device.id, null)
  } catch (err: any) {
    errors[device.id] = err?.message || '解绑失败'
  } finally {
    busy[device.id] = false
  }
}

const deviceTypeLabel = (device: ConnectedAgent) => {
  const platform = String(device.platform || '').toLowerCase()
  if (device.isBrowserExtension || platform.includes('browser')) return '浏览器插件'
  if (device.isWindowsDesktop || platform.includes('desktop') || platform.includes('windows')) return '软件端'
  return '设备端'
}

const isSoftwareDevice = (device: ConnectedAgent) => {
  const platform = String(device.platform || '').toLowerCase()
  return !!device.isWindowsDesktop || platform.includes('desktop') || platform.includes('windows')
}

const isEndpointDevice = (device: ConnectedAgent) => {
  const platform = String(device.platform || '').toLowerCase()
  return isSoftwareDevice(device) || !!device.isBrowserExtension || platform.includes('browser')
}

const deviceDisplayName = (device: ConnectedAgent) => {
  if (isSoftwareDevice(device)) return 'Windows Agent'
  return device.name || device.id || 'Agent'
}

const lifecycleLabel = (lifecycle?: string) => {
  switch (lifecycle) {
    case 'dispatching':
      return '执行中'
    case 'registered':
    case 'connected':
      return '已连接'
    case 'degraded':
      return '异常'
    default:
      return '在线'
  }
}

const lifecycleClass = (lifecycle?: string) => {
  switch (lifecycle) {
    case 'dispatching':
      return 'bg-indigo-500'
    case 'registered':
    case 'connected':
      return 'bg-emerald-500'
    case 'degraded':
      return 'bg-amber-500'
    default:
      return 'bg-zinc-400'
  }
}

const linkedMember = (device: ConnectedAgent) => {
  const id = Number(device.aiConfigId)
  if (!Number.isFinite(id) || id <= 0) return undefined
  return memberByConfigId.value.get(id)
}

const hasLinkedMember = (device: ConnectedAgent) => !!linkedMember(device)

const memberPanelClass = (device: ConnectedAgent) => hasLinkedMember(device)
  ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/30 dark:bg-emerald-500/10'
  : 'border-amber-200 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-500/10'

const deviceCardClass = (device: ConnectedAgent) => hasLinkedMember(device)
  ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10'
  : 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10'

const memberLabelClass = (device: ConnectedAgent) => hasLinkedMember(device)
  ? 'text-emerald-600 dark:text-emerald-300'
  : 'text-amber-600 dark:text-amber-300'

const memberStatusLabel = (device: ConnectedAgent) => hasLinkedMember(device) ? '已链接成员' : '未链接成员'

const memberStatusBadgeClass = (device: ConnectedAgent) => hasLinkedMember(device)
  ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200'
  : 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200'
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
    <div v-if="devices.length === 0" class="text-center text-zinc-400 text-xs py-10 dark:text-zinc-500">
      暂无已连接设备。
    </div>

    <div
      v-for="device in devices"
      :key="device.id"
      class="rounded-xl border p-3"
      :class="deviceCardClass(device)"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full shrink-0" :class="lifecycleClass(device.lifecycle)"></span>
            <h4 class="text-sm font-bold text-zinc-700 dark:text-zinc-200 truncate">{{ deviceDisplayName(device) }}</h4>
          </div>
          <div class="mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500">
            {{ deviceTypeLabel(device) }} · {{ device.platform || 'unknown' }}
          </div>
        </div>
        <span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
          {{ lifecycleLabel(device.lifecycle) }}
        </span>
      </div>

      <div class="mt-2 rounded-lg border p-2" :class="memberPanelClass(device)">
        <div class="mb-1 flex items-center justify-between gap-2">
          <div class="text-[10px]" :class="memberLabelClass(device)">分配成员</div>
          <span class="shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-medium" :class="memberStatusBadgeClass(device)">
            {{ memberStatusLabel(device) }}
          </span>
        </div>
        <div class="flex items-center gap-2 text-[10px] leading-tight">
          <span
            class="min-w-0 flex-1 truncate font-semibold"
            :class="hasLinkedMember(device)
              ? 'text-emerald-800 dark:text-emerald-100'
              : 'text-amber-700 dark:text-amber-200'"
          >
            {{ hasLinkedMember(device) ? linkedMember(device)?.name : '未链接成员' }}
          </span>
          <span
            v-if="hasLinkedMember(device)"
            class="shrink-0 whitespace-nowrap text-emerald-700/80 dark:text-emerald-200/80"
          >
            ID: {{ device.aiConfigId }}<span v-if="linkedMember(device)?.projectName"> · {{ linkedMember(device)?.projectName }}</span>
          </span>
        </div>
        <div
          v-if="hasLinkedMember(device)"
          class="mt-0.5 truncate text-[10px] leading-tight text-emerald-700/80 dark:text-emerald-200/80"
        >
          {{ linkedMember(device)?.currentTaskTitle || linkedMember(device)?.currentTask || '等待任务' }}
        </div>

        <!-- Assign / reassign control (operator picks the server-side AI) -->
        <div class="mt-2 flex items-center gap-1.5">
          <select
            :value="selectionFor(device)"
            :disabled="busy[device.id]"
            class="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1.5 py-1 text-[10px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            @change="onSelect(device, $event)"
          >
            <option value="">未分配</option>
            <option v-for="m in assignableMembers" :key="m.aiConfigId" :value="String(m.aiConfigId)">
              {{ m.name }}（ID: {{ m.aiConfigId }}）
            </option>
          </select>
          <button
            type="button"
            :disabled="busy[device.id]"
            class="shrink-0 rounded bg-indigo-500 px-2 py-1 text-[10px] font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
            @click="assign(device)"
          >
            {{ busy[device.id] ? '...' : '分配' }}
          </button>
          <button
            v-if="hasLinkedMember(device)"
            type="button"
            :disabled="busy[device.id]"
            class="shrink-0 rounded border border-zinc-200 px-2 py-1 text-[10px] font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            @click="unassign(device)"
          >
            解绑
          </button>
        </div>
        <div v-if="errors[device.id]" class="mt-1 text-[10px] text-rose-500">{{ errors[device.id] }}</div>
      </div>

      <!-- Endpoint agents: edit their per-(AI, type) MCP permission scope. -->
      <AgentMcpScopeEditor
        v-if="isEndpointDevice(device)"
        class="mt-2"
        :agent-id="device.id"
        :refresh-key="`${device.aiConfigId ?? ''}-${device.lifecycle ?? ''}`"
      />
      <div v-else-if="device.capabilities.length" class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="cap in device.capabilities"
          :key="cap"
          class="text-[9px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        >
          {{ cap }}
        </span>
      </div>

      <div v-if="device.lastError" class="mt-2 text-[10px] text-rose-500 truncate" :title="device.lastError">
        错误: {{ device.lastError }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.05);
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
}
</style>
