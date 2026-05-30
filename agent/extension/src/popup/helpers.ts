// popup/helpers.ts — small pure / state-derived utilities shared across modules.

import { state } from './state'
import { MemberConfig } from '../lib/client'
import { getAvatarCache, setAvatarCache, clearAvatarCache } from '../lib/storage'
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
  const base = state.serverUrl.replace(/\/+$/, '')
  // Preset avatars are served by the backend at /avatars/avatarsN.png. The
  // stored value is the web console's bundled URL (e.g. /assets/avatars1-<hash>.png),
  // so extract the 1-5 index and resolve it against the server.
  const preset = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i)
  if (preset) return base ? `${base}/avatars/avatars${preset[1]}.png` : ''
  if (/^(https?:|data:|blob:|chrome-extension:)/i.test(raw)) return raw
  if (raw.startsWith('/')) return base ? `${base}${raw}` : raw
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

// ── Avatar fetch + cache (current account only) ──────────────────────────────
// The popup has <all_urls> host permission, so a cross-origin fetch to the
// server needs no CORS cooperation.
function fetchAsDataUrl(url: string): Promise<string> {
  return fetch(url).then(resp => {
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return resp.blob()
  }).then(blob => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  }))
}

// Resolve the current account's avatar, populate state.avatarDataUrl, and cache
// it. Re-fetches whenever the resolved source differs from what's cached (new
// account / changed avatar). On failure, leaves avatarDataUrl empty so renders
// fall back to the live server URL.
export async function refreshAvatarCache(): Promise<void> {
  const resolved = normalizeAvatarUrl(state.auth.avatar)
  if (!resolved) {
    state.avatarDataUrl = ''
    await clearAvatarCache()
    return
  }
  // A data URL is already self-contained — use and cache it directly.
  if (resolved.startsWith('data:')) {
    state.avatarDataUrl = resolved
    await setAvatarCache({ src: resolved, dataUrl: resolved })
    return
  }
  const cached = await getAvatarCache()
  if (cached && cached.src === resolved) {
    state.avatarDataUrl = cached.dataUrl
    return
  }
  try {
    const dataUrl = await fetchAsDataUrl(resolved)
    state.avatarDataUrl = dataUrl
    await setAvatarCache({ src: resolved, dataUrl })
  } catch (err) {
    console.warn('avatar cache fetch failed, falling back to live URL', err)
    state.avatarDataUrl = ''
  }
}

// HTML for the current account's avatar, preferring the cached data URL.
export function currentAvatarHtml(fallback: string): string {
  return avatarHtml(state.avatarDataUrl || state.auth.avatar, fallback)
}
