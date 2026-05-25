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
  userName: string
  userAvatar: string
  authToken: string
  userId: number | null
  // Selected AI Config
  selectedAiConfigId: number | null
  selectedAiConfigName: string
  selectedAiConfigRole: string
  selectedAiConfigLifecycle: string
  selectedAiConfigProject: string
}

const defaults: AgentSettings = {
  serverUrl: process.env.SERVER_URL || 'http://127.0.0.1:3000',
  agentToken: process.env.AGENT_TOKEN || '',
  agentId: process.env.AGENT_ID || '',
  agentName: process.env.AGENT_NAME || 'Windows Agent',
  agentGroup: process.env.AGENT_GROUP || '',
  workspaceRoot: process.env.WORKSPACE_ROOT || '',
  autoStart: false,
  theme: 'dark',
  windowBounds: null,
  aiKey: process.env.AI_KEY || '',
  aiBaseUrl: process.env.AI_BASE_URL || 'https://api.anthropic.com',
  aiModel: process.env.AI_MODEL || 'claude-sonnet-4-5',
  userAccount: '',
  userName: '',
  userAvatar: '',
  authToken: '',
  userId: null,
  selectedAiConfigId: null,
  selectedAiConfigName: '',
  selectedAiConfigRole: 'member',
  selectedAiConfigLifecycle: 'working',
  selectedAiConfigProject: '',
}

export const store = new Store<AgentSettings>({ defaults })
export type { AgentSettings }
