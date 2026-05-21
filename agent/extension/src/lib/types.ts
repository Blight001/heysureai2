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
  theme:        'dark' | 'light'
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
  theme:       'dark',
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
  role:    'user' | 'assistant'
  content: string | any[]  // string for simple text, array for tool-use/tool-result blocks
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
  | { type: 'chat:send'; messages: ChatMessage[] }
  | { type: 'connection:test' }

export type BgMsg =
  | { type: 'agent:status';    status: AgentStatus; reason?: string }
  | { type: 'activity:log';    entry: ActivityEntry }
  | { type: 'task:start';      data: any }
  | { type: 'task:result';     data: any }
  | { type: 'settings:data';   settings: AgentSettings }
  | { type: 'chat:response';   text: string; toolsUsed?: string[] }
  | { type: 'chat:error';      error: string }
  | { type: 'connection:result'; result: any }
