import { reactive, readonly } from 'vue'

/**
 * 全局动效偏好（背景粒子 / 鼠标互动）。
 *
 * 与主题模式不同，这些纯属客户端视觉偏好，存 localStorage 即可，
 * 登录前的首页也能生效。模块级单例：所有调用方共享同一 reactive 状态。
 */

export interface UiEffectsPrefs {
  /** 全局粒子星座背景 */
  particles: boolean
  /** 鼠标跟随光晕 + 粒子联动 */
  mouseGlow: boolean
}

const STORAGE_KEY = 'heysure-ui-effects'

const load = (): UiEffectsPrefs => {
  const defaults: UiEffectsPrefs = { particles: true, mouseGlow: true }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw)
    return {
      particles: typeof parsed.particles === 'boolean' ? parsed.particles : defaults.particles,
      mouseGlow: typeof parsed.mouseGlow === 'boolean' ? parsed.mouseGlow : defaults.mouseGlow,
    }
  } catch {
    return defaults
  }
}

const prefs = reactive<UiEffectsPrefs>(load())

const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ particles: prefs.particles, mouseGlow: prefs.mouseGlow }))
  } catch {
    // 私密模式等存储失败时静默忽略，仅本次会话生效。
  }
}

export const useUiEffects = () => {
  const setParticles = (value: boolean) => {
    prefs.particles = value
    persist()
  }
  const setMouseGlow = (value: boolean) => {
    prefs.mouseGlow = value
    persist()
  }
  return { effects: readonly(prefs), setParticles, setMouseGlow }
}
