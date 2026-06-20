import { del, get, post, put } from './http'

// 服务端固定 MCP 工具视图（固有属性 / 工具箱 / 图书馆管理工具共用同一形态）。
export interface IntrinsicMcpView {
  description: string
  total: number
  scope?: 'all' | 'toolbox' | 'library'
  categories: Array<{
    namespace: string
    count: number
    tools: Array<{
      name: string
      description: string
      inputSchema?: Record<string, any>
      parameters?: Array<{
        name: string
        type: string
        required: boolean
        description: string
      }>
      destructive?: boolean
      source?: 'server' | 'endpoint'
    }>
  }>
}

export interface KnowledgeEntryItem {
  memory_id: string
  title: string
  triggers: string[]
  scope: string
  scope_target: string | null
  status: 'pending' | 'active' | 'archived' | 'rejected'
  confidence: number
  use_count: number
  last_used_at?: number | null
  file_path: string
  summary: string
  source_job_id?: string | null
  source_generation?: number | null
  source_ai_config_id?: number | null
  source_message_id?: number | null
  created_at: number
  updated_at: number
  body?: string
  intrinsic_properties?: IntrinsicMcpView
  // 工具箱：每个 AI 默认即可用的系统固定 MCP（无需绑定图书馆）。
  toolbox?: IntrinsicMcpView
  // 图书馆管理工具：需绑定图书馆后才能调用的治理 / 管理类 MCP。
  library_mcp?: IntrinsicMcpView
  intrinsic_personas?: {
    description: string
    total: number
    agents: Array<{
      id: number | null
      name: string
      description: string
      role: string
      digital_member_role: string
      is_librarian: boolean
      enabled: boolean
      model: string
      platform: string
      generation: number
      prompt: string
      updated_at: number
    }>
  }
  system_prompts?: {
    description: string
    total: number
    sections: Array<{
      key: string
      title: string
      count: number
      items: Array<{
        key: string
        label: string
        type: 'text' | 'number'
        content: string
      }>
    }>
  }
  inheritance_tools?: {
    description: string
    registry_url: string
    storage_root: string
    installed_total: number
    installed: Array<{
      slug: string
      displayName: string
      summary: string
      version?: string | null
      ownerHandle: string
      source: string
      path: string
      registry_url: string
      installed_at: number
      auto_enabled: boolean
      present: boolean
      endpoint_kind?: 'any' | 'desktop' | 'browser'
      trust?: Record<string, any>
    }>
  }
  inheritance_skills?: {
    description: string
    workshop: string
    online: boolean
    server_total?: number
    server_categories?: Array<{
      namespace: string
      count: number
      tools: Array<{
        name: string
        description: string
        inputSchema?: Record<string, any>
        parameters?: Array<{
          name: string
          type: string
          required: boolean
          description: string
        }>
        destructive?: boolean
        source?: 'server' | 'endpoint'
      }>
    }>
    endpoint_device_total?: number
    device_total: number
    total: number
    devices: Array<{
      device_id: string
      device_type: string
      updated_at: number
      tool_count: number
      tools: Array<{
        name: string
        description: string
        inputSchema?: Record<string, any>
        parameters?: Array<{
          name: string
          type: string
          required: boolean
          description: string
        }>
        destructive?: boolean
        implementation?: {
          kind?: string
          source_files?: string[]
          handler_source?: string
          editable_via?: string
          code?: Array<Record<string, any>>
          definition?: Record<string, any>
          storage_file?: string
          storage_key?: string
        }
      }>
    }>
    tools: Array<{
      name: string
      description: string
      inputSchema?: Record<string, any>
      parameters?: Array<{
        name: string
        type: string
        required: boolean
        description: string
      }>
      destructive?: boolean
      implementation?: Record<string, any>
      device_id?: string
      device_type?: string
    }>
  }
}

export interface ClawHubSkillSearchResult {
  score?: number
  slug: string
  displayName?: string
  summary?: string
  version?: string | null
  updatedAt?: number
  ownerHandle?: string
  owner?: { handle?: string; displayName?: string; image?: string | null }
  installed?: boolean
}

export interface ClawHubSkillDetail {
  registry_url: string
  slug: string
  detail: Record<string, any>
  version?: string | null
  skill_card: string
  scan: Record<string, any>
  installed: boolean
}

export interface ClawHubInstalledSkillDetail {
  slug: string
  skill: Record<string, any>
  skill_card: string
  metadata: Record<string, any>
  path?: string
  present: boolean
}

export const listProposals = (token: string) =>
  get<{ items: KnowledgeEntryItem[]; total: number }>('/api/librarian/proposals', {
    token,
    fallbackError: '待审批清单加载失败',
  })

