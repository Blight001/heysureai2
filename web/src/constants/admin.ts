import type { DbCleanupCategory, RegistrationMode } from '@/api/admin'
import type { AdminModalTab, AdminRoleOption, AdminStatusMeta } from '@/types/admin'

export const ADMIN_TAB_ORDER: AdminModalTab[] = [
  'services',
  'users',
  'auth',
  'files',
  'database',
  'audit',
  'diagnostics',
  'update',
]

export const ADMIN_TAB_LABELS: Record<AdminModalTab, string> = {
  services: '服务监控',
  users: '用户管理',
  auth: '注册与邮箱',
  files: '文件管理',
  database: '数据库',
  audit: '操作审计',
  diagnostics: '系统测试',
  update: '版本更新',
}

export const ADMIN_LOG_LEVELS = ['', 'DEBUG', 'INFO', 'WARNING', 'ERROR'] as const
export const ADMIN_REFRESH_INTERVAL_MS = 5000
export const ADMIN_DEFAULT_FILE_PATH = 'workspace'
export const ADMIN_DB_PAGE_SIZE = 50

export const ADMIN_REGISTRATION_MODE_OPTIONS: Array<{ value: RegistrationMode; label: string; desc: string }> = [
  { value: 'open', label: '开放注册', desc: '账号 + 密码即可注册，无需邮箱' },
  { value: 'email', label: '邮箱验证注册', desc: '注册必须提供邮箱并通过验证码验证（需先配置 SMTP）' },
  { value: 'closed', label: '关闭注册', desc: '停止自助注册，仅管理员可在后台创建账号' },
]

export const ADMIN_CLEANUP_CATEGORIES: Array<{ key: DbCleanupCategory; label: string; desc: string }> = [
  { key: 'conversations', label: '对话记录', desc: '消息 / 会话 / 运行记录' },
  { key: 'tasks', label: '任务记录', desc: '任务作业 / 代理分发' },
  { key: 'ai_messages', label: 'AI 互发消息 + Token 用量', desc: 'aimessage · tokenusagesnapshot' },
  { key: 'knowledge', label: '知识库与记忆', desc: 'knowledgeentry · memory（旧的 evolutioninput / knowledgeembedding 表会自动被删除）' },
  { key: 'projects', label: '协作项目', desc: 'evolutionproject' },
]

export const ADMIN_STATUS_META: Record<string, AdminStatusMeta> = {
  running: { label: '运行中', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  degraded: { label: '降级', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  down: { label: '离线', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  local: { label: '单体内置', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
}

export const ADMIN_TASK_STATUS_CLS: Record<string, string> = {
  running: 'text-indigo-600 dark:text-indigo-300',
  queued: 'text-amber-600 dark:text-amber-300',
  completed: 'text-emerald-600 dark:text-emerald-300',
  error: 'text-red-600 dark:text-red-300',
  stopped: 'text-zinc-500 dark:text-zinc-400',
}

export const ADMIN_ROLE_OPTIONS: AdminRoleOption[] = [
  { value: 'owner', label: '房主' },
  { value: 'admin', label: '管理员' },
  { value: 'member', label: '成员' },
]

export const ADMIN_ACTION_LABELS: Record<string, string> = {
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

export const ADMIN_REPO_PHASE_META: Record<string, AdminStatusMeta> = {
  idle: { label: '空闲', cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  checking: { label: '检测中', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  up_to_date: { label: '已是最新', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  update_available: { label: '发现新版本', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  pulling: { label: '拉取中', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  restarting: { label: '重启中', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  error: { label: '失败', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

export const ADMIN_REPO_STEP_ICON: Record<string, string> = {
  pending: '○',
  active: '◔',
  done: '✓',
  error: '✕',
  skipped: '–',
}
