// client.ts — HeySure software-end HTTP client (logged-in account mode)
// Talks to the same REST API the web dashboard uses: auth, AI configs, chat
// runs, MCP role permissions and task scheduling. All calls require a server
// URL plus a bearer token obtained from login().

export interface LoginUser {
  id:       number
  name:     string
  account:  string
  avatar?:  string
  [k: string]: any
}

export interface MemberConfig {
  id:                  number
  name:                string
  description?:        string
  model?:              string
  ai_role?:            string            // assistant_admin / digital_member
  digital_member_role?: string           // manager / member
  platform?:           string
  token_limit?:        number
  enabled?:            boolean
  mcp_enabled?:        boolean
  mcp_tools?:          string             // JSON array string
  workspace_root?:     string | null
  current_behavior?:   string
  project_name?:       string | null
  [k: string]: any
}

export interface ChatRunStatus {
  run_id:      string
  status:      string                     // queued/running/completed/error/stopped
  error_message?: string | null
  live_text:   string
  live_len:    number
  live_phase:  string
  current_tool: string
}

export interface TaskJob {
  job_id:        string
  title:         string
  instruction?:  string
  priority:      number
  status:        string
  trigger_type:  string
  effective_status?: string
  run_status?:   string
  created_at?:   number
  [k: string]: any
}

export interface TaskTriggerPayload {
  title:                      string
  instruction:                string
  priority:                   number
  schedule_enabled:           boolean
  schedule_loop_enabled:      boolean
  schedule_run_immediately:   boolean
  schedule_duration_minutes:  number
  schedule_at:                number | string | null
  override_mcp_tools_enabled: boolean
  mcp_tools_override:         string[]
}

export interface McpRolePermissions {
  roleOrder:        string[]
  roleLabels:       Record<string, string>
  roleDefaults:     Record<string, string[]>
  rolePermissions:  Record<string, string[]>
  tools:            Array<{ name: string; description?: string; minRole?: string; destructive?: boolean }>
}

const trimUrl = (u: string) => String(u || '').replace(/\/+$/, '')

const authHeaders = (token: string, withJson = false): Record<string, string> => {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` }
  if (withJson) h['Content-Type'] = 'application/json'
  return h
}

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const data: any = await res.json()
    return String(data?.detail || data?.error || fallback)
  } catch {
    return `${fallback} (HTTP ${res.status})`
  }
}

async function requestJson<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(await parseError(res, fallback))
  return await res.json() as T
}

// ── Auth ────────────────────────────────────────────────────────────────────
export async function login(serverUrl: string, account: string, password: string): Promise<{ token: string; user: LoginUser }> {
  const base = trimUrl(serverUrl)
  const data = await requestJson<{ access_token: string; user: LoginUser }>(
    `${base}/api/auth/login`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account, password }) },
    '登录失败',
  )
  if (!data.access_token) throw new Error('登录响应缺少令牌')
  return { token: data.access_token, user: data.user }
}

export async function getMe(serverUrl: string, token: string): Promise<LoginUser> {
  return requestJson<LoginUser>(`${trimUrl(serverUrl)}/api/auth/me`, { headers: authHeaders(token) }, '获取用户信息失败')
}

// ── AI members ────────────────────────────────────────────────────────────────
export async function listConfigs(serverUrl: string, token: string): Promise<MemberConfig[]> {
  const rows = await requestJson<MemberConfig[]>(`${trimUrl(serverUrl)}/api/ai/configs`, { headers: authHeaders(token) }, 'AI 成员列表加载失败')
  return Array.isArray(rows) ? rows : []
}

// ── MCP role permissions / tool catalog ────────────────────────────────────────
export async function getMcpTools(serverUrl: string, token: string): Promise<McpRolePermissions> {
  const data = await requestJson<any>(`${trimUrl(serverUrl)}/api/mcp/tools`, { headers: authHeaders(token) }, 'MCP 工具信息加载失败')
  return {
    roleOrder:       Array.isArray(data?.roleOrder) ? data.roleOrder : [],
    roleLabels:      (data?.roleLabels && typeof data.roleLabels === 'object') ? data.roleLabels : {},
    roleDefaults:    (data?.roleDefaults && typeof data.roleDefaults === 'object') ? data.roleDefaults : {},
    rolePermissions: (data?.rolePermissions && typeof data.rolePermissions === 'object') ? data.rolePermissions : {},
    tools:           Array.isArray(data?.tools) ? data.tools : [],
  }
}

// ── Chat runs ───────────────────────────────────────────────────────────────
export async function startChatRun(
  serverUrl: string,
  token: string,
  aiConfigId: number,
  sessionId: string,
  content: string,
): Promise<{ run_id: string }> {
  return requestJson<{ run_id: string }>(
    `${trimUrl(serverUrl)}/api/chat/run/start`,
    {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({
        ai_config_id: aiConfigId,
        ai_kind: 'assistant',
        session_id: sessionId,
        session_name: '浏览器插件会话',
        visible_content: content,
        model_content: content,
      }),
    },
    '发起对话失败',
  )
}

export async function getChatRun(serverUrl: string, token: string, runId: string, after?: number): Promise<ChatRunStatus> {
  const q = after !== undefined ? `?after=${after}` : ''
  return requestJson<ChatRunStatus>(
    `${trimUrl(serverUrl)}/api/chat/run/status/${encodeURIComponent(runId)}${q}`,
    { headers: authHeaders(token) },
    '获取对话状态失败',
  )
}

export async function stopChatRun(serverUrl: string, token: string, runId: string): Promise<void> {
  await fetch(`${trimUrl(serverUrl)}/api/chat/run/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {})
}

// ── Task scheduling ───────────────────────────────────────────────────────────
export async function triggerTask(serverUrl: string, token: string, configId: number, payload: TaskTriggerPayload): Promise<any> {
  return requestJson<any>(
    `${trimUrl(serverUrl)}/api/ai/configs/${configId}/task-trigger`,
    { method: 'POST', headers: authHeaders(token, true), body: JSON.stringify(payload) },
    '安排任务失败',
  )
}

export async function listTaskJobs(serverUrl: string, token: string, configId: number): Promise<TaskJob[]> {
  const data = await requestJson<{ jobs?: TaskJob[] }>(
    `${trimUrl(serverUrl)}/api/ai/configs/${configId}/task-jobs`,
    { headers: authHeaders(token) },
    '任务列表加载失败',
  )
  return Array.isArray(data?.jobs) ? data.jobs : []
}

export async function taskJobAction(
  serverUrl: string,
  token: string,
  configId: number,
  jobId: string,
  action: 'pause' | 'resume' | 'stop' | 'delete',
): Promise<void> {
  const base = `${trimUrl(serverUrl)}/api/ai/configs/${configId}/task-jobs/${encodeURIComponent(jobId)}`
  if (action === 'delete') {
    const res = await fetch(base, { method: 'DELETE', headers: authHeaders(token), signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(await parseError(res, '删除任务失败'))
    return
  }
  const res = await fetch(`${base}/${action}`, { method: 'POST', headers: authHeaders(token), signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(await parseError(res, `${action} 任务失败`))
}
