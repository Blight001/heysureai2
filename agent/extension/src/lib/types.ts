export type AgentStatus = 'disconnected' | 'connecting' | 'connected' | 'registered' | 'error'

export interface AgentSettings {
  serverUrl:    string
  // Optional manual override for the agent Socket.IO endpoint.
  // When the server is split (api-gateway + connector-runtime) the agent
  // socket lives on a different port/host than the HTTP API. Empty means
  // auto-detect: try serverUrl first, then common alternatives.
  agentServerUrl: string
  // Cached URL that successfully registered last time. Used as the first
  // probe candidate so reconnects don't re-scan after the topology is known.
  lastWorkingAgentUrl: string
  agentToken:   string
  agentId:      string
  agentName:    string
  agentGroup:   string
  aiKey:        string
  aiBaseUrl:    string
  aiModel:      string
  offlineMode:  boolean
  mouseFx:      boolean
  theme:        'dark' | 'light'
  selectedAiConfigId: number | null
}

export const SETTING_DEFAULTS: AgentSettings = {
  serverUrl:   'http://localhost:3000',
  agentServerUrl:      '',
  lastWorkingAgentUrl: '',
  agentToken:  '',
  agentId:     '',
  agentName:   'Browser Agent',
  agentGroup:  '',
  aiKey:       '',
  aiBaseUrl:   'https://api.anthropic.com',
  aiModel:     'claude-sonnet-4-5',
  offlineMode: false,
  mouseFx:     true,
  theme:       'dark',
  selectedAiConfigId: null,
}

export interface DispatchedTask {
  taskId:      string
  userId?:     string | number
  aiConfigId?: string | number
  sessionId?:  string
  instruction?: string
  tool?:       string
  args?:       Record<string, any>
  allowedTools?: string[]
}

export interface TaskResult {
  success: boolean
  tool:    string
  result:  any
  summary: string
}

export interface ActivityEntry {
  id:        string
  type:      string
  status:    string
  message:   string
  data?:     any
  timestamp: number
}

// ── AI types ──────────────────────────────────────────────────────────────
export interface ChatMessage {
  role:    'user' | 'assistant' | 'system'
  content: string | any[]  // string for simple text, array for tool-use/tool-result blocks
  // Optional fields populated when the message lives on the server.
  serverId?:   number
  think?:      string
  createdAt?:  number
}

export interface AIToolDef {
  name:         string
  description:  string
  input_schema: { type: 'object'; properties: Record<string, any>; required?: string[] }
}

export interface AIToolUse {
  type:  'tool_use'
  id:    string
  name:  string
  input: Record<string, any>
}

export interface ChatToolEvent {
  key: string
  label: string
  detail?: string
  imageUrl?: string
}

// ── Popup <-> Background messages ────────────────────────────────────────
export type PopupMsg =
  | { type: 'agent:connect' }
  | { type: 'agent:disconnect' }
  | { type: 'auth:logout' }
  | { type: 'settings:get' }
  | { type: 'settings:save'; payload: Partial<AgentSettings> }
  | { type: 'agent:selected-ai'; aiConfigId: number | null }
  | { type: 'chat:send'; messages: ChatMessage[]; requestId?: string }
  | { type: 'connection:test' }
  // MCP tool tester: run one local browser tool and return its raw result.
  | { type: 'mcp:test'; requestId: string; tool: string; args: Record<string, any> }

export type BgMsg =
  | { type: 'agent:status';    status: AgentStatus; reason?: string; aiConfigId?: number | null }
  | { type: 'activity:log';    entry: ActivityEntry }
  | { type: 'task:start';      data: any }
  | { type: 'task:result';     data: any }
  | { type: 'settings:data';   settings: AgentSettings }
  | { type: 'chat:response';   text: string; toolsUsed?: string[]; toolEvents?: ChatToolEvent[]; requestId?: string }
  | { type: 'chat:error';      error: string; requestId?: string }
  | { type: 'connection:result'; result: any }
  | { type: 'mcp:test:result'; requestId: string; ok: boolean; result?: any; error?: string }
