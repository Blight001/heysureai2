import { computed, ref, watch, type Ref } from 'vue'
import type { Agent, McpRoleMeta, McpToolDefinition, ModelPreset } from '@/types'
import { BROWSER_AGENT_MCP_TOOLS, DESKTOP_AGENT_MCP_TOOLS, ENDPOINT_AGENT_MCP_TOOLS } from '@/utils/mcpTools'
import { getAuthToken } from '@/api/http'
import { listWorkspaceFiles } from '@/api/workspace'
import { listMcpTools } from '@/api/mcp'
import {
  createAiConfig,
  deleteAiConfig as apiDeleteAiConfig,
  listAiConfigs,
  updateAiConfig,
  type AiConfigUpsertPayload,
} from '@/api/ai'

type SettingsSection = 'mcp' | 'workspace' | 'auto' | 'bot'

interface UseAiConfigManagementOptions {
  defaultMcpTools: string[]
  mcpToolMetaByName: Ref<Record<string, McpToolDefinition>>
  mcpRoleMeta: Ref<McpRoleMeta>
  modelPresets: Ref<ModelPreset[]>
  normalizeSystemAutoControl: (raw: unknown) => any
  alert?: (options: { title?: string; message: string; type?: 'info' | 'success' | 'warning' | 'error' }) => Promise<void>
  onToggleAiRunByConfigId: (configId?: number) => Promise<void>
  onReloadAgents: () => Promise<void>
  onPatchChatTargetAutoApprove?: (configId: number, enabled: boolean) => void
}

const ROLE_MEMBER = 'digital_member_member'
const ROLE_MANAGER = 'digital_member_manager'
const ROLE_ASSISTANT_ADMIN = 'assistant_admin'

// Server-side schema mirrors (see ``api/bots/<name>/_config.py``).
// Anything outside these keys is dropped by the adapters; keep them in
// sync when a bot's config schema changes.
const BOT_CONFIG_DEFAULTS: Record<string, Record<string, any>> = {
  feishu: {
    enabled: false,
    webhook_url: '',
    app_id: '',
    app_secret: '',
    verification_token: '',
    default_receive_id: '',
    default_receive_id_type: 'chat_id',
  },
  qq: {
    enabled: false,
    app_id: '',
    app_secret: '',
    sandbox: false,
    default_target_id: '',
    default_target_type: 'c2c',
  },
}

function hydrateBotConfigs(raw: any): Record<string, Record<string, any>> {
  // Merge server payload on top of defaults so every channel slice always
  // has every field populated for v-model bindings.
  // The server stores ``bot_configs`` as a JSON *string* column, so the
  // ``/api/ai/configs`` row hands it back as a string; parse it before use
  // (otherwise ``typeof raw === 'object'`` is false and the saved config is
  // silently dropped, leaving the popup blank).
  if (typeof raw === 'string') {
    try {
      raw = raw.trim() ? JSON.parse(raw) : null
    } catch {
      raw = null
    }
  }
  const out: Record<string, Record<string, any>> = {}
  for (const [channel, defaults] of Object.entries(BOT_CONFIG_DEFAULTS)) {
    const incoming = (raw && typeof raw === 'object' ? raw[channel] : null) || {}
    const merged: Record<string, any> = { ...defaults }
    for (const key of Object.keys(defaults)) {
      if (incoming[key] !== undefined && incoming[key] !== null) {
        merged[key] = incoming[key]
      }
    }
    out[channel] = merged
  }
  return out
}

function buildBotConfigsPayload(
  formConfigs: Record<string, Record<string, any>>,
  activeChannel: string,
): Record<string, Record<string, any>> {
  // Bots that aren't the active channel are force-disabled before send so
  // the server doesn't see a stray ``enabled=true`` from a previous toggle.
  const out: Record<string, Record<string, any>> = {}
  for (const [channel, defaults] of Object.entries(BOT_CONFIG_DEFAULTS)) {
    const slice = formConfigs?.[channel] || {}
    const merged: Record<string, any> = { ...defaults, ...slice }
    if (channel !== activeChannel) merged.enabled = false
    out[channel] = merged
  }
  return out
}

