export type AgentStatus = 'disconnected' | 'connecting' | 'connected' | 'registered' | 'error'

export interface AgentSettings {
  serverUrl:    string
  agentToken:   string
  agentId:      string
  agentName:    string
  agentGroup:   string
  aiKey:        string
  aiBaseUrl:    string
  aiModel:      string
  autoConnect:  boolean
  offlineMode:  boolean
  mouseFx:      boolean
  theme:        'dark' | 'light'
  selectedAiConfigId: number | null
}

export const SETTING_DEFAULTS: AgentSettings = {
  serverUrl:   'http://localhost:3000',
  agentToken:  '',
  agentId:     '',
  agentName:   'Browser Agent',
  agentGroup:  '',
  aiKey:       '',
  aiBaseUrl:   'https://api.anthropic.com',
  aiModel:     'claude-sonnet-4-5',
  autoConnect: false,
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

// ── Memory cards (automation workflows) ─────────────────────────────────────
export interface AutomationStep {
  tool: string                 // a browser_* MCP tool name
  args: Record<string, any>    // tool arguments
  note: string                 // 备注 — human-readable description of this step
}

export interface MemoryCard {
  id:          string
  name:        string
  description: string
  steps:       AutomationStep[]
  createdAt:   number
  updatedAt:   number
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

// ── Popup <-> Background messages ────────────────────────────────────────
export type PopupMsg =
  | { type: 'agent:connect' }
  | { type: 'agent:disconnect' }
  | { type: 'settings:get' }
  | { type: 'settings:save'; payload: Partial<AgentSettings> }
  | { type: 'agent:selected-ai'; aiConfigId: number | null }
  | { type: 'chat:send'; messages: ChatMessage[]; requestId?: string }
  | { type: 'connection:test' }
  | { type: 'card:run'; cardId: string }
  | { type: 'card:stop' }

export type BgMsg =
  | { type: 'agent:status';    status: AgentStatus; reason?: string }
  | { type: 'activity:log';    entry: ActivityEntry }
  | { type: 'task:start';      data: any }
  | { type: 'task:result';     data: any }
  | { type: 'settings:data';   settings: AgentSettings }
  | { type: 'chat:response';   text: string; toolsUsed?: string[]; requestId?: string }
  | { type: 'chat:error';      error: string; requestId?: string }
  | { type: 'connection:result'; result: any }
  | { type: 'card:progress';   cardId: string; index: number; total: number; note: string; tool: string; status: string; error?: string }
  | { type: 'card:done';       cardId: string; success: boolean; reason?: string }
