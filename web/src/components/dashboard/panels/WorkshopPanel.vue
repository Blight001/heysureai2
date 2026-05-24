<script setup lang="ts">
import { computed } from 'vue'
import type { ConnectedAgent } from '@/composables/dashboard/useDashboardData'

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

const lastTaskClass = (status?: string | null) => {
  if (status === 'success') return 'text-emerald-600 dark:text-emerald-400'
  if (status === 'failed' || status === 'error') return 'text-rose-600 dark:text-rose-400'
  if (status === 'running' || status === 'dispatching') return 'text-indigo-600 dark:text-indigo-400'
  return 'text-zinc-500 dark:text-zinc-400'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
    <div v-if="devices.length === 0" class="text-center text-zinc-400 text-xs py-10 dark:text-zinc-500">
      暂无已连接设备。
    </div>

    <div
      v-for="device in devices"
      :key="device.id"
      class="rounded-xl border border-zinc-100 bg-white/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
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

      <div class="mt-2 rounded-lg border border-zinc-100 bg-zinc-50/70 p-2 dark:border-zinc-800 dark:bg-zinc-950/40">
        <div class="text-[10px] text-zinc-400 dark:text-zinc-500 mb-1">分配成员</div>
        <template v-if="device.aiConfigId && memberByConfigId.get(device.aiConfigId)">
          <div class="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
            {{ memberByConfigId.get(device.aiConfigId)?.name }}
          </div>
          <div class="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">
            ID: {{ device.aiConfigId }}
            <span v-if="memberByConfigId.get(device.aiConfigId)?.projectName"> · {{ memberByConfigId.get(device.aiConfigId)?.projectName }}</span>
          </div>
          <div class="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 truncate">
            {{ memberByConfigId.get(device.aiConfigId)?.currentTaskTitle || memberByConfigId.get(device.aiConfigId)?.currentTask || '等待任务' }}
          </div>
        </template>
        <div v-else class="text-xs text-zinc-400 dark:text-zinc-500">未分配成员</div>
      </div>

      <div class="mt-2 grid grid-cols-2 gap-2 text-[10px]">
        <div class="rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/50">
          <div class="text-zinc-400">最近任务</div>
          <div class="truncate" :class="lastTaskClass(device.lastTaskStatus)">
            {{ device.lastTaskStatus || '暂无' }}
          </div>
        </div>
        <div class="rounded bg-zinc-50 px-2 py-1 dark:bg-zinc-800/50">
          <div class="text-zinc-400">任务ID</div>
          <div class="text-zinc-500 dark:text-zinc-400 truncate">{{ device.lastTaskId || '无' }}</div>
        </div>
      </div>

      <div v-if="device.capabilities.length" class="mt-2 flex flex-wrap gap-1">
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