export const useAiConfigManagement = (options: UseAiConfigManagementOptions) => {
  const {
    defaultMcpTools,
    mcpToolMetaByName,
    mcpRoleMeta,
    modelPresets,
    normalizeSystemAutoControl,
    alert,
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
    model_preset_id: modelPresets.value[0]?.id || '',
    model: modelPresets.value[0]?.model || '',
    prompt: '',
    mcp_tools: [...defaultMcpTools],
    mcp_auto_approve: false,
    bot_channel: 'feishu' as 'feishu' | 'qq',
    bot_configs: {
      feishu: {
        enabled: false,
        webhook_url: '',
        app_id: '',
        app_secret: '',
        verification_token: '',
        default_receive_id: '',
        default_receive_id_type: 'chat_id',
      },
      qq: {
        enabled: false,
        app_id: '',
        app_secret: '',
        sandbox: false,
        default_target_id: '',
        default_target_type: 'c2c',
      },
    } as Record<string, Record<string, any>>,
    system_auto_control: normalizeSystemAutoControl({}),
  })

  const presetIdForModel = (presetId?: string, model?: string) => {
    const id = String(presetId || '').trim()
    if (id && modelPresets.value.some(item => item.id === id)) return id
    const modelName = String(model || '').trim()
    return modelPresets.value.find(item => item.model === modelName || item.id === modelName)?.id || id
  }

  const normalizeWorkspacePath = (path: string) => {
    return (path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  }

  const loadWorkspaceDirs = async () => {
    if (!getAuthToken()) return
    workspaceDirsLoading.value = true
    workspaceDirsError.value = ''
    try {
      const paths = await listWorkspaceFiles()
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
    if (!getAuthToken()) return
    let data
    try {
      data = await listMcpTools()
    } catch {
      return
    }
    const rows: McpToolDefinition[] = Array.isArray(data.tools)
      ? data.tools
        .map((item: any) => ({
          name: String(item?.name || '').trim(),
          description: String(item?.description || '').trim(),
          inputSchema: item?.inputSchema && typeof item.inputSchema === 'object' ? item.inputSchema : { type: 'object', properties: {} },
          destructive: !!item?.destructive,
          mcpSource: 'server' as const,
        }))
        .filter((item: McpToolDefinition) => !!item.name)
      : []
    const map: Record<string, McpToolDefinition> = {}
    for (const row of rows) {
      map[row.name] = row
    }
    for (const name of DESKTOP_AGENT_MCP_TOOLS) {
      map[name] = {
        name,
        description: '桌面端 Agent 上报的执行能力，可直接在已连接桌面端执行。',
        inputSchema: { type: 'object', properties: {} },
        destructive: false,
        mcpSource: 'desktop',
      }
    }
    for (const name of BROWSER_AGENT_MCP_TOOLS) {
      map[name] = {
        name,
        description: '浏览器插件上报的执行能力，可直接在已连接浏览器插件执行。',
        inputSchema: { type: 'object', properties: {} },
        destructive: false,
        mcpSource: 'browser',
      }
    }
    mcpToolMetaByName.value = map
    const tools = Array.from(new Set([...rows.map(item => item.name), ...ENDPOINT_AGENT_MCP_TOOLS]))
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
    const mergeUnique = (base: string[] = [], extra: string[] = []) => Array.from(new Set([...base, ...extra])).filter(Boolean).sort((a, b) => a.localeCompare(b))
    const roleOptions = asStringArrayMap(data.roleOptions)
    const roleDefaults = asStringArrayMap(data.roleDefaults)
    const roleOrder = Array.isArray(data.roleOrder) ? data.roleOrder.map((item: unknown) => String(item || '').trim()).filter(Boolean) : []
    for (const role of roleOrder) {
      roleOptions[role] = mergeUnique(roleOptions[role], ENDPOINT_AGENT_MCP_TOOLS)
      if (role === ROLE_ASSISTANT_ADMIN) {
        roleDefaults[role] = mergeUnique(roleDefaults[role], ENDPOINT_AGENT_MCP_TOOLS)
      }
    }
    mcpRoleMeta.value = {
      order: roleOrder,
      labels: (data.roleLabels && typeof data.roleLabels === 'object') ? data.roleLabels as Record<string, string> : {},
      defaults: roleDefaults,
      options: roleOptions,
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
    if (!getAuthToken()) return
    let rows
    try {
      rows = await listAiConfigs()
    } catch {
      return
    }
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
      model_preset_id: presetIdForModel(cfg.model_preset_id, cfg.model),
      model: cfg.model ?? aiConfigForm.value.model,
      prompt: cfg.prompt || '',
      enabled: !!cfg.enabled,
      mcp_tools: parsedTools,
      mcp_auto_approve: !!aiConfigForm.value.mcp_auto_approve,
      bot_channel: cfg.bot_channel === 'qq' ? 'qq' : 'feishu',
      // Hydrate ``bot_configs`` from the server (default fills in any
      // missing keys so the form bindings always have a value).
      bot_configs: hydrateBotConfigs(cfg.bot_configs),
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
      model_preset_id: presetIdForModel('', agent.model),
      model: agent.model || '',
      prompt: '',
      enabled: !!agent.enabled,
      mcp_tools: parsedTools,
      mcp_auto_approve: !!agent.mcpAutoApprove,
      bot_channel: agent.botChannel === 'qq' ? 'qq' : 'feishu',
      bot_configs: hydrateBotConfigs(null),
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
    if (!aiConfigForm.value) return false
    if (!getAuthToken()) return false
    const normalizedWorkspaceRoot = normalizeWorkspacePath(aiConfigForm.value.workspace_root || '')
    const selectedBotChannel = aiConfigForm.value.bot_channel === 'qq' ? 'qq' : 'feishu'
    const selectedPreset = modelPresets.value.find(item => item.id === aiConfigForm.value.model_preset_id)
    if (!selectedPreset) {
      await alert?.({
        title: '保存失败',
        message: '请先选择一个已保存的服务器模型。',
        type: 'warning',
      })
      return false
    }

    const payload: AiConfigUpsertPayload = {
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
      model: selectedPreset.model,
      model_preset_id: selectedPreset.id,
      prompt: aiConfigForm.value.prompt,
      mcp_tools: JSON.stringify(aiConfigForm.value.mcp_tools || []),
      bot_channel: selectedBotChannel,
      bot_configs: buildBotConfigsPayload(aiConfigForm.value.bot_configs, selectedBotChannel),
      system_auto_control: JSON.stringify(
        normalizeSystemAutoControl(
          aiConfigForm.value.system_auto_control || {},
        ),
      ),
    }

    try {
      if (aiConfigMode.value === 'create') {
        const created = await createAiConfig(payload)
        if (created?.id) setMcpAutoApprove(created.id, !!aiConfigForm.value.mcp_auto_approve)
      } else if (aiConfigForm.value.id) {
        await updateAiConfig(aiConfigForm.value.id, payload)
        setMcpAutoApprove(aiConfigForm.value.id, !!aiConfigForm.value.mcp_auto_approve)
        if (typeof aiConfigForm.value.id === 'number') {
          onPatchChatTargetAutoApprove?.(aiConfigForm.value.id, !!aiConfigForm.value.mcp_auto_approve)
        }
      }
    } catch (err) {
      await alert?.({
        title: '保存失败',
        message: (err as Error)?.message || 'AI 配置保存失败，请检查配置后重试。',
        type: 'error',
      })
      return false
    }
    aiConfigModalOpen.value = false
    await onReloadAgents()
    await alert?.({
      title: '保存成功',
      message: 'AI 配置已保存。',
      type: 'success',
    })
    return true
  }

  const deleteAiConfig = async () => {
    if (!aiConfigForm.value?.id) return
    if (!getAuthToken()) return
    try {
      await apiDeleteAiConfig(aiConfigForm.value.id)
    } catch {
      // best-effort
    }
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

  watch(
    modelPresets,
    presets => {
      if (!aiConfigForm.value || aiConfigForm.value.model_preset_id) return
      aiConfigForm.value.model_preset_id = presets[0]?.id || ''
      aiConfigForm.value.model = presets[0]?.model || ''
    },
    { deep: true }
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
