import { ref, watch, type Ref } from 'vue'
import { normalizeSystemAutoControl as normalizeTaskSystemAutoControl } from '../../utils/taskSystem'
import type { McpRoleMeta, User } from './types'

type ThemeMode = 'light' | 'dark'
type FontSize = 'sm' | 'md' | 'lg'
type MessageType = 'info' | 'success' | 'warning' | 'error'
type AlertFn = (options: string | { message: string; type?: MessageType }) => Promise<void>

interface UseDashboardSystemSettingsOptions {
  getCurrentUser: () => User | null | undefined
  alert: AlertFn
  onRefreshUser: (user: User) => void
  mcpRoleMeta: Ref<McpRoleMeta>
}

const clampIdleSeconds = (value: unknown) => {
  const parsed = Number(value ?? 25)
  if (!Number.isFinite(parsed)) return 25
  return Math.max(5, Math.min(3600, Math.floor(parsed)))
}

const clampMcpMaxSteps = (value: unknown) => {
  const parsed = Number(value ?? 48)
  if (!Number.isFinite(parsed)) return 48
  return Math.max(1, Math.min(999, Math.floor(parsed)))
}

export const useDashboardSystemSettings = (options: UseDashboardSystemSettingsOptions) => {
  const themeMode = ref<ThemeMode>('dark')
  const fontSize = ref<FontSize>('md')
  const mcpMaxSteps = ref(48)
  const globalMcpCallMethod = ref(`When you want to call a tool, output one or more blocks using EXACTLY this format and do not wrap them in markdown code fences:
<mcp-call>
{"tool":"workspace.read_files","arguments":{"paths":["README.md"]}}
</mcp-call>

Available MCP tools include:
{MCP}

Rules:
- Explain your intent in normal text first when helpful, then emit the MCP call block.
- For workspace.write_file and workspace.edit_file, prefer structured arguments: target + content/edits + options.
- Use workspace.edit_file for targeted edits to existing files.
- Use workspace.write_file for new files or full rewrites.
- Use admin.* tools when managing connected agents.
- Call exactly one tool per <mcp-call> block; never join two tool names into one name.
- Only fall back to legacy File/Create File/Delete File/Run Command formats if MCP is unavailable.`)
  const globalMcpFormatErrorHint = ref(`[系统提示] 检测到你正在尝试调用 MCP，但调用格式未通过校验，因此本次没有执行任何工具。

请改用以下标准格式（任选其一）：
1) JSON 方式（推荐）
<mcp-call>
{"tool":"workspace.read_files","arguments":{"paths":["README.md"]}}
</mcp-call>

2) XML-like 方式
<mcp-call>
<tool>workspace.read_files</tool>
<arguments>{"paths":["README.md"]}</arguments>
</mcp-call>

注意：
- <arguments> 标签内必须是 JSON 对象字符串。
- 不要写成 <arguments><paths>...</paths></arguments> 这种嵌套标签格式。
- 一次只调用一个工具，等待 MCP 返回后再继续。
{details}`)
  // Per-role MCP allow-list working copy: { roleTier: [toolName, ...] }.
  const roleMcpPermissions = ref<Record<string, string[]>>({})
  let roleMcpPermissionsInitialized = false

  const parseSavedRolePermissions = (raw: unknown): Record<string, string[]> => {
    if (typeof raw !== 'string' || !raw.trim()) return {}
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return {}
      const out: Record<string, string[]> = {}
      for (const [role, tools] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(tools)) {
          out[role] = tools.map(item => String(item || '').trim()).filter(Boolean)
        }
      }
      return out
    } catch {
      return {}
    }
  }

  // Initialise the editable copy from the saved user policy (falling back to the
  // per-role default ceiling) once the role metadata is available.
  const initRoleMcpPermissions = (force = false) => {
    const meta = options.mcpRoleMeta.value
    const roles = meta.order || []
    if (roles.length === 0) return
    if (roleMcpPermissionsInitialized && !force) return
    const saved = parseSavedRolePermissions(options.getCurrentUser()?.role_mcp_permissions)
    const next: Record<string, string[]> = {}
    for (const role of roles) {
      const options = meta.options?.[role] || meta.defaults?.[role] || []
      const optionSet = new Set(options)
      const defaults = meta.defaults?.[role] || []
      const savedForRole = saved[role]
      next[role] = Array.isArray(savedForRole)
        ? savedForRole.filter(tool => optionSet.has(tool))
        : [...defaults]
    }
    roleMcpPermissions.value = next
    roleMcpPermissionsInitialized = true
  }

  const isRoleToolAllowed = (role: string, tool: string) =>
    (roleMcpPermissions.value[role] || []).includes(tool)

  const toggleRoleTool = (role: string, tool: string, checked: boolean) => {
    const current = new Set(roleMcpPermissions.value[role] || [])
    if (checked) current.add(tool)
    else current.delete(tool)
    roleMcpPermissions.value = { ...roleMcpPermissions.value, [role]: Array.from(current) }
  }

  const setRoleAllTools = (role: string, checked: boolean) => {
    const roleOptions = options.mcpRoleMeta.value.options?.[role] || options.mcpRoleMeta.value.defaults?.[role] || []
    roleMcpPermissions.value = { ...roleMcpPermissions.value, [role]: checked ? [...roleOptions] : [] }
  }

  const resetRoleMcpPermissions = () => {
    initRoleMcpPermissions(true)
  }

  const defaultStartTaskPrompt = ref('你将收到一个任务，请先理解目标、约束与优先级，然后开始执行。')
  const defaultResumeTaskPrompt = ref('请继续执行刚才被暂停的任务，先简要回顾当前进度，再继续推进直到可交付。')
  const defaultSupervisionPrompt = ref('系统监督提醒：请确认当前任务是否已完成。若已完成请调用 task.complete 标记；若未完成请给出剩余步骤并继续执行。')
  const defaultSupervisionIdleSeconds = ref(25)
  const defaultInheritanceNotice = ref('当前思考量已达到阈值（{session_tokens}/{threshold}），建议立即开启传承流程，沉淀本轮结论与关键上下文。')
  const promptAiMessageInbound = ref(`[系统中断 · AI 间通信]
你刚才的工作被一条来自其它 AI 的消息打断了。请优先处理此消息。

- 发送方: {from_ai_name}（ai_config_id={from_ai_config_id}）
- 消息编号: {message_id}
- 消息内容:
{content}

阅读后，请立即调用 MCP 工具 \`ai.reply_message\` 回复：
  arguments: {{"message_id": "{message_id}", "content": "<你的回复>"}}
回复成功后，系统会让你继续刚才的工作。在你回复之前，不要执行任何其它 MCP 工具。`)
  const promptAiMessageReplySuccess = ref('[系统提示] 你对消息 {message_id} 的回复已送达。\n现在请继续你刚才被打断的任务。')
  const promptUserMessageNotice = ref('[系统提示] 你已向用户发出一条消息（{channel}）。\n用户的回复（如有）会通过 human.ask 工具或正常对话渠道返回，请不要重复发送。')

  const applyTheme = (mode: ThemeMode) => {
    const root = document.documentElement
    if (mode === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
  }

  const applyFontSize = (size: FontSize) => {
    const map: Record<FontSize, string> = { sm: '13px', md: '14px', lg: '16px' }
    document.documentElement.style.setProperty('--app-font-size', map[size])
  }

  const getSystemAutoControlDefaults = () => ({
    start_task_prompt: defaultStartTaskPrompt.value,
    resume_task_prompt: defaultResumeTaskPrompt.value,
    supervision_prompt: defaultSupervisionPrompt.value,
    inheritance_notice: defaultInheritanceNotice.value,
  })

  const normalizeSystemAutoControl = (raw: unknown) =>
    normalizeTaskSystemAutoControl(raw, getSystemAutoControlDefaults())

  const saveSystemSettings = async () => {
    const currentUser = options.getCurrentUser()
    if (!currentUser) return

    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          mcp_call_method: globalMcpCallMethod.value,
          mcp_format_error_hint: globalMcpFormatErrorHint.value,
          mcp_max_steps: clampMcpMaxSteps(mcpMaxSteps.value),
          role_mcp_permissions: roleMcpPermissionsInitialized
            ? JSON.stringify(roleMcpPermissions.value)
            : (options.getCurrentUser()?.role_mcp_permissions ?? ''),
          default_start_task_prompt: defaultStartTaskPrompt.value,
          default_resume_task_prompt: defaultResumeTaskPrompt.value,
          default_supervision_prompt: defaultSupervisionPrompt.value,
          default_supervision_idle_seconds: clampIdleSeconds(defaultSupervisionIdleSeconds.value),
          default_inheritance_notice: defaultInheritanceNotice.value,
          prompt_ai_message_inbound: promptAiMessageInbound.value,
          prompt_ai_message_reply_success: promptAiMessageReplySuccess.value,
          prompt_user_message_notice: promptUserMessageNotice.value,
          ui_theme_mode: themeMode.value,
          ui_font_size: fontSize.value,
        }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        void options.alert({ message: `保存失败: ${error.detail || '未知错误'}`, type: 'error' })
        return
      }

      const updatedUser = await res.json()
      void options.alert({ message: '系统设置已保存', type: 'success' })
      options.onRefreshUser(updatedUser)
    } catch (err) {
      console.error('Failed to save settings:', err)
      void options.alert({ message: '保存失败，请检查网络连接', type: 'error' })
    }
  }

  watch(themeMode, value => {
    applyTheme(value)
  }, { immediate: true })

  watch(fontSize, value => {
    applyFontSize(value)
  }, { immediate: true })

  watch(
    () => options.getCurrentUser(),
    (user) => {
      if (!user) return
      const rawUser = user as any
      if (Object.prototype.hasOwnProperty.call(rawUser, 'ui_theme_mode')) {
        const rawTheme = String(rawUser.ui_theme_mode ?? '').toLowerCase()
        themeMode.value = rawTheme === 'light' ? 'light' : 'dark'
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'ui_font_size')) {
        const rawFont = String(rawUser.ui_font_size ?? '').toLowerCase()
        fontSize.value = rawFont === 'sm' || rawFont === 'lg' ? rawFont : 'md'
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'mcp_call_method')) {
        globalMcpCallMethod.value = String(rawUser.mcp_call_method ?? '')
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'mcp_format_error_hint')) {
        globalMcpFormatErrorHint.value = String(rawUser.mcp_format_error_hint ?? '')
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'mcp_max_steps')) {
        mcpMaxSteps.value = clampMcpMaxSteps(rawUser.mcp_max_steps)
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'default_start_task_prompt')) {
        defaultStartTaskPrompt.value = String(rawUser.default_start_task_prompt ?? '')
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'default_resume_task_prompt')) {
        defaultResumeTaskPrompt.value = String(rawUser.default_resume_task_prompt ?? '')
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'default_supervision_prompt')) {
        defaultSupervisionPrompt.value = String(rawUser.default_supervision_prompt ?? '')
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'default_supervision_idle_seconds')) {
        defaultSupervisionIdleSeconds.value = clampIdleSeconds(rawUser.default_supervision_idle_seconds)
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'default_inheritance_notice')) {
        defaultInheritanceNotice.value = String(rawUser.default_inheritance_notice ?? '')
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'prompt_ai_message_inbound')) {
        promptAiMessageInbound.value = String(rawUser.prompt_ai_message_inbound ?? '')
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'prompt_ai_message_reply_success')) {
        promptAiMessageReplySuccess.value = String(rawUser.prompt_ai_message_reply_success ?? '')
      }
      if (Object.prototype.hasOwnProperty.call(rawUser, 'prompt_user_message_notice')) {
        promptUserMessageNotice.value = String(rawUser.prompt_user_message_notice ?? '')
      }
      initRoleMcpPermissions()
    },
    { immediate: true }
  )

  watch(
    () => JSON.stringify({
      order: options.mcpRoleMeta.value.order,
      options: options.mcpRoleMeta.value.options,
      defaults: options.mcpRoleMeta.value.defaults,
    }),
    () => initRoleMcpPermissions(),
    { immediate: true }
  )

  return {
    themeMode,
    fontSize,
    globalMcpCallMethod,
    globalMcpFormatErrorHint,
    mcpMaxSteps,
    defaultStartTaskPrompt,
    defaultResumeTaskPrompt,
    defaultSupervisionPrompt,
    defaultSupervisionIdleSeconds,
    defaultInheritanceNotice,
    promptAiMessageInbound,
    promptAiMessageReplySuccess,
    promptUserMessageNotice,
    normalizeSystemAutoControl,
    saveSystemSettings,
    roleMcpPermissions,
    isRoleToolAllowed,
    toggleRoleTool,
    setRoleAllTools,
    resetRoleMcpPermissions,
  }
}
