import { computed, ref, watch, type Ref } from 'vue'
import type { Agent, McpRoleMeta, McpToolDefinition } from './types'

type SettingsSection = 'mcp' | 'workspace' | 'auto' | 'feishu'

interface UseAiConfigManagementOptions {
  defaultMcpTools: string[]
  mcpToolMetaByName: Ref<Record<string, McpToolDefinition>>
  mcpRoleMeta: Ref<McpRoleMeta>
  normalizeSystemAutoControl: (raw: unknown) => any
  onToggleAiRunByConfigId: (configId?: number) => Promise<void>
  onReloadAgents: () => Promise<void>
  onPatchChatTargetAutoApprove?: (configId: number, enabled: boolean) => void
}

const ROLE_MEMBER = 'digital_member_member'
const ROLE_MANAGER = 'digital_member_manager'
const ROLE_ASSISTANT_ADMIN = 'assistant_admin'

export const useAiConfigManagement = (options: UseAiConfigManagementOptions) => {
  const {
    defaultMcpTools,
    mcpToolMetaByName,
    mcpRoleMeta,
    normalizeSystemAutoControl,
    onToggleAiRunByConfigId,
    onReloadAgents,
    onPatchChatTargetAutoApprove,
  } = options

  const aiConfigModalOpen = ref(false)
  const aiConfigDeleteConfirm = ref(false)
  const aiConfigSettingsSection = ref<SettingsSection | ''>('')
  const aiConfigMode = ref<'create' | 'edit'>('create')
  const aiConfigForm = ref<any>(null)
  const availableMcpTools = ref<string[]>([])
  const availableWorkspaceDirs = ref<string[]>([])
  const workspaceDirsLoading = ref(false)
  const workspaceDirsError = ref('')

  const mcpAutoApproveStorageKey = 'mcp_auto_approve_by_config'

  const loadMcpAutoApproveMap = (): Record<string, boolean> => {
    try {
      const raw = localStorage.getItem(mcpAutoApproveStorageKey)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  const getMcpAutoApprove = (configId?: number) => {
    if (!configId) return false
    return !!loadMcpAutoApproveMap()[String(configId)]
  }

  const setMcpAutoApprove = (configId: number, enabled: boolean) => {
    const map = loadMcpAutoApproveMap()
    map[String(configId)] = !!enabled
    localStorage.setItem(mcpAutoApproveStorageKey, JSON.stringify(map))
  }

  const roleGroupFromRole = (role?: string): 'assistant_admin' | 'digital_member' => {
    return role === 'assistant_admin' ? 'assistant_admin' : 'digital_member'
  }

  const roleFromGroup = (group?: string): 'assistant_admin' | 'digital_member' => {
    if (group === 'assistant_admin') return 'assistant_admin'
    return 'digital_member'
  }

  const normalizeDigitalMemberRole = (value?: string): 'manager' | 'member' => {
    return value === 'manager' ? 'manager' : 'member'
  }

  const tierFromForm = (): string => {
    const group = aiConfigForm.value?.ai_role_group
    if (group === 'assistant_admin') return ROLE_ASSISTANT_ADMIN
    return aiConfigForm.value?.digital_member_role === 'manager' ? ROLE_MANAGER : ROLE_MEMBER
  }

  // Tools the current form's role tier is permitted to configure: the admin's
  // per-role allow-list (or the role default) intersected with the role ceiling.
  const configAvailableMcpTools = computed<string[]>(() => {
    const meta = mcpRoleMeta.value
    const tier = tierFromForm()
    const optionsForRole = meta.options?.[tier] || meta.defaults?.[tier]
    if (!optionsForRole || optionsForRole.length === 0) {
      return availableMcpTools.value
    }
    const optionSet = new Set(optionsForRole)
    const configured = meta.permissions?.[tier]
    const allowed = Array.isArray(configured) && configured.length > 0
      ? configured.filter(tool => optionSet.has(tool))
      : (meta.defaults?.[tier] || [])
    return [...allowed].sort((a, b) => a.localeCompare(b))
  })

  const buildAiForm = (role: 'assistant_admin' | 'worker' = 'assistant_admin') => ({
    id: undefined as number | undefined,
    name: role === 'assistant_admin' ? '新辅助管理员' : '新执行AI',
    description: '',
    ai_role_group: roleGroupFromRole(role),
    digital_member_role: 'member' as 'manager' | 'member',
    platform: role === 'assistant_admin' ? 'Server-Node' : 'Ubuntu-Worker',
    token_limit: role === 'assistant_admin' ? 0 : 10000,
    workspace_root: role === 'assistant_admin' ? '.' : '',
    api_key: '',
    base_url: '',
    model: '',
    prompt: '',
    mcp_tools: [...defaultMcpTools],
    mcp_auto_approve: false,
    feishu_enabled: false,
    feishu_webhook_url: '',
    feishu_app_id: '',
    feishu_app_secret: '',
    feishu_verification_token: '',
    feishu_default_receive_id: '',
    feishu_default_receive_id_type: 'chat_id',
    system_auto_control: normalizeSystemAutoControl({}),
  })

  const normalizeWorkspacePath = (path: string) => {
    return (path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  }

  const loadWorkspaceDirs = async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    workspaceDirsLoading.value = true
    workspaceDirsError.value = ''
    try {
      const res = await fetch('/api/chat/files', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const paths = await res.json()
      const directories = new Set<string>(['.'])
      for (const rawPath of Array.isArray(paths) ? paths : []) {
        const path = String(rawPath || '').replace(/\\/g, '/')
        if (!path) continue
        if (path.endsWith('/')) {
          directories.add(normalizeWorkspacePath(path) || '.')
          continue
        }
        const idx = path.lastIndexOf('/')
        if (idx > 0) directories.add(normalizeWorkspacePath(path.slice(0, idx)) || '.')
      }
      const selectedPath = normalizeWorkspacePath(aiConfigForm.value?.workspace_root || '')
      if (selectedPath) directories.add(selectedPath)
      availableWorkspaceDirs.value = Array.from(directories).sort((a, b) => a.localeCompare(b))
      if (!aiConfigForm.value?.workspace_root) {
        aiConfigForm.value.workspace_root = ''
      }
    } catch (err) {
      console.error('Failed to load workspace directories:', err)
      workspaceDirsError.value = '工作区目录加载失败'
      availableWorkspaceDirs.value = ['.']
      if (!aiConfigForm.value?.workspace_root) aiConfigForm.value.workspace_root = ''
    } finally {
      workspaceDirsLoading.value = false
    }
  }

  const loadMcpTools = async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    const res = await fetch('/api/mcp/tools', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const data = await res.json()
    const rows: McpToolDefinition[] = Array.isArray(data.tools)
      ? data.tools
        .map((item: any) => ({
          name: String(item?.name || '').trim(),
          description: String(item?.description || '').trim(),
          inputSchema: item?.inputSchema && typeof item.inputSchema === 'object' ? item.inputSchema : { type: 'object', properties: {} },
          destructive: !!item?.destructive,
        }))
        .filter((item: McpToolDefinition) => !!item.name)
      : []
    const map: Record<string, McpToolDefinition> = {}
    for (const row of rows) {
      map[row.name] = row
    }
    mcpToolMetaByName.value = map
    const tools = rows.map(item => item.name)
    availableMcpTools.value = tools.length > 0 ? tools : [...defaultMcpTools]

    const asStringArrayMap = (raw: unknown): Record<string, string[]> => {
      const out: Record<string, string[]> = {}
      if (raw && typeof raw === 'object') {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (Array.isArray(value)) {
            out[key] = value.map(item => String(item || '').trim()).filter(Boolean)
          }
        }
      }
      return out
    }
    mcpRoleMeta.value = {
      order: Array.isArray(data.roleOrder) ? data.roleOrder.map((item: unknown) => String(item || '').trim()).filter(Boolean) : [],
      labels: (data.roleLabels && typeof data.roleLabels === 'object') ? data.roleLabels as Record<string, string> : {},
      defaults: asStringArrayMap(data.roleDefaults),
      options: asStringArrayMap(data.roleOptions),
      permissions: asStringArrayMap(data.rolePermissions),
    }
  }

  const toggleAiConfigSettingsSection = (section: SettingsSection) => {
    aiConfigSettingsSection.value = aiConfigSettingsSection.value === section ? '' : section
  }

  const openCreateAiConfig = (role: 'assistant_admin' | 'worker' = 'assistant_admin') => {
    aiConfigMode.value = 'create'
    aiConfigDeleteConfirm.value = false
    aiConfigSettingsSection.value = ''
    aiConfigForm.value = buildAiForm(role)
    void loadWorkspaceDirs()
    aiConfigModalOpen.value = true
  }

  const loadAiConfigDetail = async (id?: number) => {
    if (!id) return
    const token = localStorage.getItem('token')
    if (!token) return
    const res = await fetch('/api/ai/configs', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const rows = await res.json()
    const cfg = rows.find((r: any) => r.id === id)
    if (!cfg || !aiConfigForm.value) return
    let parsedTools: string[] = [...defaultMcpTools]
    try {
      const parsed = JSON.parse(cfg.mcp_tools || '[]')
      if (Array.isArray(parsed)) parsedTools = parsed
    } catch {
      // ignore
    }
    aiConfigForm.value = {
      ...aiConfigForm.value,
      description: cfg.description || '',
      ai_role_group: roleGroupFromRole(cfg.ai_role),
      digital_member_role: normalizeDigitalMemberRole(cfg.digital_member_role),
      platform: cfg.platform || aiConfigForm.value.platform,
      token_limit: cfg.token_limit ?? aiConfigForm.value.token_limit,
      workspace_root: normalizeWorkspacePath(cfg.workspace_root || ''),
      api_key: cfg.api_key || '',
      base_url: cfg.base_url ?? aiConfigForm.value.base_url,
      model: cfg.model ?? aiConfigForm.value.model,
      prompt: cfg.prompt || '',
      enabled: !!cfg.enabled,
      mcp_tools: parsedTools,
      mcp_auto_approve: !!aiConfigForm.value.mcp_auto_approve,
      feishu_enabled: !!cfg.feishu_enabled,
      feishu_webhook_url: cfg.feishu_webhook_url || '',
      feishu_app_id: cfg.feishu_app_id || '',
      feishu_app_secret: cfg.feishu_app_secret || '',
      feishu_verification_token: cfg.feishu_verification_token || '',
      feishu_default_receive_id: cfg.feishu_default_receive_id || '',
      feishu_default_receive_id_type: cfg.feishu_default_receive_id_type || 'chat_id',
      system_auto_control: normalizeSystemAutoControl((() => {
        try { return JSON.parse(cfg.system_auto_control || '{}') } catch { return {} }
      })()),
    }
    const selectedPath = aiConfigForm.value.workspace_root || ''
    if (selectedPath && !availableWorkspaceDirs.value.includes(selectedPath)) {
      availableWorkspaceDirs.value = [...availableWorkspaceDirs.value, selectedPath].sort((a, b) => a.localeCompare(b))
    }
  }

  const openAgentSettings = (agent: Agent) => {
    aiConfigMode.value = 'edit'
    aiConfigDeleteConfirm.value = false
    aiConfigSettingsSection.value = ''
    let parsedTools: string[] = [...defaultMcpTools]
    try {
      const parsed = JSON.parse(agent.mcpTools || '[]')
      if (Array.isArray(parsed)) parsedTools = parsed
    } catch {
      // keep defaults
    }
    aiConfigForm.value = {
      id: agent.aiConfigId,
      name: agent.name,
      description: '',
      ai_role_group: roleGroupFromRole(agent.aiRole),
      digital_member_role: normalizeDigitalMemberRole(agent.digitalMemberRole || (agent.role === 'admin' ? 'manager' : 'member')),
      platform: agent.platform,
      token_limit: agent.aiRole === 'assistant_admin' ? 0 : agent.tokenLimit,
      workspace_root: agent.aiRole === 'assistant_admin' ? '.' : '',
      api_key: '',
      base_url: '',
      model: agent.model || '',
      prompt: '',
      enabled: !!agent.enabled,
      mcp_tools: parsedTools,
      mcp_auto_approve: !!agent.mcpAutoApprove,
      feishu_enabled: false,
      feishu_webhook_url: '',
      feishu_app_id: '',
      feishu_app_secret: '',
      feishu_verification_token: '',
      feishu_default_receive_id: '',
      feishu_default_receive_id_type: 'chat_id',
      system_auto_control: normalizeSystemAutoControl({}),
    }
    void loadWorkspaceDirs()
    aiConfigModalOpen.value = true
    void loadAiConfigDetail(agent.aiConfigId)
  }

  const toggleAiRunInSettings = async () => {
    if (!aiConfigForm.value?.id) return
    await onToggleAiRunByConfigId(aiConfigForm.value.id)
    if (typeof aiConfigForm.value.enabled === 'boolean') {
      aiConfigForm.value.enabled = !aiConfigForm.value.enabled
    } else {
      aiConfigForm.value.enabled = true
    }
  }

  const saveAiConfig = async () => {
    if (!aiConfigForm.value) return
    const token = localStorage.getItem('token')
    if (!token) return
    const normalizedWorkspaceRoot = normalizeWorkspacePath(aiConfigForm.value.workspace_root || '')

    const payload = {
      name: aiConfigForm.value.name,
      description: aiConfigForm.value.description,
      ai_role: roleFromGroup(aiConfigForm.value.ai_role_group),
      digital_member_role: aiConfigForm.value.ai_role_group === 'digital_member'
        ? normalizeDigitalMemberRole(aiConfigForm.value.digital_member_role)
        : 'member',
      platform: aiConfigForm.value.platform,
      token_limit: aiConfigForm.value.ai_role_group === 'assistant_admin'
        ? 0
        : (Number(aiConfigForm.value.token_limit) || 10000),
      workspace_root: normalizedWorkspaceRoot || null,
      api_key: aiConfigForm.value.api_key,
      base_url: aiConfigForm.value.base_url,
      model: aiConfigForm.value.model,
      prompt: aiConfigForm.value.prompt,
      mcp_tools: JSON.stringify(aiConfigForm.value.mcp_tools || []),
      feishu_enabled: !!aiConfigForm.value.feishu_enabled,
      feishu_webhook_url: aiConfigForm.value.feishu_webhook_url || '',
      feishu_app_id: aiConfigForm.value.feishu_app_id || '',
      feishu_app_secret: aiConfigForm.value.feishu_app_secret || '',
      feishu_verification_token: aiConfigForm.value.feishu_verification_token || '',
      feishu_default_receive_id: aiConfigForm.value.feishu_default_receive_id || '',
      feishu_default_receive_id_type: aiConfigForm.value.feishu_default_receive_id_type || 'chat_id',
      system_auto_control: JSON.stringify(
        normalizeSystemAutoControl(
          aiConfigForm.value.system_auto_control || {},
        ),
      ),
    }

    if (aiConfigMode.value === 'create') {
      const res = await fetch('/api/ai/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const created = await res.json()
        if (created?.id) setMcpAutoApprove(created.id, !!aiConfigForm.value.mcp_auto_approve)
      }
    } else if (aiConfigForm.value.id) {
      await fetch(`/api/ai/configs/${aiConfigForm.value.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      setMcpAutoApprove(aiConfigForm.value.id, !!aiConfigForm.value.mcp_auto_approve)
      if (typeof aiConfigForm.value.id === 'number') {
        onPatchChatTargetAutoApprove?.(aiConfigForm.value.id, !!aiConfigForm.value.mcp_auto_approve)
      }
    }
    aiConfigModalOpen.value = false
    await onReloadAgents()
  }

  const deleteAiConfig = async () => {
    if (!aiConfigForm.value?.id) return
    const token = localStorage.getItem('token')
    if (!token) return
    await fetch(`/api/ai/configs/${aiConfigForm.value.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    aiConfigModalOpen.value = false
    aiConfigDeleteConfirm.value = false
    await onReloadAgents()
  }

  const toggleToolPermission = (tool: string, checked: boolean) => {
    if (!aiConfigForm.value) return
    const next = new Set(aiConfigForm.value.mcp_tools as string[])
    if (checked) next.add(tool)
    else next.delete(tool)
    aiConfigForm.value.mcp_tools = Array.from(next)
  }

  const onToolCheckboxChange = (tool: string, event: Event) => {
    const target = event.target as HTMLInputElement | null
    toggleToolPermission(tool, !!target?.checked)
  }

  // Whenever the role tier changes, narrow the selected tools to what the new
  // tier is permitted to configure.
  const clampFormToolsToRole = () => {
    if (!aiConfigForm.value) return
    const allowedSet = new Set(configAvailableMcpTools.value)
    const current: string[] = Array.isArray(aiConfigForm.value.mcp_tools) ? aiConfigForm.value.mcp_tools : []
    aiConfigForm.value.mcp_tools = current.filter(tool => allowedSet.has(tool))
  }

  watch(
    () => aiConfigForm.value?.ai_role_group,
    (role, prevRole) => {
      if (!aiConfigForm.value || !role || role === prevRole) return
      if (role === 'assistant_admin') {
        aiConfigForm.value.token_limit = 0
        if (!aiConfigForm.value.workspace_root) aiConfigForm.value.workspace_root = '.'
        aiConfigForm.value.mcp_tools = [...configAvailableMcpTools.value]
      } else {
        if (!aiConfigForm.value.digital_member_role) {
          aiConfigForm.value.digital_member_role = 'member'
        }
        clampFormToolsToRole()
      }
    }
  )

  watch(
    () => aiConfigForm.value?.digital_member_role,
    (role, prevRole) => {
      if (!aiConfigForm.value || role === prevRole) return
      if (aiConfigForm.value.ai_role_group === 'digital_member') clampFormToolsToRole()
    }
  )

  return {
    aiConfigModalOpen,
    aiConfigDeleteConfirm,
    aiConfigSettingsSection,
    aiConfigMode,
    aiConfigForm,
    availableMcpTools,
    configAvailableMcpTools,
    availableWorkspaceDirs,
    workspaceDirsLoading,
    workspaceDirsError,
    getMcpAutoApprove,
    loadMcpTools,
    toggleAiConfigSettingsSection,
    openCreateAiConfig,
    openAgentSettings,
    toggleAiRunInSettings,
    saveAiConfig,
    deleteAiConfig,
    onToolCheckboxChange,
  }
}
