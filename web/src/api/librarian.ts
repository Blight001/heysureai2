import { del, get, post, put } from './http'

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
  intrinsic_properties?: {
    description: string
    total: number
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
      system_auto_control_raw?: string
      auto_control_enabled?: boolean
      auto_prompts: Array<{
        key: string
        label: string
        content: string
      }>
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
      trust?: Record<string, any>
    }>
  }
  inheritance_skills?: {
    description: string
    workshop: string
    online: boolean
    total: number
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
    { token, fallbackError: '固有技能保存失败' },
  )

export const saveSystemPrompts = (
  token: string,
  prompts: Array<{ key: string; content: string | number }>,
) =>
  post<KnowledgeEntryItem>(
    '/api/librarian/system-prompts',
    { prompts },
    { token, fallbackError: '固有思路保存失败' },
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
  opts: { version?: string | null; force?: boolean } = {},
) =>
  post<{ installed: boolean; skill: Record<string, any>; entry: KnowledgeEntryItem }>(
    `/api/librarian/inheritance-tools/clawhub/${encodeURIComponent(slug)}/install`,
    { version: opts.version || undefined, force: !!opts.force },
    { token, fallbackError: 'ClawHub 技能安装失败' },
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
