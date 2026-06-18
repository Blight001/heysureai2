<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { formatDateTime } from '@/utils/datetime'
import { useMessage } from '@/composables/useMessage'
import * as adminApi from '@/api/admin'
import type {
  AdminTask, AdminUser, AuditEntry, DbCleanupCategory, DbCleanupResult, DbColumn, DbTableMeta, DbValue,
  DiagnosticGroup, ModelProbe, FileEntry, LogLine, ServiceInfo, RepoCommitInfo, RepoUpdateStatus,
} from '@/api/admin'
import { listMcpTools, callMcpTool } from '@/api/mcp'
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

type Tab = 'services' | 'users' | 'auth' | 'files' | 'database' | 'audit' | 'diagnostics' | 'update'
const tab = ref<Tab>('services')
const TAB_LABELS: Record<Tab, string> = {
  services: '服务监控',
  users: '用户管理',
  auth: '注册与邮箱',
  files: '文件管理',
  database: '数据库',
  audit: '操作审计',
  diagnostics: '系统测试',
  update: '版本更新',
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

// ---- Auth settings (registration mode + SMTP mailer) ----
const authLoaded = ref(false)
const authSettingsLoading = ref(false)
const authSettingsSaving = ref(false)
const authPasswordSet = ref(false)
const authEmailEnabled = ref(false)
const authForm = ref<{
  registration_mode: adminApi.RegistrationMode
  smtp_host: string
  smtp_port: number
  smtp_username: string
  smtp_password: string
  smtp_from: string
  smtp_encryption: adminApi.SmtpEncryption
}>({
  registration_mode: 'open',
  smtp_host: '',
  smtp_port: 465,
  smtp_username: '',
  smtp_password: '',
  smtp_from: '',
  smtp_encryption: 'ssl',
})
const testEmailTo = ref('')
const testEmailSending = ref(false)

const REGISTRATION_MODE_OPTIONS: { value: adminApi.RegistrationMode; label: string; desc: string }[] = [
  { value: 'open', label: '开放注册', desc: '账号 + 密码即可注册，无需邮箱' },
  { value: 'email', label: '邮箱验证注册', desc: '注册必须提供邮箱并通过验证码验证（需先配置 SMTP）' },
  { value: 'closed', label: '关闭注册', desc: '停止自助注册，仅管理员可在后台创建账号' },
]

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

// ---- Database cleanup (destructive maintenance, owner only) ----
// Each entry maps to a category key understood by the cleanup endpoint. All
// listed tables are per-user data; system tables are never touched.
const CLEANUP_CATEGORIES: { key: DbCleanupCategory; label: string; desc: string }[] = [
  { key: 'conversations', label: '对话记录', desc: '消息 / 会话 / 运行记录' },
  { key: 'tasks', label: '任务记录', desc: '任务作业 / 代理分发' },
  { key: 'ai_messages', label: 'AI 互发消息 + Token 用量', desc: 'aimessage · tokenusagesnapshot' },
  { key: 'knowledge', label: '知识库与记忆', desc: 'knowledgeentry · memory · evolutioninput' },
  { key: 'projects', label: '协作项目', desc: 'evolutionproject' },
]
const dbCleanupOpen = ref(false)
const dbCleanupBusy = ref(false)
const dbCleanupResult = ref<DbCleanupResult | null>(null)
const dbCleanupForm = ref<{
  account: string
  password: string
  categories: Record<DbCleanupCategory, boolean>
  dropUnusedTables: boolean
}>({
  account: '',
  password: '',
  categories: { conversations: true, tasks: true, ai_messages: false, knowledge: false, projects: false },
  dropUnusedTables: true,
})

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

const fmtTime = (ts: number | null | undefined): string => formatDateTime(ts, '—')

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
  db_cleanup: '清理数据库',
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

// ---- Database cleanup (destructive) ----
const openDbCleanup = () => {
  dbCleanupResult.value = null
  dbCleanupForm.value = {
    account: props.currentUser?.account || '',
    password: '',
    categories: { conversations: true, tasks: true, ai_messages: false, knowledge: false, projects: false },
    dropUnusedTables: true,
  }
  dbCleanupOpen.value = true
}

const closeDbCleanup = () => {
  if (dbCleanupBusy.value) return
  dbCleanupOpen.value = false
}

const dbCleanupSelectedCategories = computed(
  () => CLEANUP_CATEGORIES.filter(c => dbCleanupForm.value.categories[c.key]).map(c => c.key),
)

const dbCleanupHasSelection = computed(
  () => dbCleanupSelectedCategories.value.length > 0 || dbCleanupForm.value.dropUnusedTables,
)

const runDbCleanup = async () => {
  const f = dbCleanupForm.value
  if (!f.account.trim() || !f.password) {
    await alert({ message: '请输入房主账号和密码', type: 'warning' })
    return
  }
  if (!dbCleanupHasSelection.value) {
    await alert({ message: '请至少选择一项清理内容', type: 'warning' })
    return
  }
  const ok = await confirm({
    message: '此操作将永久清空所选类别的记录并删除无用数据表，且不可恢复。确认继续？',
    type: 'warning',
    confirmText: '确认清理',
  })
  if (!ok) return
  dbCleanupBusy.value = true
  try {
    const res = await adminApi.cleanupDatabase({
      account: f.account.trim(),
      password: f.password,
      categories: dbCleanupSelectedCategories.value,
      drop_unused_tables: f.dropUnusedTables,
    })
    dbCleanupResult.value = res
    dbCleanupForm.value.password = ''
    await Promise.all([loadDbTables(), dbActiveTable.value ? loadDbRows() : Promise.resolve()])
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    dbCleanupBusy.value = false
  }
}

// ---- Auth settings ----
const applyAuthSettings = (res: adminApi.AuthSettings) => {
  authForm.value = {
    registration_mode: res.registration_mode,
    smtp_host: res.smtp.host,
    smtp_port: res.smtp.port,
    smtp_username: res.smtp.username,
    smtp_password: '',
    smtp_from: res.smtp.from_addr,
    smtp_encryption: res.smtp.encryption,
  }
  authPasswordSet.value = res.smtp.password_set
  authEmailEnabled.value = res.email_enabled
}

const loadAuthSettings = async () => {
  authSettingsLoading.value = true
  try {
    applyAuthSettings(await adminApi.getAuthSettings())
    authLoaded.value = true
  } catch (e: any) {
    void alert(e?.message || '获取注册与邮箱设置失败')
  } finally {
    authSettingsLoading.value = false
  }
}

const saveAuthSettings = async () => {
  const f = authForm.value
  if (f.registration_mode === 'email' && !f.smtp_host.trim()) {
    void alert('邮箱验证注册模式需要先填写 SMTP 服务器')
    return
  }
  authSettingsSaving.value = true
  try {
    const res = await adminApi.updateAuthSettings({
      registration_mode: f.registration_mode,
      smtp_host: f.smtp_host.trim(),
      smtp_port: Number(f.smtp_port) || 465,
      smtp_username: f.smtp_username.trim(),
      // 留空 = 保留服务器上已存的密码
      smtp_password: f.smtp_password ? f.smtp_password : null,
      smtp_from: f.smtp_from.trim(),
      smtp_encryption: f.smtp_encryption,
    })
    applyAuthSettings(res)
    void alert(res.note || '设置已保存')
  } catch (e: any) {
    void alert(e?.message || '保存设置失败')
  } finally {
    authSettingsSaving.value = false
  }
}

const submitTestEmail = async () => {
  const to = testEmailTo.value.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    void alert('请输入有效的邮箱地址')
    return
  }
  testEmailSending.value = true
  try {
    await adminApi.sendTestEmail(to)
    void alert(`测试邮件已发送至 ${to}，请查收`)
  } catch (e: any) {
    void alert(e?.message || '发送测试邮件失败')
  } finally {
    testEmailSending.value = false
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

// ---- 系统测试 / 诊断 ----
const selfTestGroups = ref<DiagnosticGroup[]>([])
const selfTestSummary = ref<{ total: number; passed: number; failed: number } | null>(null)
const selfTestBusy = ref(false)
const selfTestLoaded = ref(false)

const runSelfTest = async () => {
  selfTestBusy.value = true
  try {
    const res = await adminApi.runSelfTest()
    selfTestGroups.value = res.groups || []
    selfTestSummary.value = res.summary || null
    selfTestLoaded.value = true
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    selfTestBusy.value = false
  }
}

const llmPrompt = ref('回复一个字：好')
const llmBusy = ref(false)
const modelResults = ref<ModelProbe[]>([])
const modelsTested = ref(false)

const runModelTest = async () => {
  llmBusy.value = true
  modelsTested.value = false
  try {
    const res = await adminApi.runModelTests({ prompt: llmPrompt.value })
    modelResults.value = res.models || []
    modelsTested.value = true
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    llmBusy.value = false
  }
}

const mcpTools = ref<any[]>([])
const mcpToolsLoaded = ref(false)
const selectedMcpTool = ref('')
const mcpArgsText = ref('{}')
const mcpBusy = ref(false)
const mcpResult = ref<{ ok: boolean; text: string } | null>(null)

const loadMcpToolNames = async () => {
  try {
    const res = await listMcpTools()
    mcpTools.value = (res.tools || [])
      .filter((t: any) => String(t?.name || '').trim())
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
    mcpToolsLoaded.value = true
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  }
}

interface McpParamRow { name: string; type: string; required: boolean; description: string }

const selectedToolInfo = computed(() => mcpTools.value.find((t: any) => t.name === selectedMcpTool.value) || null)

const selectedToolParams = computed<McpParamRow[]>(() => {
  const schema = selectedToolInfo.value?.inputSchema
  const props = schema && typeof schema === 'object' ? schema.properties : null
  if (!props || typeof props !== 'object') return []
  const required: string[] = Array.isArray(schema.required) ? schema.required : []
  return Object.entries(props).map(([name, cfg]: [string, any]) => {
    const rawType = cfg?.type
    const type = Array.isArray(rawType) ? rawType.join(' | ') : String(rawType || 'any')
    return {
      name,
      type,
      required: required.includes(name),
      description: String(cfg?.description || ''),
    }
  })
})

const sampleForType = (type: string): unknown => {
  if (type.includes('integer') || type.includes('number')) return 0
  if (type.includes('boolean')) return false
  if (type.includes('array')) return []
  if (type.includes('object')) return {}
  return ''
}

const fillMcpArgsTemplate = (requiredOnly = false) => {
  const rows = selectedToolParams.value
  const skeleton: Record<string, unknown> = {}
  for (const p of rows) {
    if (requiredOnly && !p.required) continue
    skeleton[p.name] = sampleForType(p.type)
  }
  mcpArgsText.value = JSON.stringify(skeleton, null, 2)
}

// 切换工具时，自动用「必填参数」骨架预填，省去手敲 JSON。
watch(selectedMcpTool, (name) => {
  mcpResult.value = null
  if (!name) {
    mcpArgsText.value = '{}'
    return
  }
  fillMcpArgsTemplate(true)
})

const runMcpTest = async () => {
  if (!selectedMcpTool.value) {
    await alert({ message: '请先选择一个 MCP 工具', type: 'warning' })
    return
  }
  let args: Record<string, unknown> = {}
  const raw = mcpArgsText.value.trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>
      } else {
        await alert({ message: '参数必须是 JSON 对象，例如 {"query":"天气"}', type: 'warning' })
        return
      }
    } catch {
      await alert({ message: '参数不是合法的 JSON', type: 'warning' })
      return
    }
  }
  mcpBusy.value = true
  mcpResult.value = null
  try {
    const res = await callMcpTool({ tool: selectedMcpTool.value, arguments: args })
    mcpResult.value = { ok: true, text: JSON.stringify(res, null, 2) }
  } catch (err) {
    mcpResult.value = { ok: false, text: (err as Error).message }
  } finally {
    mcpBusy.value = false
  }
}

