import Store from 'electron-store'

interface AgentSettings {
  serverUrl: string
  agentToken: string
  agentId: string
  agentName: string
  agentGroup: string
  workspaceRoot: string
  autoStart: boolean
  theme: 'dark' | 'light'
  windowBounds: { x: number; y: number; width: number; height: number } | null
  aiKey: string
  aiBaseUrl: string
  aiModel: string
  // Auth
  userAccount: string
  // Saved so the agent can silently re-login and reconnect after a server
  // update/restart invalidates the token, instead of stranding the agent
  // offline until someone logs in by hand.
  userPassword: string
  rememberLogin: boolean
  userName: string
  userAvatar: string
  // Cached data URL of the current account's avatar (fetched from the backend),
  // so it renders instantly and offline. Empty = fall back to the live URL.
  userAvatarDataUrl: string
  authToken: string
  userId: number | null
  // Selected AI Config
  selectedAiConfigId: number | null
  selectedAiConfigName: string
  selectedAiConfigRole: string
  selectedAiConfigLifecycle: string
  selectedAiConfigProject: string
  // Mouse-effect toggle (simulated cursor on AI operations), parity with the
  // browser extension's setting.
  mouseFx: boolean
  // Offline mode (use the self-configured model directly), parity with the
  // browser extension. Persisted here; honoured by the runtime where supported.
  offlineMode: boolean
  // Local per-tool description edits, merged onto getToolDefs() before they are
  // reported to the server via agent:register -> toolDefs. Keyed by tool id.
  // { [toolId]: { description?: string; parameters?: { [param]: string } } }
  toolDescOverrides: Record<string, { description?: string; parameters?: Record<string, string> }>
}

const defaults: AgentSettings = {
  serverUrl: process.env.SERVER_URL || 'http://127.0.0.1:3000',
  agentToken: process.env.AGENT_TOKEN || '',
  agentId: process.env.AGENT_ID || '',
  agentName: process.env.AGENT_NAME || 'Linux Agent',
  agentGroup: process.env.AGENT_GROUP || '',
  workspaceRoot: process.env.WORKSPACE_ROOT || '',
  autoStart: false,
  theme: 'dark',
  windowBounds: null,
  aiKey: process.env.AI_KEY || '',
  aiBaseUrl: process.env.AI_BASE_URL || 'https://api.anthropic.com',
  aiModel: process.env.AI_MODEL || 'claude-sonnet-4-5',
  userAccount: '',
  userPassword: '',
  rememberLogin: false,
  userName: '',
  userAvatar: '',
  userAvatarDataUrl: '',
  authToken: '',
  userId: null,
  selectedAiConfigId: null,
  selectedAiConfigName: '',
  selectedAiConfigRole: 'member',
  selectedAiConfigLifecycle: 'working',
  selectedAiConfigProject: '',
  mouseFx: true,
  offlineMode: false,
  toolDescOverrides: {},
}

export const store = new Store<AgentSettings>({ defaults })
export type { AgentSettings }
