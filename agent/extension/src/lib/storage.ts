import { AgentSettings, SETTING_DEFAULTS, MemoryCard, ChatMessage } from './types'

export async function getSettings(): Promise<AgentSettings> {
  const keys = Object.keys(SETTING_DEFAULTS)
  const stored = await chrome.storage.local.get(keys)
  return { ...SETTING_DEFAULTS, ...stored } as AgentSettings
}

export async function saveSettings(partial: Partial<AgentSettings>): Promise<void> {
  await chrome.storage.local.set(partial as any)
}

export async function getSetting<K extends keyof AgentSettings>(key: K): Promise<AgentSettings[K]> {
  const r = await chrome.storage.local.get(key as string)
  return (r[key] ?? SETTING_DEFAULTS[key]) as AgentSettings[K]
}

// Persist chat history so the popup can restore the last conversation.
const CHAT_KEY = '_chat_history'
const MAX_CHAT = 120

function normalizeChatHistory(raw: any): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
    .map(item => ({
      role: item.role,
      content: item.content,
    }))
    .slice(-MAX_CHAT)
}

export async function getChatHistory(): Promise<ChatMessage[]> {
  const r = await chrome.storage.local.get(CHAT_KEY)
  return normalizeChatHistory((r as any)[CHAT_KEY])
}

export async function setChatHistory(messages: ChatMessage[]): Promise<void> {
  await chrome.storage.local.set({ [CHAT_KEY]: normalizeChatHistory(messages) })
}

export async function clearChatHistory(): Promise<void> {
  await chrome.storage.local.remove(CHAT_KEY)
}

// Persist a small buffer of recent activity so the popup shows history on open
const ACT_KEY = '_activity_buffer'
const MAX_ACT = 100

export async function pushActivity(entry: any): Promise<void> {
  const r = await chrome.storage.session.get(ACT_KEY).catch(() => ({}))
  const buf: any[] = (r as any)[ACT_KEY] || []
  buf.push(entry)
  if (buf.length > MAX_ACT) buf.splice(0, buf.length - MAX_ACT)
  await chrome.storage.session.set({ [ACT_KEY]: buf }).catch(() => {})
}

export async function getActivity(): Promise<any[]> {
  const r = await chrome.storage.session.get(ACT_KEY).catch(() => ({}))
  return (r as any)[ACT_KEY] || []
}

// ── Software-end auth state (logged-in account mode) ─────────────────────────
export interface AuthState {
  token:    string
  account:  string
  userId:   number | null
  userName: string
}

const AUTH_KEY = '_auth_state'
const AUTH_DEFAULT: AuthState = { token: '', account: '', userId: null, userName: '' }

export async function getAuth(): Promise<AuthState> {
  const r = await chrome.storage.local.get(AUTH_KEY)
  return { ...AUTH_DEFAULT, ...(r[AUTH_KEY] || {}) } as AuthState
}

export async function saveAuth(state: Partial<AuthState>): Promise<void> {
  const current = await getAuth()
  await chrome.storage.local.set({ [AUTH_KEY]: { ...current, ...state } })
}

export async function clearAuth(): Promise<void> {
  const current = await getAuth()
  // Keep the last account for convenience, drop the token.
  await chrome.storage.local.set({ [AUTH_KEY]: { ...AUTH_DEFAULT, account: current.account } })
}

// ── Memory cards (automation workflows) ──────────────────────────────────────
const CARDS_KEY = '_memory_cards'

export async function getCards(): Promise<MemoryCard[]> {
  const r = await chrome.storage.local.get(CARDS_KEY)
  const list = (r as any)[CARDS_KEY]
  return Array.isArray(list) ? list as MemoryCard[] : []
}

export async function setCards(cards: MemoryCard[]): Promise<void> {
  await chrome.storage.local.set({ [CARDS_KEY]: cards })
}

export async function getCard(id: string): Promise<MemoryCard | undefined> {
  return (await getCards()).find(c => c.id === id)
}

export async function upsertCard(card: MemoryCard): Promise<void> {
  const cards = await getCards()
  const idx = cards.findIndex(c => c.id === card.id)
  if (idx >= 0) cards[idx] = card
  else cards.push(card)
  await setCards(cards)
}

export async function deleteCard(id: string): Promise<void> {
  await setCards((await getCards()).filter(c => c.id !== id))
}

