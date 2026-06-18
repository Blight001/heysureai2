const BEIJING_UTC_OFFSET_MINUTES = 480

export const beijingNow = (now = new Date()): Date => {
  return new Date(now.getTime() + (now.getTimezoneOffset() + BEIJING_UTC_OFFSET_MINUTES) * 60000)
}

export const debugHourFromSearch = (search: string): number | null => {
  const rawHour = new URLSearchParams(search).get('hour')
  if (rawHour === null) return null
  const hour = Number(rawHour)
  return Number.isFinite(hour) ? hour : null
}

export const resolveWorldHour = (search: string, now = new Date()): number => {
  const debugHour = debugHourFromSearch(search)
  if (debugHour !== null) return debugHour
  const bj = beijingNow(now)
  return bj.getHours() + bj.getMinutes() / 60
}

export const nightnessForHour = (hour: number): number => {
  if (hour < 5 || hour >= 21) return 1
  if (hour < 7.5) return 1 - (hour - 5) / 2.5
  if (hour >= 17.5) return (hour - 17.5) / 3.5
  return 0
}

export const phaseLabelForHour = (hour: number): string => {
  if (hour < 5 || hour >= 21) return '🌙 夜晚'
  if (hour < 7.5) return '🌄 黎明'
  if (hour >= 17.5) return '🌆 黄昏'
  return '☀️ 白天'
}

export const clockLabel = (search: string, hour: number, now = new Date()): string => {
  const phase = phaseLabelForHour(hour)
  if (debugHourFromSearch(search) !== null) {
    return `${String(Math.floor(hour)).padStart(2, '0')}:00（调试） ${phase}`
  }
  const bj = beijingNow(now)
  const hh = String(bj.getHours()).padStart(2, '0')
  const mm = String(bj.getMinutes()).padStart(2, '0')
  return `北京时间 ${hh}:${mm} ${phase}`
}
