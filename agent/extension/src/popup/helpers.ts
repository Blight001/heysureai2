// popup/helpers.ts — small pure / state-derived utilities shared across modules.

import { state } from './state'
import { MemberConfig } from '../lib/client'
import { esc } from './markdown'

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
export function fmt(ts: number): string { return new Date(ts).toTimeString().slice(0, 8) }

export function roleOf(m: MemberConfig): string {
  if (m.ai_role === 'assistant_admin') return 'assistant_admin'
  return m.digital_member_role === 'manager' ? 'manager' : 'member'
}
export function memberById(id: number | null): MemberConfig | undefined {
  return state.members.find(m => m.id === id)
}
export function normalizeAvatarUrl(avatar?: string): string {
  const raw = String(avatar || '').trim()
  if (!raw) return ''
  const local = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i)
  if (local) return chrome.runtime.getURL(`avatars/avatars${local[1]}.png`)
  if (/^(https?:|data:|blob:|chrome-extension:)/i.test(raw)) return raw
  if (raw.startsWith('/')) return state.serverUrl ? `${state.serverUrl.replace(/\/+$/, '')}${raw}` : raw
  return raw
}
export function avatarHtml(src: string, fallback: string): string {
  const safeSrc = normalizeAvatarUrl(src)
  return safeSrc
    ? `<img src="${esc(safeSrc)}" alt="" />`
    : esc(fallback)
}
export function toolCount(m: MemberConfig): number {
  try { const a = JSON.parse(m.mcp_tools || '[]'); return Array.isArray(a) ? a.length : 0 } catch { return 0 }
}
export function getConnectedAiShortLabel(): string {
  const name = String(memberById(state.selectedMemberId)?.name || state.auth.userName || state.auth.account || 'AI').trim()
  const shortName = Array.from(name).slice(0, 2).join('') || 'AI'
  return `${shortName}...`
}
export function hasBrowserMcpPermission(m: MemberConfig): boolean {
  if (m.mcp_enabled === false) return false
  try {
    const parsed = JSON.parse(m.mcp_tools || '[]')
    if (!Array.isArray(parsed)) return false
    return parsed.some(tool => {
      const name = String(tool || '').trim()
      return name.startsWith('browser_') || name.startsWith('card_')
    })
  } catch {
    return false
  }
}

export function useServerChat(): boolean {
  return !!(!state.offlineMode && state.auth.token && state.selectedMemberId)
}

export function syncSelectedAiToBackground(force = false) {
  if (!state.selectedMemberId) return
  if (!state.auth.token && !force) return
  if (!memberById(state.selectedMemberId)) return
  state.port.postMessage({ type: 'agent:selected-ai', aiConfigId: state.selectedMemberId })
}
