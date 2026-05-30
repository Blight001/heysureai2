// Resolve a stored user.avatar value to a displayable URL.
//
// Preset avatars are served by the backend at /avatars/avatarsN.png (proxied in
// dev via vite.config). The stored value may be the new "/avatars/avatarsN.png"
// path, an older Vite-bundled URL ("/assets/avatarsN-<hash>.png"), or an
// external/data URL — all are normalised here so old and new data render the
// same image. Returns '' when there's no avatar so callers can fall back.
export function resolveAvatarUrl(avatar?: string | null): string {
  const raw = String(avatar || '').trim()
  if (!raw) return ''
  const preset = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i)
  if (preset) return `/avatars/avatars${preset[1]}.png`
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw
  return raw
}

// The preset avatars offered in the picker, served from the backend.
export const PRESET_AVATARS = [
  '/avatars/avatars1.png',
  '/avatars/avatars2.png',
  '/avatars/avatars3.png',
  '/avatars/avatars4.png',
  '/avatars/avatars5.png',
]
