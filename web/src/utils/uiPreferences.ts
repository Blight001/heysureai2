export type ThemeMode = 'light' | 'dark'
export type FontSize = 'sm' | 'md' | 'lg'

const THEME_STORAGE_KEY = 'heysure-ui-theme-mode'
const FONT_SIZE_STORAGE_KEY = 'heysure-ui-font-size'

const FONT_SIZE_MAP: Record<FontSize, string> = {
  sm: '13px',
  md: '14px',
  lg: '16px',
}

const readStoredThemeMode = (): ThemeMode | null => {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

const readStoredFontSize = (): FontSize | null => {
  try {
    const raw = localStorage.getItem(FONT_SIZE_STORAGE_KEY)
    return raw === 'sm' || raw === 'md' || raw === 'lg' ? raw : null
  } catch {
    return null
  }
}

export const getInitialUiPreferences = () => {
  const storedThemeMode = readStoredThemeMode()
  const storedFontSize = readStoredFontSize()

  return {
    themeMode: storedThemeMode || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    fontSize: storedFontSize || 'md',
  } as const
}

export const applyUiPreferencesToDocument = (themeMode: ThemeMode, fontSize: FontSize) => {
  const root = document.documentElement
  root.classList.toggle('dark', themeMode === 'dark')
  root.style.setProperty('--app-font-size', FONT_SIZE_MAP[fontSize])
}

export const syncUiPreferencesToStorage = (themeMode: ThemeMode, fontSize: FontSize) => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, fontSize)
  } catch {
    // Ignore storage failures in private mode or restricted environments.
  }
}
