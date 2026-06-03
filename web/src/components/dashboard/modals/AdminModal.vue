<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useMessage } from '@/composables/useMessage'
import * as adminApi from '@/api/admin'
import type {
  AdminTask, AdminUser, AuditEntry, DbColumn, DbTableMeta, DbValue,
  FileEntry, LogLine, ServiceInfo,
} from '@/api/admin'
import type { User, UserRole } from '@/types'
import { resolveAvatarUrl } from '@/utils/avatar'

const props = defineProps<{
  show: boolean
  currentUser?: User | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { alert, confirm, prompt } = useMessage()

type Tab = 'services' | 'users' | 'files' | 'database' | 'audit'
const tab = ref<Tab>('services')
const TAB_LABELS: Record<Tab, string> = {
  services: '服务监控',
  users: '用户管理',
  files: '文件管理',
  database: '数据库',
  audit: '操作审计',
}

// ---- Services + tasks ----
const services = ref<ServiceInfo[]>([])
const servicesLoading = ref(false)
const selectedServiceKey = ref<string>('gateway')
const logLines = ref<LogLine[]>([])
const logsLoading = ref(false)
const logsNote = ref<string>('')

// ---- Log view controls ----
const logLevel = ref<string>('')
const logSearch = ref<string>('')
const logAutoScroll = ref(true)
const logContainer = ref<HTMLElement | null>(null)
const LOG_LEVELS = ['', 'DEBUG', 'INFO', 'WARNING', 'ERROR']

// ---- Auto refresh ----
const autoRefresh = ref(true)
let refreshTimer: number | null = null
const REFRESH_INTERVAL_MS = 5000

const tasks = ref<AdminTask[]>([])
const tasksLoading = ref(false)
const busyRun = ref<string>('')
const busyService = ref<string>('')

// ---- Users ----
const users = ref<AdminUser[]>([])
const usersLoading = ref(false)
const newUserOpen = ref(false)
const creatingUser = ref(false)
const newUser = ref<{ name: string; account: string; password: string; role: UserRole }>({
  name: '', account: '', password: '', role: 'member',
})

// ---- Audit ----
const auditEntries = ref<AuditEntry[]>([])
const auditLoading = ref(false)

// ---- Files (server data folder) ----
const DEFAULT_FILE_PATH = 'workspace'
const filePath = ref(DEFAULT_FILE_PATH)          // current directory, relative to data/
const fileEntries = ref<FileEntry[]>([])
const filesLoading = ref(false)
const editingFile = ref<string | null>(null)     // open file's relative path, or null
const fileContent = ref('')
const fileOriginal = ref('')
const fileLoading = ref(false)
const fileSaving = ref(false)
const fileBinary = ref(false)
const fileTooLarge = ref(false)
const fileKind = ref<'text' | 'image' | 'binary'>('text')   // viewer for the open file
const fileImageUrl = ref('')                                 // object URL for image preview
const fileDownloading = ref(false)
// Batch selection (relative paths of ticked rows in the current directory)
const fileSelected = ref<Set<string>>(new Set())
const fileBatchBusy = ref(false)

// ---- Database browser ----
const dbTables = ref<DbTableMeta[]>([])
const dbTablesLoading = ref(false)
const dbActiveTable = ref<string>('')
const dbColumns = ref<DbColumn[]>([])
const dbPrimaryKey = ref<string[]>([])
const dbRows = ref<Record<string, DbValue>[]>([])
const dbRowsLoading = ref(false)
const dbTotal = ref(0)
const dbOffset = ref(0)
const dbSearch = ref('')
const DB_PAGE_SIZE = 50
// Row editor: null when closed; mode 'insert' | 'update'
const dbEditor = ref<{
  mode: 'insert' | 'update'
  pk: Record<string, DbValue> | null
  values: Record<string, string>
} | null>(null)
const dbSaving = ref(false)

const isOwner = computed(() => props.currentUser?.role === 'owner')

const filteredLogLines = computed(() => {
  const q = logSearch.value.trim().toLowerCase()
  if (!q) return logLines.value
  return logLines.value.filter(l =>
    l.msg.toLowerCase().includes(q) || l.logger.toLowerCase().includes(q),
  )
})

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

const scrollLogsToBottom = () => {
  if (!logAutoScroll.value) return
  void nextTick(() => {
    const el = logContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

const loadLogs = async (key: string, silent = false) => {
  selectedServiceKey.value = key
  if (!silent) logsLoading.value = true
  logsNote.value = ''
  try {
    const res = await adminApi.getServiceLogs(key, 300, logLevel.value || undefined)
    logLines.value = res.lines
    logsNote.value = res.note || ''
    scrollLogsToBottom()
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

const submitNewUser = async () => {
  const name = newUser.value.name.trim()
  const account = newUser.value.account.trim()
  const password = newUser.value.password.trim()
  if (!name || !account) {
    await alert({ message: '昵称和账号不能为空', type: 'warning' })
    return
  }
  if (password.length < 6) {
    await alert({ message: '密码至少需要 6 位', type: 'warning' })
    return
  }
  creatingUser.value = true
  try {
    const res = await adminApi.createUser({ name, account, password, role: newUser.value.role })
    users.value.push(res.user)
    newUser.value = { name: '', account: '', password: '', role: 'member' }
    newUserOpen.value = false
    await alert({ message: '用户已创建', type: 'success' })
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    creatingUser.value = false
  }
}

const loadAudit = async () => {
  auditLoading.value = true
  try {
    const res = await adminApi.listAudit(100)
    auditEntries.value = res.entries
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    auditLoading.value = false
  }
}

const ACTION_LABELS: Record<string, string> = {
  set_role: '设置权限',
  reset_password: '重置密码',
  delete_user: '删除用户',
  create_user: '创建用户',
  restart_service: '重启服务',
  stop_task: '停止子任务',
  file_write: '保存文件',
  file_mkdir: '新建文件夹',
  file_rename: '重命名',
  file_delete: '删除文件',
  db_insert: '插入数据',
  db_update: '更新数据',
  db_delete: '删除数据',
}

// ---- File manager ----
const joinPath = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

const fileBreadcrumbs = computed(() => {
  const crumbs: { name: string; path: string }[] = [{ name: 'data', path: '' }]
  let acc = ''
  for (const part of filePath.value ? filePath.value.split('/') : []) {
    acc = acc ? `${acc}/${part}` : part
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
})

const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const fileDirty = computed(() => fileContent.value !== fileOriginal.value)

const closeFile = () => {
  editingFile.value = null
  fileContent.value = ''
  fileOriginal.value = ''
  fileBinary.value = false
  fileTooLarge.value = false
  fileKind.value = 'text'
  if (fileImageUrl.value) {
    URL.revokeObjectURL(fileImageUrl.value)
    fileImageUrl.value = ''
  }
}

const loadFiles = async (path = filePath.value, silent = false) => {
  if (!silent) filesLoading.value = true
  try {
    const res = await adminApi.listFiles(path)
    if (res.path !== filePath.value) fileSelected.value = new Set()  // reset on navigation
    filePath.value = res.path
    fileEntries.value = res.entries
    // Drop ticks for entries that no longer exist (e.g. after a delete).
    const live = new Set(res.entries.map(e => e.path))
    fileSelected.value = new Set([...fileSelected.value].filter(p => live.has(p)))
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    filesLoading.value = false
  }
}

const openFile = async (entry: FileEntry) => {
  closeFile()
  fileLoading.value = true
  editingFile.value = entry.path
  try {
    if (entry.kind === 'image') {
      fileKind.value = 'image'
      const blob = await adminApi.fetchFileBlob(entry.path)
      fileImageUrl.value = URL.createObjectURL(blob)
      return
    }
    const res = await adminApi.readFile(entry.path)
    fileBinary.value = res.binary
    fileTooLarge.value = res.too_large
    fileContent.value = res.content
    fileOriginal.value = res.content
    fileKind.value = res.binary ? 'binary' : 'text'
  } catch (err) {
    editingFile.value = null
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    fileLoading.value = false
  }
}

const openEntry = (entry: FileEntry) => {
  if (entry.is_dir) void loadFiles(entry.path)
  else void openFile(entry)
}

const downloadFile = async (path: string, name: string) => {
  fileDownloading.value = true
  try {
    const blob = await adminApi.fetchFileBlob(path)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    fileDownloading.value = false
  }
}

// ---- Batch selection ----
const fileAllSelected = computed(() =>
  fileEntries.value.length > 0 && fileSelected.value.size === fileEntries.value.length,
)

const toggleSelect = (path: string) => {
  const next = new Set(fileSelected.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  fileSelected.value = next
}

const toggleSelectAll = () => {
  fileSelected.value = fileAllSelected.value
    ? new Set()
    : new Set(fileEntries.value.map(e => e.path))
}

const batchDelete = async () => {
  const paths = [...fileSelected.value]
  if (!paths.length) return
  const ok = await confirm({
    message: `确认删除选中的 ${paths.length} 项？文件夹内的所有内容也会一并删除，此操作不可恢复。`,
    type: 'warning',
    confirmText: '删除',
  })
  if (!ok) return
  fileBatchBusy.value = true
  try {
    const res = await adminApi.batchDeleteFiles(paths)
    if (editingFile.value !== null && res.deleted.includes(editingFile.value)) closeFile()
    fileSelected.value = new Set()
    await loadFiles()
    if (res.errors.length) {
      await alert({
        message: `已删除 ${res.deleted.length} 项，${res.errors.length} 项失败：` +
          res.errors.map(e => `${e.path}（${e.error}）`).join('；'),
        type: 'warning',
      })
    }
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    fileBatchBusy.value = false
  }
}

const saveFile = async () => {
  if (editingFile.value === null) return
  fileSaving.value = true
  try {
    await adminApi.writeFile(editingFile.value, fileContent.value)
    fileOriginal.value = fileContent.value
    await alert({ message: '已保存', type: 'success' })
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    fileSaving.value = false
  }
}

const newFile = async () => {
  const name = await prompt({
    title: '新建文件',
    message: `在 ${filePath.value ? 'data/' + filePath.value : 'data'} 下创建文件`,
    placeholder: '文件名，如 notes.txt',
  })
  if (name === null) return
  const trimmed = name.trim()
  if (!trimmed) return
  const path = joinPath(filePath.value, trimmed)
  try {
    await adminApi.writeFile(path, '')
    await loadFiles()
    const entry = fileEntries.value.find(e => e.path === path)
    if (entry) await openFile(entry)
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

const newFolder = async () => {
  const name = await prompt({
    title: '新建文件夹',
    message: `在 ${filePath.value ? 'data/' + filePath.value : 'data'} 下创建文件夹`,
    placeholder: '文件夹名',
  })
  if (name === null) return
  const trimmed = name.trim()
  if (!trimmed) return
  try {
    await adminApi.makeDir(joinPath(filePath.value, trimmed))
    await loadFiles()
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

const renameEntry = async (entry: FileEntry) => {
  const name = await prompt({
    title: '重命名',
    message: `重命名「${entry.name}」`,
    placeholder: '新名称',
    defaultValue: entry.name,
  })
  if (name === null) return
  const trimmed = name.trim()
  if (!trimmed || trimmed === entry.name) return
  try {
    await adminApi.renameFile(entry.path, joinPath(filePath.value, trimmed))
    if (editingFile.value === entry.path) closeFile()
    await loadFiles()
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

const deleteEntry = async (entry: FileEntry) => {
  const ok = await confirm({
    message: `确认删除${entry.is_dir ? '文件夹' : '文件'}「${entry.name}」？${entry.is_dir ? '其中所有内容将一并删除，' : ''}此操作不可恢复。`,
    type: 'warning',
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await adminApi.deleteFile(entry.path)
    if (editingFile.value === entry.path) closeFile()
    await loadFiles()
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

// ---- Database browser ----
const dbValueToStr = (v: DbValue): string => {
  if (v === null || v === undefined) return ''
  return String(v)
}

const dbCellPreview = (v: DbValue): string => {
  const s = dbValueToStr(v)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

const dbPageStart = computed(() => (dbTotal.value === 0 ? 0 : dbOffset.value + 1))
const dbPageEnd = computed(() => Math.min(dbOffset.value + DB_PAGE_SIZE, dbTotal.value))

const loadDbTables = async () => {
  dbTablesLoading.value = true
  try {
    const res = await adminApi.listDbTables()
    dbTables.value = res.tables
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    dbTablesLoading.value = false
  }
}

const loadDbRows = async () => {
  if (!dbActiveTable.value) return
  dbRowsLoading.value = true
  try {
    const res = await adminApi.listDbRows(dbActiveTable.value, DB_PAGE_SIZE, dbOffset.value, dbSearch.value.trim())
    dbColumns.value = res.columns
    dbPrimaryKey.value = res.primary_key
    dbRows.value = res.rows
    dbTotal.value = res.total
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    dbRowsLoading.value = false
  }
}

const selectDbTable = (name: string) => {
  if (name === dbActiveTable.value) return
  dbActiveTable.value = name
  dbOffset.value = 0
  dbSearch.value = ''
  dbEditor.value = null
  void loadDbRows()
}

const dbSearchSubmit = () => {
  dbOffset.value = 0
  void loadDbRows()
}

const dbNextPage = () => {
  if (dbOffset.value + DB_PAGE_SIZE >= dbTotal.value) return
  dbOffset.value += DB_PAGE_SIZE
  void loadDbRows()
}

const dbPrevPage = () => {
  if (dbOffset.value <= 0) return
  dbOffset.value = Math.max(0, dbOffset.value - DB_PAGE_SIZE)
  void loadDbRows()
}

const rowPk = (row: Record<string, DbValue>): Record<string, DbValue> => {
  const pk: Record<string, DbValue> = {}
  for (const k of dbPrimaryKey.value) pk[k] = row[k]
  return pk
}

const openDbInsert = () => {
  const values: Record<string, string> = {}
  for (const c of dbColumns.value) values[c.name] = ''
  dbEditor.value = { mode: 'insert', pk: null, values }
}

const openDbEdit = (row: Record<string, DbValue>) => {
  const values: Record<string, string> = {}
  for (const c of dbColumns.value) values[c.name] = dbValueToStr(row[c.name])
  dbEditor.value = { mode: 'update', pk: rowPk(row), values }
}

const closeDbEditor = () => { dbEditor.value = null }

const dbColIsPk = (name: string) => dbPrimaryKey.value.includes(name)

const saveDbRow = async () => {
  if (!dbEditor.value || !dbActiveTable.value) return
  dbSaving.value = true
  try {
    if (dbEditor.value.mode === 'insert') {
      await adminApi.insertDbRow(dbActiveTable.value, dbEditor.value.values)
      await alert({ message: '已插入', type: 'success' })
    } else {
      const pk = dbEditor.value.pk || {}
      // Only send non-PK columns as updatable values.
      const values: Record<string, string> = {}
      for (const [k, v] of Object.entries(dbEditor.value.values)) {
        if (!dbColIsPk(k)) values[k] = v
      }
      await adminApi.updateDbRow(dbActiveTable.value, pk, values)
      await alert({ message: '已更新', type: 'success' })
    }
    dbEditor.value = null
    await Promise.all([loadDbRows(), loadDbTables()])
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    dbSaving.value = false
  }
}

const deleteDbRow = async (row: Record<string, DbValue>) => {
  const pk = rowPk(row)
  const label = Object.entries(pk).map(([k, v]) => `${k}=${v}`).join(', ')
  const ok = await confirm({
    message: `确认从表「${dbActiveTable.value}」删除该行（${label}）？此操作不可恢复。`,
    type: 'warning',
    confirmText: '删除',
  })
  if (!ok) return
  try {
    await adminApi.deleteDbRow(dbActiveTable.value, pk)
    await Promise.all([loadDbRows(), loadDbTables()])
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

// ---- Auto refresh: poll the live data on whichever tab is open ----
const tick = () => {
  if (!props.show) return
  if (tab.value === 'services') {
    void loadServices()
    void loadTasks()
    void loadLogs(selectedServiceKey.value, true)
  } else if (tab.value === 'audit') {
    void loadAudit()
  }
}

const startAutoRefresh = () => {
  stopAutoRefresh()
  if (!autoRefresh.value) return
  refreshTimer = window.setInterval(tick, REFRESH_INTERVAL_MS)
}

const stopAutoRefresh = () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer)
    refreshTimer = null
  }
}

watch(autoRefresh, () => startAutoRefresh())
watch(logLevel, () => { if (props.show) void loadLogs(selectedServiceKey.value, true) })

const switchTab = (next: Tab) => {
  tab.value = next
  if (next === 'users' && !users.value.length) void loadUsers()
  if (next === 'files' && !fileEntries.value.length && editingFile.value === null) void loadFiles(filePath.value || DEFAULT_FILE_PATH)
  if (next === 'database' && !dbTables.value.length) void loadDbTables()
  if (next === 'audit') void loadAudit()
}

watch(
  () => props.show,
  (open) => {
    if (!open) {
      stopAutoRefresh()
      return
    }
    tab.value = 'services'
    newUserOpen.value = false
    closeFile()
    filePath.value = DEFAULT_FILE_PATH
    fileEntries.value = []
    fileSelected.value = new Set()
    dbEditor.value = null
    dbActiveTable.value = ''
    dbRows.value = []
    dbTables.value = []
    void refreshServicesTab()
    void loadUsers()
    startAutoRefresh()
  },
)

onUnmounted(() => {
  stopAutoRefresh()
  if (fileImageUrl.value) URL.revokeObjectURL(fileImageUrl.value)
})

const avatarFor = (u: AdminUser) =>
  resolveAvatarUrl(u.avatar) || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`
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
            <div class="flex items-center gap-3">
              <label class="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer select-none">
                <input type="checkbox" v-model="autoRefresh" class="accent-indigo-500" />
                自动刷新
              </label>
              <button
                class="w-8 h-8 rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 flex items-center justify-center"
                @click="emit('close')"
              >✕</button>
            </div>
          </div>

          <!-- Tabs -->
          <div class="flex gap-1 px-5 pt-3 border-b border-zinc-200 dark:border-zinc-800">
            <button
              v-for="t in (['services','users','files','database','audit'] as Tab[])"
              :key="t"
              class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
              :class="tab === t
                ? 'bg-indigo-50 text-indigo-700 border-b-2 border-indigo-500 dark:bg-indigo-900/20 dark:text-indigo-300'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'"
              @click="switchTab(t)"
            >{{ TAB_LABELS[t] }}</button>
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
              <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  控制台输出 · {{ services.find(s => s.key === selectedServiceKey)?.name || selectedServiceKey }}
                </h3>
                <div class="flex items-center gap-2">
                  <select
                    v-model="logLevel"
                    class="text-xs border border-zinc-200 rounded-lg px-2 py-1 bg-white text-zinc-600 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300"
                    title="按级别过滤"
                  >
                    <option v-for="lv in LOG_LEVELS" :key="lv" :value="lv">{{ lv || '全部级别' }}</option>
                  </select>
                  <input
                    v-model="logSearch"
                    type="text"
                    placeholder="搜索关键字…"
                    class="text-xs border border-zinc-200 rounded-lg px-2 py-1 bg-white text-zinc-600 w-28 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300"
                  />
                  <label class="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400 cursor-pointer select-none">
                    <input type="checkbox" v-model="logAutoScroll" class="accent-indigo-500" /> 滚动到底
                  </label>
                  <button
                    class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                    :disabled="logsLoading"
                    @click="loadLogs(selectedServiceKey)"
                  >{{ logsLoading ? '加载中…' : '↻' }}</button>
                </div>
              </div>
              <div ref="logContainer" class="bg-zinc-950 text-zinc-100 rounded-xl p-3 font-mono text-[11px] leading-relaxed h-56 overflow-y-auto">
                <div v-if="logsNote" class="text-amber-400 mb-1">{{ logsNote }}</div>
                <div v-if="!filteredLogLines.length && !logsLoading && !logsNote" class="text-zinc-500">暂无日志</div>
                <div v-for="line in filteredLogLines" :key="line.seq" class="whitespace-pre-wrap break-all">
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
              <div class="flex items-center gap-2">
                <button
                  class="text-xs px-2 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  @click="newUserOpen = !newUserOpen"
                >＋ 新建用户</button>
                <button
                  class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                  :disabled="usersLoading"
                  @click="loadUsers"
                >{{ usersLoading ? '刷新中…' : '↻ 刷新' }}</button>
              </div>
            </div>

            <!-- New-user form -->
            <Transition name="fade">
              <div v-if="newUserOpen" class="mb-4 p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 dark:border-indigo-800/60 dark:bg-indigo-900/10">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input v-model="newUser.name" type="text" placeholder="昵称"
                    class="text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
                  <input v-model="newUser.account" type="text" placeholder="账号（登录名）" autocomplete="off"
                    class="text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
                  <input v-model="newUser.password" type="password" placeholder="初始密码（至少 6 位）" autocomplete="new-password"
                    class="text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100" />
                  <select v-model="newUser.role"
                    class="text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200">
                    <option v-for="opt in ROLE_OPTIONS" :key="opt.value" :value="opt.value"
                      :disabled="opt.value === 'owner' && !isOwner">{{ opt.label }}</option>
                  </select>
                </div>
                <div class="mt-3 flex justify-end gap-2">
                  <button class="text-xs px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400" @click="newUserOpen = false">取消</button>
                  <button class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    :disabled="creatingUser" @click="submitNewUser">{{ creatingUser ? '创建中…' : '创建' }}</button>
                </div>
              </div>
            </Transition>

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

          <!-- ============ Files tab ============ -->
          <div v-show="tab === 'files'" class="flex-1 overflow-hidden p-5 min-h-0">
            <!-- File editor / viewer (shown when a file is open) -->
            <div v-if="editingFile !== null" class="h-full flex flex-col min-h-0">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div class="flex items-center gap-2 min-w-0">
                  <button
                    class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                    @click="closeFile"
                  >← 返回</button>
                  <span class="text-sm font-mono text-zinc-700 dark:text-zinc-300 truncate" :title="editingFile">data/{{ editingFile }}</span>
                  <span v-if="fileDirty" class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">未保存</span>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400 disabled:opacity-50"
                    :disabled="fileDownloading"
                    @click="downloadFile(editingFile, editingFile.split('/').pop() || 'file')"
                  >{{ fileDownloading ? '下载中…' : '↓ 下载' }}</button>
                  <button
                    v-if="fileKind === 'text' && !fileTooLarge"
                    class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    :disabled="fileSaving || !fileDirty"
                    @click="saveFile"
                  >{{ fileSaving ? '保存中…' : '保存' }}</button>
                </div>
              </div>
              <div v-if="fileLoading" class="text-center text-zinc-400 py-12 text-sm">加载中…</div>
              <!-- Image preview -->
              <div v-else-if="fileKind === 'image'" class="flex-1 min-h-[360px] flex items-center justify-center bg-zinc-100 dark:bg-zinc-950 rounded-xl p-4 overflow-auto">
                <img v-if="fileImageUrl" :src="fileImageUrl" :alt="editingFile" class="max-w-full max-h-full object-contain" />
                <span v-else class="text-zinc-400 text-sm">无法预览此图片</span>
              </div>
              <!-- Binary / oversized: download only -->
              <div v-else-if="fileKind === 'binary' || fileTooLarge" class="text-center text-zinc-400 py-12 text-sm">
                {{ fileTooLarge ? '文件过大（> 1 MB），无法在线编辑。' : '这是二进制文件，无法在线编辑。' }}
                <div class="mt-3">
                  <button
                    class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    :disabled="fileDownloading"
                    @click="downloadFile(editingFile, editingFile.split('/').pop() || 'file')"
                  >↓ 下载文件</button>
                </div>
              </div>
              <!-- Text editor -->
              <textarea
                v-else
                v-model="fileContent"
                spellcheck="false"
                class="w-full flex-1 min-h-[360px] bg-zinc-950 text-zinc-100 rounded-xl p-3 font-mono text-[12px] leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              ></textarea>
            </div>

            <!-- File browser -->
            <div v-else class="h-full flex flex-col min-h-0">
              <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <!-- Breadcrumbs -->
                <div class="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 flex-wrap min-w-0">
                  <template v-for="(crumb, i) in fileBreadcrumbs" :key="crumb.path">
                    <button
                      class="hover:text-indigo-600 dark:hover:text-indigo-300"
                      :class="i === fileBreadcrumbs.length - 1 ? 'font-semibold text-zinc-700 dark:text-zinc-200' : ''"
                      @click="loadFiles(crumb.path)"
                    >{{ crumb.name }}</button>
                    <span v-if="i < fileBreadcrumbs.length - 1" class="text-zinc-300 dark:text-zinc-600">/</span>
                  </template>
                </div>
                <div class="flex items-center gap-2">
                  <button class="text-xs px-2 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700" @click="newFile">＋ 文件</button>
                  <button class="text-xs px-2 py-1 rounded-lg border border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800/60 dark:text-indigo-300 dark:hover:bg-indigo-900/20" @click="newFolder">＋ 文件夹</button>
                  <button
                    class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                    :disabled="filesLoading"
                    @click="loadFiles()"
                  >{{ filesLoading ? '刷新中…' : '↻ 刷新' }}</button>
                </div>
              </div>

              <!-- Batch action bar -->
              <Transition name="fade">
                <div v-if="fileSelected.size" class="mb-3 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/60">
                  <span class="text-xs text-indigo-700 dark:text-indigo-300">已选中 {{ fileSelected.size }} 项</span>
                  <div class="flex items-center gap-2">
                    <button class="text-xs px-2 py-1 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400" @click="fileSelected = new Set()">取消选择</button>
                    <button
                      class="text-xs px-3 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      :disabled="fileBatchBusy"
                      @click="batchDelete"
                    >{{ fileBatchBusy ? '删除中…' : '批量删除' }}</button>
                  </div>
                </div>
              </Transition>

              <div class="border border-zinc-200 rounded-xl overflow-auto dark:border-zinc-800 flex-1 min-h-[360px]">
                <table class="w-full text-xs">
                  <thead class="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400 sticky top-0 z-10">
                    <tr>
                      <th class="w-8 px-3 py-2">
                        <input
                          type="checkbox"
                          class="accent-indigo-500 align-middle"
                          :checked="fileAllSelected"
                          :disabled="!fileEntries.length"
                          title="全选 / 取消全选"
                          @change="toggleSelectAll"
                        />
                      </th>
                      <th class="text-left px-3 py-2 font-medium">名称</th>
                      <th class="text-left px-3 py-2 font-medium hidden sm:table-cell">大小</th>
                      <th class="text-left px-3 py-2 font-medium hidden md:table-cell">修改时间</th>
                      <th class="text-right px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!fileEntries.length && !filesLoading">
                      <td colspan="5" class="px-3 py-8 text-center text-zinc-400">此文件夹为空</td>
                    </tr>
                    <tr
                      v-for="entry in fileEntries"
                      :key="entry.path"
                      class="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 cursor-default select-none"
                      :class="fileSelected.has(entry.path) ? 'bg-indigo-50/40 dark:bg-indigo-900/10' : ''"
                      :title="`双击打开 ${entry.name}`"
                      @dblclick="openEntry(entry)"
                    >
                      <td class="px-3 py-2">
                        <input
                          type="checkbox"
                          class="accent-indigo-500 align-middle"
                          :checked="fileSelected.has(entry.path)"
                          @dblclick.stop
                          @change.stop="toggleSelect(entry.path)"
                        />
                      </td>
                      <td class="px-3 py-2">
                        <div class="flex items-center gap-2 text-left min-w-0">
                          <span class="shrink-0">{{ entry.is_dir ? '📁' : entry.kind === 'image' ? '🖼️' : '📄' }}</span>
                          <span class="text-zinc-700 dark:text-zinc-200 truncate" :title="entry.name">{{ entry.name }}</span>
                        </div>
                      </td>
                      <td class="px-3 py-2 text-zinc-400 hidden sm:table-cell">{{ entry.is_dir ? '—' : fmtSize(entry.size) }}</td>
                      <td class="px-3 py-2 text-zinc-400 hidden md:table-cell whitespace-nowrap">{{ fmtTime(entry.modified) }}</td>
                      <td class="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          v-if="!entry.is_dir"
                          class="text-[11px] px-2 py-1 rounded-lg text-zinc-500 hover:text-indigo-600 dark:text-zinc-400"
                          @dblclick.stop
                          @click.stop="downloadFile(entry.path, entry.name)"
                        >下载</button>
                        <button
                          class="text-[11px] px-2 py-1 rounded-lg text-zinc-500 hover:text-indigo-600 dark:text-zinc-400"
                          @dblclick.stop
                          @click.stop="renameEntry(entry)"
                        >重命名</button>
                        <button
                          class="text-[11px] px-2 py-1 rounded-lg text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                          @dblclick.stop
                          @click.stop="deleteEntry(entry)"
                        >删除</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="mt-3 text-[11px] text-zinc-400">浏览的是服务器 <code class="font-mono">server/data</code> 目录。文本文件可在线查看与编辑（上限 1&nbsp;MB），图片可直接预览，其它文件可下载；勾选多项可批量删除。</p>
            </div>
          </div>

          <!-- ============ Database tab ============ -->
          <div v-show="tab === 'database'" class="flex-1 overflow-hidden flex min-h-0">
            <!-- Table list -->
            <div class="w-44 shrink-0 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto p-2">
              <div class="flex items-center justify-between px-1 py-1.5">
                <span class="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">数据表</span>
                <button
                  class="text-[11px] text-zinc-400 hover:text-indigo-600"
                  :disabled="dbTablesLoading"
                  @click="loadDbTables"
                >↻</button>
              </div>
              <button
                v-for="t in dbTables"
                :key="t.name"
                class="w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-1 transition-colors"
                :class="dbActiveTable === t.name
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'"
                @click="selectDbTable(t.name)"
              >
                <span class="truncate font-mono" :title="t.name">{{ t.name }}</span>
                <span class="text-[10px] text-zinc-400 shrink-0">{{ t.row_count < 0 ? '?' : t.row_count }}</span>
              </button>
              <div v-if="!dbTables.length && !dbTablesLoading" class="text-center text-zinc-400 py-6 text-xs">暂无数据表</div>
            </div>

            <!-- Rows -->
            <div class="flex-1 min-w-0 flex flex-col">
              <div v-if="!dbActiveTable" class="flex-1 flex items-center justify-center text-sm text-zinc-400">
                请选择左侧的数据表
              </div>
              <template v-else>
                <!-- Toolbar -->
                <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-sm font-semibold font-mono text-zinc-700 dark:text-zinc-200 truncate">{{ dbActiveTable }}</span>
                    <span class="text-[11px] text-zinc-400">共 {{ dbTotal }} 行</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      v-model="dbSearch"
                      type="text"
                      placeholder="搜索文本列…"
                      class="text-xs border border-zinc-200 rounded-lg px-2 py-1 bg-white text-zinc-600 w-32 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-300"
                      @keyup.enter="dbSearchSubmit"
                    />
                    <button class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400" @click="dbSearchSubmit">搜索</button>
                    <button
                      v-if="isOwner"
                      class="text-xs px-2 py-1 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                      @click="openDbInsert"
                    >＋ 新增</button>
                    <button class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400" :disabled="dbRowsLoading" @click="loadDbRows">{{ dbRowsLoading ? '…' : '↻' }}</button>
                  </div>
                </div>

                <!-- Row table -->
                <div class="flex-1 overflow-auto">
                  <table class="text-xs border-collapse">
                    <thead class="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400 sticky top-0 z-10">
                      <tr>
                        <th class="text-left px-3 py-2 font-medium whitespace-nowrap sticky left-0 bg-zinc-50 dark:bg-zinc-800/60">操作</th>
                        <th
                          v-for="c in dbColumns"
                          :key="c.name"
                          class="text-left px-3 py-2 font-medium whitespace-nowrap"
                          :title="c.type"
                        >
                          {{ c.name }}
                          <span v-if="c.primary_key" class="text-amber-500" title="主键">🔑</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="!dbRows.length && !dbRowsLoading">
                        <td :colspan="dbColumns.length + 1" class="px-3 py-8 text-center text-zinc-400">暂无数据</td>
                      </tr>
                      <tr
                        v-for="(row, i) in dbRows"
                        :key="i"
                        class="border-t border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                      >
                        <td class="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-white dark:bg-zinc-900">
                          <button class="text-[11px] px-1.5 py-1 rounded text-zinc-500 hover:text-indigo-600 dark:text-zinc-400" @click="openDbEdit(row)">{{ isOwner ? '编辑' : '查看' }}</button>
                          <button v-if="isOwner" class="text-[11px] px-1.5 py-1 rounded text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20" @click="deleteDbRow(row)">删除</button>
                        </td>
                        <td
                          v-for="c in dbColumns"
                          :key="c.name"
                          class="px-3 py-1.5 whitespace-nowrap max-w-[260px] truncate"
                          :class="row[c.name] === null ? 'text-zinc-300 italic dark:text-zinc-600' : 'text-zinc-700 dark:text-zinc-300'"
                          :title="dbValueToStr(row[c.name])"
                        >{{ row[c.name] === null ? 'NULL' : dbCellPreview(row[c.name]) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <!-- Pagination -->
                <div class="flex items-center justify-between px-4 py-2 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                  <span>{{ dbPageStart }}–{{ dbPageEnd }} / {{ dbTotal }}</span>
                  <div class="flex items-center gap-2">
                    <button class="px-2 py-1 rounded-lg border border-zinc-200 disabled:opacity-40 hover:border-indigo-200 dark:border-zinc-700" :disabled="dbOffset <= 0" @click="dbPrevPage">上一页</button>
                    <button class="px-2 py-1 rounded-lg border border-zinc-200 disabled:opacity-40 hover:border-indigo-200 dark:border-zinc-700" :disabled="dbOffset + DB_PAGE_SIZE >= dbTotal" @click="dbNextPage">下一页</button>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- ============ Audit tab ============ -->
          <div v-show="tab === 'audit'" class="flex-1 overflow-y-auto p-5">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-400">操作审计日志</h3>
              <button
                class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                :disabled="auditLoading"
                @click="loadAudit"
              >{{ auditLoading ? '刷新中…' : '↻ 刷新' }}</button>
            </div>
            <div class="border border-zinc-200 rounded-xl overflow-hidden dark:border-zinc-800">
              <table class="w-full text-xs">
                <thead class="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
                  <tr>
                    <th class="text-left px-3 py-2 font-medium">时间</th>
                    <th class="text-left px-3 py-2 font-medium">操作者</th>
                    <th class="text-left px-3 py-2 font-medium">动作</th>
                    <th class="text-left px-3 py-2 font-medium">详情</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="!auditEntries.length">
                    <td colspan="4" class="px-3 py-6 text-center text-zinc-400">暂无审计记录</td>
                  </tr>
                  <tr v-for="e in auditEntries" :key="e.id" class="border-t border-zinc-100 dark:border-zinc-800">
                    <td class="px-3 py-2 text-zinc-400 whitespace-nowrap">{{ fmtTime(e.created_at) }}</td>
                    <td class="px-3 py-2 text-zinc-600 dark:text-zinc-300 whitespace-nowrap">{{ e.actor_account || ('#' + e.actor_id) }}</td>
                    <td class="px-3 py-2">
                      <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-300 whitespace-nowrap">
                        {{ ACTION_LABELS[e.action] || e.action }}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                      {{ e.detail }}
                      <span v-if="e.target_label" class="text-zinc-400">（{{ e.target_label }}）</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- ============ DB row editor (overlay above the console) ============ -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="dbEditor"
        class="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center backdrop-blur-sm p-4"
        @click="closeDbEditor"
      >
        <div
          class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden dark:bg-zinc-900 dark:border dark:border-zinc-800"
          @click.stop
        >
          <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 class="text-sm font-bold text-zinc-800 dark:text-zinc-100">
              {{ dbEditor.mode === 'insert' ? '新增行' : (isOwner ? '编辑行' : '查看行') }} · <span class="font-mono">{{ dbActiveTable }}</span>
            </h3>
            <button class="w-7 h-7 rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center" @click="closeDbEditor">✕</button>
          </div>
          <div class="flex-1 overflow-y-auto p-5 space-y-3">
            <div v-for="c in dbColumns" :key="c.name">
              <label class="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                <span class="font-mono">{{ c.name }}</span>
                <span v-if="c.primary_key" class="text-amber-500" title="主键">🔑</span>
                <span class="text-[10px] text-zinc-400 font-normal">{{ c.py_type }}{{ c.nullable ? ' · 可空' : '' }}</span>
              </label>
              <textarea
                v-if="c.py_type === 'str'"
                v-model="dbEditor.values[c.name]"
                rows="1"
                spellcheck="false"
                :disabled="!isOwner || (dbEditor.mode === 'update' && c.primary_key)"
                class="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-zinc-50 disabled:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 dark:disabled:bg-zinc-800/50"
              ></textarea>
              <select
                v-else-if="c.py_type === 'bool'"
                v-model="dbEditor.values[c.name]"
                :disabled="!isOwner || (dbEditor.mode === 'update' && c.primary_key)"
                class="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-zinc-50 disabled:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
              >
                <option value="">（空）</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
              <input
                v-else
                v-model="dbEditor.values[c.name]"
                type="text"
                :placeholder="dbEditor.mode === 'insert' && c.primary_key ? '留空自动生成' : ''"
                :disabled="!isOwner || (dbEditor.mode === 'update' && c.primary_key)"
                class="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 bg-white text-zinc-700 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-zinc-50 disabled:text-zinc-400 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 dark:disabled:bg-zinc-800/50"
              />
            </div>
          </div>
          <div class="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800">
            <button class="text-xs px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400" @click="closeDbEditor">{{ isOwner ? '取消' : '关闭' }}</button>
            <button
              v-if="isOwner"
              class="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              :disabled="dbSaving"
              @click="saveDbRow"
            >{{ dbSaving ? '保存中…' : '保存' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
