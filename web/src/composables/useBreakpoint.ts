import { onMounted, onUnmounted, ref } from 'vue'

/**
 * 响应式断点判定。
 *
 * 桌面端为「顶栏 + 左侧栏 + 中间画面」多窗格，移动端需切换为单窗格 + 底部 Tab，
 * 这种结构性差异无法只靠 Tailwind 响应式类完成，需要一个可在 <script> 中读取的响应式布尔量。
 *
 * 断点与现有布局的 `lg:`（1024px）保持一致：< 1024px 视为移动/紧凑布局。
 */
const MOBILE_QUERY = '(max-width: 1023.98px)'

const matchMobile = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches

export const useBreakpoint = () => {
  // 同步取初值，避免首帧误判导致移动端提前挂载重型组件（如社会显示 iframe）
  const isMobile = ref(matchMobile())

  let mql: MediaQueryList | undefined
  const update = (event: MediaQueryList | MediaQueryListEvent) => {
    isMobile.value = event.matches
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    mql = window.matchMedia(MOBILE_QUERY)
    isMobile.value = mql.matches
    mql.addEventListener('change', update)
  })

  onUnmounted(() => {
    mql?.removeEventListener('change', update)
  })

  return { isMobile }
}
