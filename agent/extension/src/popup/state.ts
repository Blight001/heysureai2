// popup/state.ts — shared mutable state for the popup UI.
// The popup is a single bundled IIFE; every feature module reads and writes
// this one `state` singleton instead of passing values around. Treat it as the
// popup's in-memory store.

import { AgentStatus, ChatMessage, MemoryCard } from '../lib/types'
import { AuthState } from '../lib/storage'
import { MemberConfig, ServerChatSession } from '../lib/client'

export type TabName = 'chat' | 'tasks' | 'cards' | 'settings'

export const STATUS_LABELS: Record<string, string> = {
  disconnected: '未连接', connecting: '连接中...', connected: '已连接',
  registered: '已注册到服务器', error: '连接错误',
}
export const ROLE_LABELS: Record<string, string> = {
  assistant_admin: '辅助管理员', manager: '管理者', member: '普通成员',
}

export const state = {
  currentTheme: 'dark' as 'dark' | 'light',
  activeTab: 'chat' as TabName,
  currentStatus: 'disconnected' as AgentStatus,
  chatHistory: [] as ChatMessage[],
  chatBusy: false,
  hasAiKey: false,
  // Assigned in initPort(); used before assignment never happens because the
  // listeners that read it only fire after the popup has initialised.
  port: undefined as unknown as chrome.runtime.Port,
  activeChatRequestId: null as string | null,

  serverUrl: '',
  offlineMode: false,
  localModel: '',
  auth: { token: '', account: '', userId: null, userName: '', avatar: '' } as AuthState,
  // Cached data URL for the current account's avatar (hydrated from storage),
  // used so renders are synchronous and offline-friendly. Empty = fall back to
  // the live server URL.
  avatarDataUrl: '',
  members: [] as MemberConfig[],
  selectedMemberId: null as number | null,
  activeRunId: null as string | null,
  cards: [] as MemoryCard[],
  expandedCardId: null as string | null,
  runningCardId: null as string | null,

  // Server-backed chat history. Populated only when useServerChat() is true.
  serverSessions: [] as ServerChatSession[],
  currentServerSessionId: '',
  lastSyncedMessageId: 0,
  chatHistoryLoading: false,
}