const reseedBusy = ref(false)
const runReseedMcpDocs = async () => {
  const yes = await confirm({
    message: '将用系统内置（中文）说明覆盖重写当前用户的 MCP 工具说明文件，会覆盖对这些说明做过的手动修改。确定继续？',
    type: 'warning',
  })
  if (!yes) return
  reseedBusy.value = true
  try {
    const res = await adminApi.reseedMcpDocs()
    await alert({ message: res.detail || `已重新生成 ${res.regenerated} 个工具说明`, type: res.ok ? 'success' : 'warning' })
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    reseedBusy.value = false
  }
}

// ---- 版本 / 仓库自动更新 ----
const repoStatus = ref<RepoUpdateStatus | null>(null)
const repoLoading = ref(false)
const repoBusy = ref(false)
const repoSavingConfig = ref(false)
const repoUnreachable = ref(false)
const repoForm = ref<{ auto_enabled: boolean; interval_minutes: number }>({ auto_enabled: false, interval_minutes: 30 })
const repoCommitDetail = ref<RepoCommitInfo | null>(null)
let repoPollTimer: number | null = null

const REPO_PHASE_META: Record<string, { label: string; cls: string }> = {
  idle: { label: '空闲', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  checking: { label: '检测中', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  up_to_date: { label: '已是最新', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  update_available: { label: '发现新版本', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  pulling: { label: '拉取中', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  restarting: { label: '重启中', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  error: { label: '失败', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

const REPO_STEP_ICON: Record<string, string> = {
  pending: '○', active: '◔', done: '✓', error: '✕', skipped: '–',
}

const repoActive = computed(() => {
  const p = repoStatus.value?.state.phase
  return p === 'checking' || p === 'pulling' || p === 'restarting'
})

const repoDeployProgress = computed(() => {
  const state = repoStatus.value?.state
  if (!state) return { percent: 0, label: '等待开始' }
  if (state.phase === 'error') return { percent: 100, label: '更新失败' }
  if (state.phase === 'up_to_date' && state.logs?.length) return { percent: 100, label: '更新完成' }

  const output = (state.logs || []).join('\n').toLowerCase()
  if (/deploy finished|update complete|successfully built|启动完成/.test(output)) return { percent: 100, label: '更新完成' }
  if (/container .* (started|running|healthy)|creating|recreating|starting/.test(output)) return { percent: 88, label: '正在启动服务' }
  if (/docker compose|building|buildkit|exporting|writing image|naming to/.test(output)) return { percent: 58, label: '正在构建镜像' }
  if (/update found|git pull|reset --hard|fast-forward|updating [0-9a-f]/.test(output)) return { percent: 32, label: '正在拉取代码' }
  if (/checking updates|fetch_head|from https?:|git fetch/.test(output) || state.phase === 'checking') return { percent: 15, label: '正在检查版本' }
  if (state.phase === 'pulling') return { percent: 8, label: '正在启动更新脚本' }
  return { percent: 0, label: state.message || '等待开始' }
})

const fmtCommitTime = (ts: number | null | undefined) => formatDateTime(ts, '')

const loadRepoStatus = async (silent = false) => {
  if (!silent) repoLoading.value = true
  try {
    const res = await adminApi.getRepoUpdateStatus()
    repoStatus.value = res
    repoUnreachable.value = false
    // 后台轮询只更新版本与进度，不能覆盖用户尚未保存的表单输入。
    if (!silent) {
      repoForm.value = {
        auto_enabled: res.config.auto_enabled,
        interval_minutes: Math.max(1, Math.round(res.config.interval_seconds / 60)),
      }
    }
  } catch (err) {
    // 重启阶段网关不可达属预期：标记为「重启中」而非报错。
    if (repoStatus.value?.state.phase === 'restarting' || repoActive.value) {
      repoUnreachable.value = true
    } else if (!silent) {
      await alert({ message: (err as Error).message, type: 'error' })
    }
  } finally {
    if (!silent) repoLoading.value = false
  }
}

const startRepoPoll = () => {
  stopRepoPoll()
  repoPollTimer = window.setInterval(() => {
    // 进行中或刚不可达（重启窗口）时勤刷，其余按更慢的节奏。
    if (tab.value !== 'update') return
    void loadRepoStatus(true)
  }, 2500)
}

const stopRepoPoll = () => {
  if (repoPollTimer !== null) {
    clearInterval(repoPollTimer)
    repoPollTimer = null
  }
}

const saveRepoConfig = async () => {
  repoSavingConfig.value = true
  try {
    const res = await adminApi.updateRepoUpdateConfig({
      auto_enabled: repoForm.value.auto_enabled,
      interval_seconds: Math.max(1, Math.round(repoForm.value.interval_minutes)) * 60,
    })
    repoStatus.value = res
    repoForm.value = {
      auto_enabled: res.config.auto_enabled,
      interval_minutes: Math.max(1, Math.round(res.config.interval_seconds / 60)),
    }
    await alert({ message: '已保存自动更新设置', type: 'success' })
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    repoSavingConfig.value = false
  }
}

const triggerRepoCheck = async (apply: boolean) => {
  if (apply) {
    const yes = await confirm({
      message: repoStatus.value?.update_mode === 'webhook'
        ? '将通知服务器更新器立即执行宿主机更新脚本，服务可能短暂不可用。确定继续？'
        : '将检测远程是否有新版本；若发现更新会自动拉取最新代码并重启全部服务（重启期间控制台会短暂不可用）。确定继续？',
      type: 'warning',
    })
    if (!yes) return
  }
  repoBusy.value = true
  try {
    await adminApi.checkRepoUpdate(apply)
    // 立即拉一次状态，随后由轮询接管进度刷新。
    await loadRepoStatus(true)
  } catch (err) {
    await alert({ message: (err as Error).message, type: 'error' })
  } finally {
    repoBusy.value = false
  }
}

const switchTab = (next: Tab) => {
  tab.value = next
  if (next === 'users' && !users.value.length) void loadUsers()
  if (next === 'auth' && !authLoaded.value) void loadAuthSettings()
  if (next === 'files' && !fileEntries.value.length && editingFile.value === null) void loadFiles(filePath.value || DEFAULT_FILE_PATH)
  if (next === 'database' && !dbTables.value.length) void loadDbTables()
  if (next === 'audit') void loadAudit()
  if (next === 'diagnostics') {
    if (!selfTestLoaded.value) void runSelfTest()
    if (!mcpToolsLoaded.value) void loadMcpToolNames()
  }
  if (next === 'update') {
    void loadRepoStatus()
    startRepoPoll()
  } else {
    stopRepoPoll()
  }
}

watch(
  () => props.show,
  (open) => {
    if (!open) {
      stopAutoRefresh()
      stopRepoPoll()
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
  stopRepoPoll()
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
              v-for="t in (['services','users','auth','files','database','audit','diagnostics','update'] as Tab[])"
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
                  <div class="text-xs text-zinc-400 truncate">账号：{{ u.account }}<template v-if="u.email"> · 邮箱：{{ u.email }}</template> · 注册于 {{ fmtTime(u.created_at) }}</div>
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

          <!-- ============ Auth settings tab ============ -->
          <div v-show="tab === 'auth'" class="flex-1 overflow-y-auto p-5 space-y-6">
            <div class="flex items-center justify-between">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-400">注册与邮箱设置</h3>
              <div class="flex items-center gap-2">
                <span
                  class="text-[10px] px-2 py-0.5 rounded-full"
                  :class="authEmailEnabled
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'"
                >{{ authEmailEnabled ? '邮件服务可用' : '邮件服务未配置' }}</span>
                <button
                  class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                  :disabled="authSettingsLoading"
                  @click="loadAuthSettings"
                >{{ authSettingsLoading ? '刷新中…' : '↻ 刷新' }}</button>
              </div>
            </div>

            <div v-if="!isOwner" class="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-900/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
              仅房主可修改注册模式与邮箱配置，管理员可查看当前状态。
            </div>

            <!-- 注册模式 -->
            <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3">注册模式</h4>
              <div class="space-y-2">
                <label
                  v-for="opt in REGISTRATION_MODE_OPTIONS"
                  :key="opt.value"
                  class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                  :class="[
                    authForm.registration_mode === opt.value
                      ? 'border-indigo-300 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-900/15'
                      : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700',
                    !isOwner ? 'opacity-60 cursor-not-allowed' : '',
                  ]"
                >
                  <input
                    type="radio"
                    name="registration-mode"
                    class="mt-0.5 accent-indigo-600"
                    :value="opt.value"
                    v-model="authForm.registration_mode"
                    :disabled="!isOwner"
                  />
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-zinc-800 dark:text-zinc-100">{{ opt.label }}</div>
                    <div class="text-xs text-zinc-400 mt-0.5">{{ opt.desc }}</div>
                  </div>
                </label>
              </div>
              <p v-if="authForm.registration_mode === 'email' && !authEmailEnabled" class="mt-2 text-xs text-amber-600 dark:text-amber-400">
                ⚠ 当前邮件服务未配置：保存后新用户将无法收到验证码，请先完成下方 SMTP 配置。
              </p>
            </div>

            <!-- SMTP 配置 -->
            <div class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-1">邮箱（SMTP）配置</h4>
              <p class="text-xs text-zinc-400 mb-3">用于发送注册 / 登录验证码与系统邮件。配置保存在服务器数据库，亦可通过 HEYSURE_SMTP_* 环境变量提供默认值。</p>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">SMTP 服务器</label>
                  <input v-model="authForm.smtp_host" :disabled="!isOwner" type="text" placeholder="如 smtp.qq.com"
                    class="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 disabled:opacity-60" />
                </div>
                <div>
                  <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">端口</label>
                  <input v-model.number="authForm.smtp_port" :disabled="!isOwner" type="number" min="1" max="65535" placeholder="465"
                    class="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 disabled:opacity-60" />
                </div>
                <div>
                  <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">用户名</label>
                  <input v-model="authForm.smtp_username" :disabled="!isOwner" type="text" autocomplete="off" placeholder="通常为完整邮箱地址"
                    class="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 disabled:opacity-60" />
                </div>
                <div>
                  <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">密码 / 授权码</label>
                  <input v-model="authForm.smtp_password" :disabled="!isOwner" type="password" autocomplete="new-password"
                    :placeholder="authPasswordSet ? '已配置（留空保持不变）' : '请输入 SMTP 密码或授权码'"
                    class="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 disabled:opacity-60" />
                </div>
                <div>
                  <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">发件地址</label>
                  <input v-model="authForm.smtp_from" :disabled="!isOwner" type="text" placeholder="留空使用用户名"
                    class="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 disabled:opacity-60" />
                </div>
                <div>
                  <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">加密方式</label>
                  <select v-model="authForm.smtp_encryption" :disabled="!isOwner"
                    class="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-700 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200 disabled:opacity-60">
                    <option value="ssl">SSL（端口 465）</option>
                    <option value="starttls">STARTTLS（端口 587）</option>
                    <option value="none">不加密</option>
                  </select>
                </div>
              </div>
              <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <input v-model="testEmailTo" :disabled="!isOwner" type="email" placeholder="测试收件邮箱"
                    class="text-sm border border-zinc-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 disabled:opacity-60 w-52" />
                  <button
                    class="text-xs px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-300 disabled:opacity-50"
                    :disabled="!isOwner || testEmailSending"
                    title="先保存配置再测试"
                    @click="submitTestEmail"
                  >{{ testEmailSending ? '发送中…' : '发送测试邮件' }}</button>
                </div>
                <button
                  class="text-xs px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  :disabled="!isOwner || authSettingsSaving"
                  @click="saveAuthSettings"
                >{{ authSettingsSaving ? '保存中…' : '保存设置' }}</button>
              </div>
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
            <div class="w-44 shrink-0 border-r border-zinc-200 dark:border-zinc-800 flex flex-col min-h-0">
              <div class="flex-1 overflow-y-auto p-2">
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
              <!-- Destructive cleanup entry — owner only -->
              <div v-if="isOwner" class="shrink-0 p-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  class="w-full text-xs px-2 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20 flex items-center justify-center gap-1"
                  @click="openDbCleanup"
                >🧹 清理数据库</button>
              </div>
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

          <!-- ============ Diagnostics tab ============ -->
          <div v-show="tab === 'diagnostics'" class="flex-1 overflow-y-auto p-5 space-y-5">
            <!-- 一键自检 -->
            <section class="border border-zinc-200 rounded-xl p-4 dark:border-zinc-800">
              <div class="flex items-center justify-between mb-3">
                <div>
                  <div class="text-sm font-bold text-zinc-700 dark:text-zinc-200 flex items-center gap-2">
                    一键自检
                    <span v-if="selfTestSummary" class="text-xs font-normal" :class="selfTestSummary.failed ? 'text-red-500' : 'text-emerald-600'">
                      {{ selfTestSummary.passed }}/{{ selfTestSummary.total }} 通过<span v-if="selfTestSummary.failed">，{{ selfTestSummary.failed }} 项异常</span>
                    </span>
                  </div>
                  <div class="text-xs text-zinc-400 mt-0.5">逐项检查进程、数据库、MCP 与文件存储。</div>
                </div>
                <button
                  class="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                  :disabled="selfTestBusy"
                  @click="runSelfTest"
                >{{ selfTestBusy ? '检查中…' : '重新自检' }}</button>
              </div>
              <div v-if="!selfTestGroups.length && !selfTestBusy" class="text-xs text-zinc-400">尚未运行自检。</div>
              <div class="space-y-3">
                <div v-for="g in selfTestGroups" :key="g.module">
                  <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1">{{ g.label }}</div>
                  <ul class="space-y-1.5">
                    <li
                      v-for="c in g.checks"
                      :key="c.id"
                      class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50"
                    >
                      <span class="flex items-center gap-2 min-w-0">
                        <span
                          class="w-2 h-2 rounded-full shrink-0"
                          :class="c.skipped ? 'bg-zinc-300 dark:bg-zinc-600' : (c.ok ? 'bg-emerald-500' : 'bg-red-500')"
                        ></span>
                        <span class="text-sm text-zinc-700 dark:text-zinc-200 shrink-0">{{ c.label }}</span>
                        <span class="text-xs truncate" :class="c.skipped ? 'text-zinc-400' : (c.ok ? 'text-zinc-400' : 'text-red-500')">
                          {{ c.skipped ? '已跳过' : '' }}{{ c.detail }}
                        </span>
                      </span>
                      <span v-if="c.latency_ms != null && !c.skipped" class="text-xs text-zinc-400 whitespace-nowrap">{{ c.latency_ms }} ms</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            <!-- 模型连通性（逐个测试已配置模型） -->
            <section class="border border-zinc-200 rounded-xl p-4 dark:border-zinc-800">
              <div class="text-sm font-bold text-zinc-700 dark:text-zinc-200 mb-1">模型（LLM）连通性</div>
              <div class="text-xs text-zinc-400 mb-3">对主脑模型与每个已配置的模型 Preset 各发一次极小补全请求，逐个确认可用。</div>
              <div class="flex gap-2">
                <input
                  v-model="llmPrompt"
                  class="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm dark:bg-zinc-800 dark:border-zinc-700"
                  placeholder="测试提示词"
                />
                <button
                  class="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                  :disabled="llmBusy"
                  @click="runModelTest"
                >{{ llmBusy ? '测试中…' : '测试全部模型' }}</button>
              </div>
              <div v-if="modelsTested && !modelResults.length" class="mt-3 text-xs text-zinc-400">未发现已配置的模型。</div>
              <ul class="mt-3 space-y-2">
                <li
                  v-for="(m, i) in modelResults"
                  :key="m.model + '_' + i"
                  class="text-xs rounded-lg p-3"
                  :class="m.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'"
                >
                  <div class="font-medium flex items-center justify-between gap-2">
                    <span>{{ m.name }}<span v-if="m.model && m.model !== m.name" class="text-zinc-400"> · {{ m.model }}</span></span>
                    <span class="whitespace-nowrap">{{ m.ok ? '连通' : '失败' }}<span v-if="m.latency_ms != null"> · {{ m.latency_ms }} ms</span></span>
                  </div>
                  <div v-if="m.reply" class="mt-1 text-zinc-600 dark:text-zinc-300">回复：{{ m.reply }}</div>
                  <div v-if="m.detail && !m.ok" class="mt-1 whitespace-pre-wrap">{{ m.detail }}</div>
                </li>
              </ul>
            </section>

            <!-- MCP 工具测试 -->
            <section class="border border-zinc-200 rounded-xl p-4 dark:border-zinc-800">
              <div class="flex items-center justify-between gap-2 mb-1">
                <div class="text-sm font-bold text-zinc-700 dark:text-zinc-200">MCP 工具测试</div>
                <button
                  class="px-2.5 py-1 text-xs rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 whitespace-nowrap"
                  :disabled="reseedBusy"
                  title="用系统内置中文说明覆盖重写本用户的 MCP 工具说明文件"
                  @click="runReseedMcpDocs"
                >{{ reseedBusy ? '生成中…' : '重新生成中文说明' }}</button>
              </div>
              <div class="text-xs text-zinc-400 mb-3">选择一个工具、填入 JSON 参数并执行，直接查看返回结果（使用与 AI 相同的执行通道）。</div>
              <div class="flex flex-col gap-2 sm:flex-row">
                <select
                  v-model="selectedMcpTool"
                  class="sm:w-64 border border-zinc-200 rounded-lg px-3 py-2 text-sm dark:bg-zinc-800 dark:border-zinc-700"
                >
                  <option value="">选择工具…</option>
                  <option v-for="t in mcpTools" :key="t.name" :value="t.name">{{ t.name }}</option>
                </select>
                <button
                  class="px-3 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                  :disabled="mcpBusy"
                  @click="runMcpTest"
                >{{ mcpBusy ? '执行中…' : '执行工具' }}</button>
              </div>

              <!-- 选中工具的说明与参数表 -->
              <div v-if="selectedToolInfo" class="mt-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 p-3">
                <div v-if="selectedToolInfo.description" class="text-xs text-zinc-600 dark:text-zinc-300 mb-2">{{ selectedToolInfo.description }}</div>
                <div v-if="selectedToolParams.length" class="space-y-1">
                  <div class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">参数</div>
                  <div
                    v-for="p in selectedToolParams"
                    :key="p.name"
                    class="text-xs flex flex-wrap items-baseline gap-x-2"
                  >
                    <code class="text-indigo-600 dark:text-indigo-300">{{ p.name }}</code>
                    <span class="text-zinc-400">{{ p.type }}</span>
                    <span v-if="p.required" class="text-red-500">必填</span>
                    <span v-else class="text-zinc-400">可选</span>
                    <span class="text-zinc-500 dark:text-zinc-400 w-full sm:w-auto">{{ p.description }}</span>
                  </div>
                </div>
                <div v-else class="text-xs text-zinc-400">该工具无参数，可直接执行。</div>
                <div v-if="selectedToolParams.length" class="mt-2 flex gap-2">
                  <button class="px-2 py-1 text-[11px] rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700" @click="fillMcpArgsTemplate(true)">填必填模板</button>
                  <button class="px-2 py-1 text-[11px] rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700" @click="fillMcpArgsTemplate(false)">填全部参数</button>
                </div>
              </div>

              <textarea
                v-model="mcpArgsText"
                rows="4"
                class="mt-2 w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono dark:bg-zinc-800 dark:border-zinc-700"
                placeholder='{"query": "示例参数"}'
              ></textarea>
              <pre
                v-if="mcpResult"
                class="mt-2 text-xs rounded-lg p-3 overflow-x-auto max-h-72 whitespace-pre-wrap"
                :class="mcpResult.ok ? 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'"
              >{{ mcpResult.text }}</pre>
            </section>
          </div>

          <!-- ============ Repo auto-update / 版本更新 tab ============ -->
          <div v-show="tab === 'update'" class="flex-1 overflow-y-auto p-5 space-y-5">
            <div class="flex items-center justify-between">
              <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-400">版本与自动更新</h3>
              <button
                class="text-xs px-2 py-1 rounded-lg border border-zinc-200 text-zinc-500 hover:text-indigo-600 hover:border-indigo-200 dark:border-zinc-700 dark:text-zinc-400"
                :disabled="repoLoading"
                @click="loadRepoStatus()"
              >{{ repoLoading ? '刷新中…' : '↻ 刷新' }}</button>
            </div>

            <div
              v-if="repoStatus && repoStatus.update_mode === 'unavailable'"
              class="rounded-xl border border-amber-200 bg-amber-50/60 dark:border-amber-700/40 dark:bg-amber-900/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300"
            >
              当前部署没有 Git 工作区，也未配置服务器更新 Webhook。请为网关设置 <code>HEYSURE_REPO_UPDATE_WEBHOOK_URL</code>，即可从本页控制宿主机更新脚本。
            </div>

            <div
              v-if="repoStatus && repoStatus.update_mode === 'webhook'"
              class="rounded-xl border border-indigo-200 bg-indigo-50/60 dark:border-indigo-700/40 dark:bg-indigo-900/10 px-4 py-3 text-xs text-indigo-700 dark:text-indigo-300"
            >
              已连接服务器更新器。本页会先通过宿主机 Git 检查版本，仅在发现新提交时调用更新脚本并重新部署服务。
            </div>

            <template v-if="repoStatus">
              <!-- 当前版本 -->
              <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100 mb-3">当前版本</h4>
                <div class="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                  <div class="flex items-center gap-2">
                    <span class="text-zinc-400 w-16 shrink-0">分支</span>
                    <span class="font-mono">{{ repoStatus.version.branch || '（未知）' }}</span>
                  </div>
                  <div v-if="repoStatus.version.current" class="flex items-start gap-2">
                    <span class="text-zinc-400 w-16 shrink-0">提交</span>
                    <span class="min-w-0">
                      <span class="font-mono text-indigo-600 dark:text-indigo-400">{{ repoStatus.version.current.short }}</span>
                      <span class="text-zinc-500 dark:text-zinc-400"> · {{ repoStatus.version.current.subject }}</span>
                      <span class="block text-zinc-400 mt-0.5">{{ repoStatus.version.current.author }} · {{ fmtCommitTime(repoStatus.version.current.committed_at) }}</span>
                      <button
                        class="mt-1 text-[11px] text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                        @click="repoCommitDetail = repoStatus.version.current"
                      >查看详情</button>
                    </span>
                  </div>
                  <div v-if="repoStatus.last_update.at" class="flex items-center gap-2 pt-1">
                    <span class="text-zinc-400 w-16 shrink-0">上次更新</span>
                    <span>{{ fmtCommitTime(repoStatus.last_update.at) }}
                      <span v-if="repoStatus.last_update.commit" class="font-mono text-zinc-400"> → {{ repoStatus.last_update.commit.slice(0, 7) }}</span>
                    </span>
                  </div>
                </div>
              </section>

              <!-- 自动检测设置 -->
              <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
                <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">自动检测设置</h4>
                <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200 cursor-pointer select-none">
                  <input type="checkbox" v-model="repoForm.auto_enabled" class="accent-indigo-600" :disabled="!repoStatus.updater_available" />
                  开启定时自动检测（检测到新版本将自动更新）
                </label>
                <div class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                  <span class="text-zinc-500 dark:text-zinc-400">检测间隔</span>
                  <input
                    v-model.number="repoForm.interval_minutes"
                    type="number"
                    :min="Math.max(1, Math.round(repoStatus.limits.min_interval / 60))"
                    :max="Math.round(repoStatus.limits.max_interval / 60)"
                    :disabled="!repoStatus.updater_available"
                    class="w-24 text-sm border border-zinc-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100 disabled:opacity-60"
                  />
                  <span class="text-zinc-500 dark:text-zinc-400">分钟</span>
                  <span class="text-[11px] text-zinc-400">（{{ Math.max(1, Math.round(repoStatus.limits.min_interval / 60)) }}–{{ Math.round(repoStatus.limits.max_interval / 60) }} 分钟）</span>
                </div>
                <div class="flex justify-end">
                  <button
                    class="text-xs px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    :disabled="repoSavingConfig || !repoStatus.updater_available"
                    @click="saveRepoConfig"
                  >{{ repoSavingConfig ? '保存中…' : '保存设置' }}</button>
                </div>
              </section>

              <!-- 手动检测 + 进度 -->
              <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-4">
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2">
                    <h4 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">检测与更新进度</h4>
                    <span
                      class="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      :class="(REPO_PHASE_META[repoUnreachable ? 'restarting' : repoStatus.state.phase] || REPO_PHASE_META.idle).cls"
                    >{{ (REPO_PHASE_META[repoUnreachable ? 'restarting' : repoStatus.state.phase] || { label: repoStatus.state.phase }).label }}</span>
                  </div>
                  <button
                    class="text-xs px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    :disabled="repoBusy || repoActive || !repoStatus.updater_available"
                    @click="triggerRepoCheck(true)"
                  >{{ repoBusy || repoActive ? '执行中…' : (repoStatus.update_mode === 'webhook' ? '立即更新服务器' : '立即检测并更新') }}</button>
                </div>

                <!-- 阶段步骤 -->
                <div class="flex flex-col gap-2">
                  <div
                    v-for="step in repoStatus.state.steps"
                    :key="step.key"
                    class="flex items-center gap-2.5 text-sm"
                  >
                    <span
                      class="w-5 h-5 inline-flex items-center justify-center rounded-full text-[11px] font-bold shrink-0"
                      :class="{
                        'bg-zinc-100 text-zinc-400 dark:bg-zinc-800': step.status === 'pending' || step.status === 'skipped',
                        'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300 animate-pulse': step.status === 'active',
                        'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300': step.status === 'done',
                        'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300': step.status === 'error',
                      }"
                    >{{ REPO_STEP_ICON[step.status] || '○' }}</span>
                    <span
                      :class="step.status === 'pending' || step.status === 'skipped'
                        ? 'text-zinc-400'
                        : 'text-zinc-700 dark:text-zinc-200'"
                    >{{ step.label }}</span>
                    <span v-if="step.status === 'skipped'" class="text-[11px] text-zinc-400">（跳过）</span>
                  </div>
                </div>

                <!-- 信息提示 -->
                <p v-if="repoUnreachable" class="text-xs text-purple-600 dark:text-purple-400">
                  服务正在重启，控制台暂时不可用，请稍候…恢复后将显示最新版本。
                </p>
                <p v-else-if="repoStatus.state.behind > 0 && repoStatus.state.phase === 'update_available'" class="text-xs text-amber-600 dark:text-amber-400">
                  发现 {{ repoStatus.state.behind }} 个新提交待应用。
                </p>
                <p v-else-if="repoStatus.state.message" class="text-xs text-zinc-500 dark:text-zinc-400">
                  {{ repoStatus.state.message }}
                  <span v-if="repoStatus.state.last_check_at"> · 上次检测 {{ fmtCommitTime(repoStatus.state.last_check_at) }}</span>
                </p>
                <p v-if="repoStatus.state.phase === 'error' && repoStatus.state.last_error" class="text-xs text-red-600 dark:text-red-400 break-all">
                  ✕ {{ repoStatus.state.last_error }}
                </p>
                <div v-if="repoStatus.update_mode === 'webhook' && (repoActive || repoStatus.state.logs?.length)" class="space-y-2">
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-medium text-zinc-600 dark:text-zinc-300">{{ repoDeployProgress.label }}</span>
                    <span class="font-mono text-zinc-400">{{ repoDeployProgress.percent }}%</span>
                  </div>
                  <div class="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      class="h-full rounded-full transition-all duration-500"
                      :class="repoStatus.state.phase === 'error' ? 'bg-red-500' : 'bg-indigo-500'"
                      :style="{ width: `${repoDeployProgress.percent}%` }"
                    ></div>
                  </div>
                  <details v-if="repoStatus.state.logs?.length" class="text-[11px] text-zinc-400">
                    <summary class="cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-300">查看原始日志</summary>
                    <pre class="mt-2 max-h-64 overflow-auto rounded-lg bg-zinc-950 p-3 leading-5 text-zinc-200 whitespace-pre-wrap break-all">{{ repoStatus.state.logs.join('\n') }}</pre>
                  </details>
                </div>
              </section>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="repoCommitDetail"
        class="fixed inset-0 z-[90] bg-black/50 flex items-center justify-center backdrop-blur-sm p-4"
        @click="repoCommitDetail = null"
      >
        <div
          class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden dark:bg-zinc-900 dark:border dark:border-zinc-800"
          @click.stop
        >
          <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 class="text-sm font-bold text-zinc-800 dark:text-zinc-100">提交详情</h3>
            <button class="w-7 h-7 rounded-full text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" @click="repoCommitDetail = null">✕</button>
          </div>
          <div class="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
            <div>
              <div class="font-semibold text-zinc-800 dark:text-zinc-100">{{ repoCommitDetail.subject }}</div>
              <div class="mt-1 text-xs text-zinc-400">{{ repoCommitDetail.author }} · {{ fmtCommitTime(repoCommitDetail.committed_at) }}</div>
              <code class="mt-2 block text-xs text-indigo-600 dark:text-indigo-400 break-all">{{ repoCommitDetail.sha }}</code>
            </div>
            <pre v-if="repoCommitDetail.body && repoCommitDetail.body !== repoCommitDetail.subject" class="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-3 text-xs text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">{{ repoCommitDetail.body }}</pre>
            <div>
              <div class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">变更文件（{{ repoCommitDetail.files?.length || 0 }}）</div>
              <div v-if="repoCommitDetail.files?.length" class="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
                <div v-for="file in repoCommitDetail.files" :key="file.path" class="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <code class="text-zinc-700 dark:text-zinc-200 break-all">{{ file.path }}</code>
                  <span class="shrink-0 font-mono">
                    <span class="text-emerald-600">+{{ file.added ?? 'bin' }}</span>
                    <span class="ml-2 text-red-500">-{{ file.deleted ?? 'bin' }}</span>
                  </span>
                </div>
              </div>
              <div v-else class="text-xs text-zinc-400">当前版本来源尚未提供文件变更详情，更新 Webhook 后即可显示。</div>
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

  <!-- ============ Database cleanup confirmation (owner only) ============ -->
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="dbCleanupOpen"
        class="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center backdrop-blur-sm p-4"
        @click="closeDbCleanup"
      >
        <div
          class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden dark:bg-zinc-900 dark:border dark:border-zinc-800"
          @click.stop
        >
          <div class="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
            <h3 class="text-sm font-bold text-red-600 dark:text-red-400 flex items-center gap-1.5">🧹 清理数据库</h3>
            <button class="w-7 h-7 rounded-full text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center" @click="closeDbCleanup">✕</button>
          </div>
          <div class="flex-1 overflow-y-auto p-5 space-y-4">
            <div class="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 text-xs text-red-700 leading-relaxed dark:bg-red-900/15 dark:border-red-900/40 dark:text-red-300">
              ⚠️ 高风险操作：将永久清空所选记录并删除数据库中已无任何模型引用的无用数据表，<b>不可恢复</b>。请先确认已做好备份。
            </div>

            <!-- Cleanup scope -->
            <div class="space-y-2">
              <span class="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">清空所有用户的记录</span>
              <label
                v-for="cat in CLEANUP_CATEGORIES"
                :key="cat.key"
                class="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-200 cursor-pointer"
              >
                <input v-model="dbCleanupForm.categories[cat.key]" type="checkbox" class="mt-0.5 accent-red-600" />
                <span><b>{{ cat.label }}</b><span class="text-zinc-400 font-mono"> · {{ cat.desc }}</span></span>
              </label>
            </div>

            <!-- Unused tables -->
            <div class="space-y-2 pt-1">
              <span class="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">数据表维护</span>
              <label class="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-200 cursor-pointer">
                <input v-model="dbCleanupForm.dropUnusedTables" type="checkbox" class="mt-0.5 accent-red-600" />
                <span>删除<b>无用数据表</b>（不再被任何模型映射的遗留表）</span>
              </label>
            </div>

            <!-- Owner re-auth -->
            <div class="space-y-2 pt-1">
              <span class="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">房主身份确认</span>
              <input
                v-model="dbCleanupForm.account"
                type="text"
                autocomplete="off"
                placeholder="房主账号"
                class="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 bg-white text-zinc-700 focus:outline-none focus:ring-2 focus:ring-red-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
              />
              <input
                v-model="dbCleanupForm.password"
                type="password"
                autocomplete="new-password"
                placeholder="房主密码"
                class="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-2 bg-white text-zinc-700 focus:outline-none focus:ring-2 focus:ring-red-200 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
                @keyup.enter="runDbCleanup"
              />
            </div>

            <!-- Result -->
            <div
              v-if="dbCleanupResult"
              class="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-xs text-emerald-700 leading-relaxed dark:bg-emerald-900/15 dark:border-emerald-900/40 dark:text-emerald-300"
            >
              ✅ 清理完成：共删除 {{ dbCleanupResult.total_deleted }} 条记录。
              <div v-if="Object.keys(dbCleanupResult.cleared).length" class="mt-1 font-mono text-[11px]">
                <div v-for="(n, name) in dbCleanupResult.cleared" :key="name">{{ name }}：{{ n }} 行</div>
              </div>
              <div v-if="dbCleanupResult.dropped_tables.length" class="mt-1">
                已删除无用表：<span class="font-mono">{{ dbCleanupResult.dropped_tables.join('、') }}</span>
              </div>
              <div v-else-if="dbCleanupForm.dropUnusedTables" class="mt-1 text-emerald-600/80">未发现无用数据表。</div>
            </div>
          </div>
          <div class="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-800">
            <button class="text-xs px-3 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-700 dark:text-zinc-400" :disabled="dbCleanupBusy" @click="closeDbCleanup">关闭</button>
            <button
              class="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              :disabled="dbCleanupBusy || !dbCleanupHasSelection"
              @click="runDbCleanup"
            >{{ dbCleanupBusy ? '清理中…' : '确认清理' }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