export const approveProposal = (token: string, memoryId: string, editedContent?: string) =>
  post<{ approved: boolean; entry: KnowledgeEntryItem }>(
    `/api/librarian/proposals/${encodeURIComponent(memoryId)}/approve`,
    editedContent != null ? { edited_content: editedContent } : {},
    { token, fallbackError: '审批失败' },
  )

export const rejectProposal = (token: string, memoryId: string, reason?: string) =>
  post<{ rejected: boolean; entry: KnowledgeEntryItem }>(
    `/api/librarian/proposals/${encodeURIComponent(memoryId)}/reject`,
    reason ? { reason } : {},
    { token, fallbackError: '驳回失败' },
  )

export const listEntries = (
  token: string,
  opts: { scope?: string; status?: 'pending' | 'active' | 'archived' | 'rejected' | 'all' } = {},
) =>
  get<{ items: KnowledgeEntryItem[]; total: number }>('/api/librarian/entries', {
    token,
    query: opts,
    fallbackError: '知识库加载失败',
  })

export const readEntry = (token: string, memoryId: string) =>
  get<KnowledgeEntryItem>(`/api/librarian/entries/${encodeURIComponent(memoryId)}`, {
    token,
    fallbackError: '条目加载失败',
  })

export const saveIntrinsicProperties = (
  token: string,
  tools: Array<{
    name: string
    description: string
    parameters?: Array<{ name: string; description: string }>
  }>,
) =>
  post<KnowledgeEntryItem>(
    '/api/librarian/intrinsic-properties',
    { tools },
    { token, fallbackError: '传承技能保存失败' },
  )

export const saveSystemPrompts = (
  token: string,
  prompts: Array<{ key: string; content: string | number }>,
) =>
  post<KnowledgeEntryItem>(
    '/api/librarian/system-prompts',
    { prompts },
    { token, fallbackError: '固有思想保存失败' },
  )

export const searchClawHubSkills = (token: string, q: string, limit = 20) =>
  get<{ registry_url: string; results: ClawHubSkillSearchResult[]; total: number }>(
    '/api/librarian/inheritance-tools/clawhub/search',
    {
      token,
      query: { q, limit },
      fallbackError: 'ClawHub 搜索失败',
    },
  )

export const readClawHubSkill = (token: string, slug: string) =>
  get<ClawHubSkillDetail>(
    `/api/librarian/inheritance-tools/clawhub/${encodeURIComponent(slug)}`,
    { token, fallbackError: 'ClawHub 技能详情加载失败' },
  )

export const installClawHubSkill = (
  token: string,
  slug: string,
  opts: { version?: string | null; force?: boolean; endpoint_kind?: 'any' | 'desktop' | 'browser' } = {},
) =>
  post<{ installed: boolean; skill: Record<string, any>; entry: KnowledgeEntryItem }>(
    `/api/librarian/inheritance-tools/clawhub/${encodeURIComponent(slug)}/install`,
    { version: opts.version || undefined, force: !!opts.force, endpoint_kind: opts.endpoint_kind || undefined },
    { token, fallbackError: 'ClawHub 技能安装失败' },
  )

export const setInstalledClawHubSkillEndpoint = (
  token: string,
  slug: string,
  endpointKind: 'any' | 'desktop' | 'browser',
) =>
  post<{ updated: boolean; slug: string; endpoint_kind: string; detail: ClawHubInstalledSkillDetail }>(
    `/api/librarian/inheritance-tools/clawhub/installed/${encodeURIComponent(slug)}/endpoint`,
    { endpoint_kind: endpointKind },
    { token, fallbackError: '传承思想改端失败' },
  )

export const readInstalledClawHubSkill = (token: string, slug: string) =>
  get<ClawHubInstalledSkillDetail>(
    `/api/librarian/inheritance-tools/clawhub/installed/${encodeURIComponent(slug)}`,
    { token, fallbackError: '本地快照加载失败' },
  )

export const updateInstalledClawHubSkill = (token: string, slug: string, skillCard: string) =>
  put<{ updated: boolean; detail: ClawHubInstalledSkillDetail; entry: KnowledgeEntryItem }>(
    `/api/librarian/inheritance-tools/clawhub/installed/${encodeURIComponent(slug)}`,
    { skill_card: skillCard },
    { token, fallbackError: '本地快照保存失败' },
  )

export const deleteInstalledClawHubSkill = (token: string, slug: string) =>
  del<{ deleted: boolean; slug: string; entry: KnowledgeEntryItem }>(
    `/api/librarian/inheritance-tools/clawhub/installed/${encodeURIComponent(slug)}`,
    { token, fallbackError: '本地快照删除失败' },
  )
