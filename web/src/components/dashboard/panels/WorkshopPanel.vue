<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { ConnectedDevice } from '@/composables/dashboard/useDashboardData'
import { assignDeviceAi } from '@/api/devices'
import { setWorkshopBinding } from '@/api/workshop'
import { getMcpToolZhLabel } from '@/utils/mcpTools'
import DeviceMcpScopeEditor from '../modals/DeviceMcpScopeEditor.vue'

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
  devices: ConnectedDevice[]
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
const bindingOverride = reactive<Record<string, number | null>>({})

const linkedConfigId = (device: ConnectedDevice): number | null => {
  if (device.id in bindingOverride) return bindingOverride[device.id]
  const id = Number(device.aiConfigId)
  return Number.isFinite(id) && id > 0 ? id : null
}

// Current dropdown value: an explicit pick if the operator changed it, else the
// device's existing binding.
const selectionFor = (device: ConnectedDevice): string => {
  if (device.id in selection) return selection[device.id]
  const id = linkedConfigId(device)
  return id ? String(id) : ''
}

const onSelect = (device: ConnectedDevice, event: Event) => {
  selection[device.id] = (event.target as HTMLSelectElement).value
}

const assign = async (device: ConnectedDevice) => {
  const chosen = selectionFor(device)
  const cfgId = chosen === '' ? null : Number(chosen)
  busy[device.id] = true
  errors[device.id] = ''
  try {
    if (isWorkshopDevice(device)) {
      const currentId = linkedConfigId(device)
      if (cfgId) {
        await setWorkshopBinding(cfgId, device.id, true)
      } else if (currentId) {
        await setWorkshopBinding(currentId, device.id, false)
      }
      bindingOverride[device.id] = cfgId
    } else {
      // The server broadcasts an updated device:list, so the card refreshes itself.
      await assignDeviceAi(device.id, cfgId)
    }
  } catch (err: any) {
    errors[device.id] = err?.message || '分配失败'
  } finally {
    busy[device.id] = false
  }
}

const unassign = async (device: ConnectedDevice) => {
  selection[device.id] = ''
  busy[device.id] = true
  errors[device.id] = ''
  try {
    const currentId = linkedConfigId(device)
    if (isWorkshopDevice(device)) {
      if (currentId) await setWorkshopBinding(currentId, device.id, false)
      bindingOverride[device.id] = null
    } else {
      await assignDeviceAi(device.id, null)
    }
  } catch (err: any) {
    errors[device.id] = err?.message || '解绑失败'
  } finally {
    busy[device.id] = false
  }
}

// 内置工具箱作坊：多绑、默认自动绑定全部 AI（按 device_id 前缀识别，无需新增字段）。
const isToolboxDevice = (device: ConnectedDevice) => String(device.id || '').startsWith('toolbox_builtin_')

const deviceTypeLabel = (device: ConnectedDevice) => {
  const platform = String(device.platform || '').toLowerCase()
  if (isToolboxDevice(device)) return '工具箱'
  if (isWorkshopDevice(device)) return '图书馆'
  if (isAndroidDevice(device)) return '安卓端'
  if (device.isBrowserExtension || platform.includes('browser')) return '浏览器插件'
  if (device.isWindowsDesktop || platform.includes('desktop') || platform.includes('windows')) return '软件端'
  return '设备端'
}

// 内置图书馆使用专用绑定接口，但在本面板保持与其它设备一致的交互。
const isWorkshopDevice = (device: ConnectedDevice) => {
  const platform = String(device.platform || '').toLowerCase()
  return platform.includes('workshop')
}

const isSoftwareDevice = (device: ConnectedDevice) => {
  const platform = String(device.platform || '').toLowerCase()
  return !!device.isWindowsDesktop || platform.includes('desktop') || platform.includes('windows')
}

const isAndroidDevice = (device: ConnectedDevice) => {
  const platform = String(device.platform || '').toLowerCase()
  return !!device.isAndroid || platform.includes('android')
}

const isEndpointDevice = (device: ConnectedDevice) => {
  const platform = String(device.platform || '').toLowerCase()
  return isSoftwareDevice(device) || isAndroidDevice(device) || !!device.isBrowserExtension || platform.includes('browser') || isWorkshopDevice(device)
}

const deviceDisplayName = (device: ConnectedDevice) => {
  return device.name || device.id || deviceTypeLabel(device)
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

const linkedMember = (device: ConnectedDevice) => {
  const id = linkedConfigId(device)
  if (!id) return undefined
  return memberByConfigId.value.get(id)
}

const hasLinkedMember = (device: ConnectedDevice) => !!linkedMember(device)

const memberPanelClass = (device: ConnectedDevice) => hasLinkedMember(device)
  ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-500/30 dark:bg-emerald-500/10'
  : 'border-amber-200 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-500/10'

const deviceCardClass = (device: ConnectedDevice) => hasLinkedMember(device)
  ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10'
  : 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10'

const memberLabelClass = (device: ConnectedDevice) => hasLinkedMember(device)
  ? 'text-emerald-600 dark:text-emerald-300'
  : 'text-amber-600 dark:text-amber-300'

const memberStatusLabel = (device: ConnectedDevice) => hasLinkedMember(device) ? '已链接成员' : '未链接成员'

const memberStatusBadgeClass = (device: ConnectedDevice) => hasLinkedMember(device)
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

      <div
        v-if="isToolboxDevice(device)"
        class="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-2 text-[10px] leading-relaxed text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200"
      >
        工具箱默认绑定全部 AI（多绑），每个 AI 自动获得默认工具集；如需对某个 AI 增减，请在「AI 配置」里管理。
      </div>
      <div v-else class="mt-2 rounded-lg border p-2" :class="memberPanelClass(device)">
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
            ID: {{ linkedConfigId(device) }}<span v-if="linkedMember(device)?.projectName"> · {{ linkedMember(device)?.projectName }}</span>
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

      <!-- Endpoint agents: edit their per-(AI, type) MCP permission scope. 工具箱无 scope。 -->
      <DeviceMcpScopeEditor
        v-if="isEndpointDevice(device) && !isToolboxDevice(device)"
        class="mt-2"
      :device-id="device.id"
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

      <!-- 图书馆治理类 MCP：与 librarian.* 一并构成完整图书馆 MCP；这些按 AI 配置开关。 -->
      <div
        v-if="device.libraryGovernanceTools && device.libraryGovernanceTools.length"
        class="mt-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-2 dark:border-zinc-700 dark:bg-zinc-800/40"
      >
        <div class="text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">治理工具（完整图书馆 MCP）</div>
        <div class="mt-0.5 text-[9px] text-zinc-400 dark:text-zinc-500">
          这些按 AI 配置开关（在 AI 配置弹窗勾选 MCP），不走作坊 scope；需绑定图书馆方可调用。
        </div>
        <div class="mt-1.5 flex flex-wrap gap-1">
          <span
            v-for="cap in device.libraryGovernanceTools"
            :key="cap"
            :title="cap"
            class="text-[9px] px-1 py-0.5 rounded border border-zinc-200 bg-white text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          >
            {{ getMcpToolZhLabel(cap) }}
          </span>
        </div>
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
