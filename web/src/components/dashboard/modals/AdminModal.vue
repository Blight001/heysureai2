<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMessage } from '@/composables/useMessage'
import * as adminApi from '@/api/admin'
import type { AdminTask, AdminUser, LogLine, ServiceInfo } from '@/api/admin'
import type { User, UserRole } from '@/types'

const props = defineProps<{
  show: boolean
  currentUser?: User | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { alert, confirm, prompt } = useMessage()

type Tab = 'services' | 'users'
const tab = ref<Tab>('services')

// ---- Services + tasks ----
const services = ref<ServiceInfo[]>([])
const servicesLoading = ref(false)
const selectedServiceKey = ref<string>('gateway')
const logLines = ref<LogLine[]>([])
const logsLoading = ref(false)
const logsNote = ref<string>('')

const tasks = ref<AdminTask[]>([])
const tasksLoading = ref(false)
const busyRun = ref<string>('')
const busyService = ref<string>('')

// ---- Users ----
const users = ref<AdminUser[]>([])
const usersLoading = ref(false)

const isOwner = computed(() => props.currentUser?.role === 'owner')

const STATUS_META: Record<string, { label: string; cls: string }> = {
  running: { label: '运行中', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  degraded: { label: '降级', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  down: { label: '离线', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  local: { label: '单体内置', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
}

const TASK_STATUS_CLS: Record<string, string> = {
  running: 'text-indigo-600 dark:text-indigo-300',
  queued: 'text-amber-600 dark:text-amber-300',
  completed: 'text-emerald-600 dark:text-emerald-300',
  error: 'text-red-600 dark:text-red-300',
  stopped: 'text-zinc-500 dark:text-zinc-400',
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'owner', label: '房主' },
  { value: 'admin', label: '管理员' },
  { value: 'member', label: '成员' },
]

const fmtTime = (ts: number | null | undefined): string => {
  if (!ts) return '—'
  try {
    return new Date(ts * 1000).toLocaleString()
  } catch {
    return '—'
  }
}

const fmtLogTime = (ts: number): string => {
  try {
    return new Date(ts * 1000).toLocaleTimeString()
  } catch {
    return ''
  }
}

const loadServices = async () => {
  servicesLoading.value = true
  try {
    const res = await adminApi.listServices()
    services.value = res.services
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    servicesLoading.value = false
  }
}

const loadLogs = async (key: string) => {
  selectedServiceKey.value = key
  logsLoading.value = true
  logsNote.value = ''
  try {
    const res = await adminApi.getServiceLogs(key, 200)
    logLines.value = res.lines
    logsNote.value = res.note || ''
  } catch (err) {
    logLines.value = []
    logsNote.value = (err as Error).message
  } finally {
    logsLoading.value = false
  }
}

const loadTasks = async () => {
  tasksLoading.value = true
  try {
    const res = await adminApi.listTasks(50)
    tasks.value = res.tasks
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    tasksLoading.value = false
  }
}

const refreshServicesTab = async () => {
  await Promise.all([loadServices(), loadTasks(), loadLogs(selectedServiceKey.value)])
}

const stopTask = async (task: AdminTask) => {
  const ok = await confirm({ message: `确认停止子任务 ${task.run_id}？`, type: 'warning' })
  if (!ok) return
  busyRun.value = task.run_id
  try {
    await adminApi.stopTask(task.run_id)
    await loadTasks()
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    busyRun.value = ''
  }
}

const restartService = async (svc: ServiceInfo) => {
  const isSelf = svc.key === 'gateway'
  const ok = await confirm({
    message: isSelf
      ? `确认重启「${svc.name}」？这是当前正在服务本页面的进程，重启期间面板会短暂断开，恢复后请刷新。`
      : `确认重启「${svc.name}」服务（端口 ${svc.url || svc.key}）？该服务会重启进程并在同一端口恢复。`,
    type: 'warning',
  })
  if (!ok) return
  busyService.value = svc.key
  try {
    await adminApi.restartService(svc.key)
    await alert({
      message: isSelf ? '网关正在重启，请稍候刷新页面。' : `${svc.name} 正在重启…`,
      type: 'success',
    })
    if (!isSelf) {
      // Give the process a moment to re-exec, then refresh status.
      setTimeout(() => void loadServices(), 2500)
    }
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    busyService.value = ''
  }
}

const loadUsers = async () => {
  usersLoading.value = true
  try {
    const res = await adminApi.listUsers()
    users.value = res.users
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    usersLoading.value = false
  }
}

const changeRole = async (u: AdminUser, event: Event) => {
  const role = (event.target as HTMLSelectElement).value as UserRole
  if (role === u.role) return
  const ok = await confirm({ message: `将 ${u.name}（${u.account}）的权限设为「${ROLE_OPTIONS.find(r => r.value === role)?.label}」？`, type: 'warning' })
  if (!ok) {
    ;(event.target as HTMLSelectElement).value = u.role
    return
  }
  try {
    const res = await adminApi.setUserRole(u.id, role)
    const idx = users.value.findIndex(x => x.id === u.id)
    if (idx >= 0) users.value[idx] = res.user
  } catch (err) {
    ;(event.target as HTMLSelectElement).value = u.role
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

const resetPassword = async (u: AdminUser) => {
  const pwd = await prompt({
    title: '重置密码',
    message: `为 ${u.name}（${u.account}）设置新密码（至少 6 位）`,
    placeholder: '输入新密码',
  })
  if (pwd === null) return
  if (pwd.trim().length < 6) {
    await alert({ message: '密码至少需要 6 位', type: 'warning' })
    return
  }
  try {
    await adminApi.resetUserPassword(u.id, pwd.trim())
    await alert({ message: '密码已重置', type: 'success' })
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

const deleteUser = async (u: AdminUser) => {
  const ok = await confirm({
    message: `确认删除用户 ${u.name}（${u.account}）？该用户的所有数据将一并删除，且不可恢复。`,
    type: 'warning',
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await adminApi.deleteUser(u.id)
    users.value = users.value.filter(x => x.id !== u.id)
    await alert({ message: '用户已删除', type: 'success' })
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

const switchTab = (next: Tab) => {
  tab.value = next
  if (next === 'users' && !users.value.length) void loadUsers()
}

watch(
  () => props.show,
  (open) => {
    if (!open) return
    tab.value = 'services'
    void refreshServicesTab()
    void loadUsers()
  },
)

const avatarFor = (u: AdminUser) =>
  u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        class="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center backdrop-blur-sm p-4"
        @click="emit('close')"
      >
        <div
          class="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden dark:bg-zinc-900 dark:border dark:border-zinc-800"
          @click.stop
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <div class="flex items-center gap-2">
              <span class="text-lg">🛡️</span>
              <h2 class="text-sm md:text-base font-bold text-zinc-800 dark:text-zinc-100">管理员控制台</h2>
            </div>
            <button
              class="w-8 h-8 rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 flex items-center justify-center"
              @click="emit('close')"
            >✕</button>
          </div>

          <!-- Tabs -->
          <div class="flex gap-1 px-5 pt-3 border-b border-zinc-200 dark:border-zinc-800">
            <button
              v-for="t in (['services','users'] as Tab[])"
              :key="t"
              class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
              :class="tab === t
                ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500 dark:bg-indigo-900/20 dark:text-indigo-300'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'"
              @click="switchTab(t)"
            >{{ t === 'services' ? '服务监控' : '用户管理' }}</button>
          </div>

          <!-- ============ Services tab ============ -->
          <div v-show="tab === 'services'" class="flex-1 overflow-y-auto p-5 space-y-5">
            <!-- Service cards -->
            <section>
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-400">子服务运行状态</h3>
                <button
                  class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                  :disabled="servicesLoading"
                  @click="refreshServicesTab"
                >{{ servicesLoading ? '刷新中…' : '↻ 刷新' }}</button>
              </div>
              <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div
                  v-for="svc in services"
                  :key="svc.key"
                  class="text-left p-3 rounded-xl border transition-colors cursor-pointer"
                  :class="selectedServiceKey === svc.key
                    ? 'border-indigo-300 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-900/10'
                    : 'border-zinc-200 hover:border-indigo-200 dark:border-zinc-800 dark:hover:border-indigo-800'"
                  @click="loadLogs(svc.key)"
                >
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{{ svc.name }}</span>
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      :class="(STATUS_META[svc.status] || STATUS_META.local).cls"
                    >{{ (STATUS_META[svc.status] || { label: svc.status }).label }}</span>
                  </div>
                  <div class="text-[10px] text-zinc-400 mt-1 truncate">{{ svc.url || svc.key }}</div>
                  <div class="mt-2 flex justify-end">
                    <button
                      v-if="svc.status !== 'local'"
                      class="text-[11px] px-2 py-1 rounded-lg text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 disabled:opacity-50"
                      :disabled="busyService === svc.key"
                      @click.stop="restartService(svc)"
                    >{{ busyService === svc.key ? '重启中…' : '↻ 重启服务' }}</button>
                    <span v-else class="text-[10px] text-zinc-400">内置无需重启</span>
                  </div>
                </div>
              </div>
            </section>

            <!-- Console output -->
            <section>
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  控制台输出 · {{ services.find(s => s.key === selectedServiceKey)?.name || selectedServiceKey }}
                </h3>
                <button
                  class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                  :disabled="logsLoading"
                  @click="loadLogs(selectedServiceKey)"
                >{{ logsLoading ? '加载中…' : '↻ 刷新日志' }}</button>
              </div>
              <div class="bg-zinc-950 text-zinc-100 rounded-xl p-3 font-mono text-[11px] leading-relaxed h-56 overflow-y-auto">
                <div v-if="logsNote" class="text-amber-400 mb-1">{{ logsNote }}</div>
                <div v-if="!logLines.length && !logsLoading && !logsNote" class="text-zinc-500">暂无日志</div>
                <div v-for="line in logLines" :key="line.seq" class="whitespace-pre-wrap break-all">
                  <span class="text-zinc-500">{{ fmtLogTime(line.ts) }}</span>
                  <span
                    class="mx-1 font-bold"
                    :class="{
                      'text-red-400': line.level === 'ERROR' || line.level === 'CRITICAL',
                      'text-amber-400': line.level === 'WARNING',
                      'text-sky-400': line.level === 'INFO',
                      'text-zinc-500': line.level === 'DEBUG',
                    }"
                  >{{ line.level }}</span>
                  <span class="text-zinc-400">{{ line.logger }}</span>
                  <span class="text-zinc-100"> — {{ line.msg }}</span>
                </div>
              </div>
            </section>

            <!-- Sub-tasks -->
            <section>
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-400">子任务运行状态</h3>
                <button
                  class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                  :disabled="tasksLoading"
                  @click="loadTasks"
                >{{ tasksLoading ? '刷新中…' : '↻ 刷新' }}</button>
              </div>
              <div class="border border-zinc-200 rounded-xl overflow-hidden dark:border-zinc-800">
                <table class="w-full text-xs">
                  <thead class="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                    <tr>
                      <th class="text-left px-3 py-2 font-medium">运行 ID</th>
                      <th class="text-left px-3 py-2 font-medium">用户</th>
                      <th class="text-left px-3 py-2 font-medium">状态</th>
                      <th class="text-left px-3 py-2 font-medium hidden md:table-cell">更新时间</th>
                      <th class="text-right px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!tasks.length">
                      <td colspan="5" class="px-3 py-6 text-center text-zinc-400">暂无子任务</td>
                    </tr>
                    <tr
                      v-for="task in tasks"
                      :key="task.run_id"
                      class="border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <td class="px-3 py-2 font-mono text-zinc-700 dark:text-zinc-300 truncate max-w-[140px]" :title="task.run_id">{{ task.run_id }}</td>
                      <td class="px-3 py-2 text-zinc-600 dark:text-zinc-400">{{ task.user_name || task.user_account || ('#' + task.user_id) }}</td>
                      <td class="px-3 py-2 font-semibold" :class="TASK_STATUS_CLS[task.status] || 'text-zinc-500'">
                        {{ task.status }}<span v-if="task.stop_requested" class="text-[10px] text-zinc-400">（已请求停止）</span>
                      </td>
                      <td class="px-3 py-2 text-zinc-400 hidden md:table-cell">{{ fmtTime(task.updated_at) }}</td>
                      <td class="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          v-if="task.status === 'running' || task.status === 'queued'"
                          class="text-[11px] px-2 py-1 rounded-lg text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
                          :disabled="busyRun === task.run_id"
                          @click="stopTask(task)"
                        >停止</button>
                        <span v-else class="text-[11px] text-zinc-300 dark:text-zinc-600">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <!-- ============ Users tab ============ -->
          <div v-show="tab === 'users'" class="flex-1 overflow-y-auto p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-400">后台用户</h3>
              <button
                class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                :disabled="usersLoading"
                @click="loadUsers"
              >{{ usersLoading ? '刷新中…' : '↻ 刷新' }}</button>
            </div>
            <div class="space-y-2">
              <div
                v-for="u in users"
                :key="u.id"
                class="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800"
              >
                <img :src="avatarFor(u)" class="w-10 h-10 rounded-full border border-zinc-200 bg-zinc-50 object-cover shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">{{ u.name }}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{{ u.role_label }}</span>
                  </div>
                  <div class="text-xs text-zinc-400 truncate">账号：{{ u.account }} · 注册于 {{ fmtTime(u.created_at) }}</div>
                </div>
                <select
                  class="text-xs border border-zinc-200 rounded-lg px-2 py-1.5 bg-white text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 disabled:opacity-50"
                  :value="u.role"
                  :disabled="!isOwner"
                  :title="isOwner ? '设置权限' : '仅房主可调整权限'"
                  @change="changeRole(u, $event)"
                >
                  <option v-for="opt in ROLE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <button
                  class="text-[11px] px-2 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-300 whitespace-nowrap"
                  @click="resetPassword(u)"
                >重置密码</button>
                <button
                  v-if="u.id !== currentUser?.id"
                  class="text-[11px] px-2 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 dark:border-red-800/60 dark:text-red-400 dark:hover:bg-red-900/20 whitespace-nowrap"
                  @click="deleteUser(u)"
                >删除</button>
              </div>
              <div v-if="!users.length && !usersLoading" class="text-center text-zinc-400 py-8 text-sm">暂无用户</div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
