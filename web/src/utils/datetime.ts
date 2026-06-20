/**
 * Shared timestamp formatters. All inputs are **Unix seconds** (the API's
 * convention); each helper multiplies by 1000 once, here, so individual
 * components stop re-implementing the same `new Date(ts * 1000)` dance.
 */

const isBad = (ts?: number | null): boolean => !ts || Number.isNaN(new Date((ts as number) * 1000).getTime())

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Locale date+time, e.g. `2026/6/18 13:05:00`. */
export const formatDateTime = (ts?: number | null, fallback = '--'): string => {
  if (isBad(ts)) return fallback
  return new Date((ts as number) * 1000).toLocaleString()
}

/** Locale time only, e.g. `13:05:00`. */
export const formatClockTime = (ts?: number | null, fallback = ''): string => {
  if (isBad(ts)) return fallback
  return new Date((ts as number) * 1000).toLocaleTimeString()
}

/** Fixed local `YYYY-MM-DD HH:mm`. */
export const formatDateMinute = (ts?: number | null, fallback = ''): string => {
  if (isBad(ts)) return fallback
  const d = new Date((ts as number) * 1000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Fixed local `YYYY-MM-DD`. */
export const formatDate = (ts?: number | null, fallback = ''): string => {
  if (isBad(ts)) return fallback
  const d = new Date((ts as number) * 1000)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Compact duration label, e.g. `1.2s` or `1m 03s`. */
export const formatDurationMs = (ms?: number | null, fallback = ''): string => {
  if (ms == null || Number.isNaN(Number(ms))) return fallback
  const totalSeconds = Math.max(0, Number(ms) / 1000)
  if (totalSeconds < 10) {
    return `${totalSeconds.toFixed(1)}s`
  }

  if (totalSeconds < 60) {
    return `${Math.round(totalSeconds)}s`
  }

  const totalRoundedSeconds = Math.round(totalSeconds)
  const minutes = Math.floor(totalRoundedSeconds / 60)
  const remainder = totalRoundedSeconds % 60
  return `${minutes}m ${pad2(remainder)}s`
}
