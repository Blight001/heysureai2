<script setup lang="ts">
/**
 * 全局氛围背景：粒子星座 canvas + 鼠标跟随光晕。
 *
 * - 粒子缓慢漂移并按距离连线；鼠标互动开启时，靠近光标的粒子被轻微
 *   推开并与光标连线，光晕以 lerp 弹性跟随。
 * - 两层效果分别受 useUiEffects 的 particles / mouseGlow 偏好控制，
 *   可在设置 → 界面偏好中实时切换。
 * - 颜色随亮/暗主题自适应；prefers-reduced-motion 时整体禁用；
 *   标签页隐藏时暂停渲染。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiEffects } from '@/composables/useUiEffects'

const { effects } = useUiEffects()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const glowEl = ref<HTMLElement | null>(null)

const reduceMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Node = { x: number; y: number; vx: number; vy: number; r: number }

let nodes: Node[] = []
let width = 0
let height = 0
let raf = 0
let running = false
const mouse = { x: -9999, y: -9999, active: false }
const glowPos = { x: -9999, y: -9999 }

const LINK_DIST = 130
const MOUSE_DIST = 170

const isDark = () => document.documentElement.classList.contains('dark')

const resize = () => {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const count = Math.min(90, Math.max(30, Math.floor((width * height) / 22000)))
  nodes = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.32,
    vy: (Math.random() - 0.5) * 0.32,
    r: 1 + Math.random() * 1.5,
  }))
}

const step = () => {
  const canvas = canvasEl.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return
  ctx.clearRect(0, 0, width, height)

  const dark = isDark()
  const dotAlpha = dark ? 0.65 : 0.5
  const lineBase = dark ? 0.22 : 0.15
  const dotColor = dark ? '165, 180, 252' : '99, 102, 241'
  const lineColor = dark ? '129, 140, 248' : '99, 102, 241'

  const interactive = effects.mouseGlow && mouse.active

  if (effects.particles) {
    for (const n of nodes) {
      n.x += n.vx
      n.y += n.vy
      // 鼠标互动：靠近光标的粒子被轻微推开（按距离衰减）
      if (interactive) {
        const dx = n.x - mouse.x
        const dy = n.y - mouse.y
        const dist = Math.hypot(dx, dy)
        if (dist > 0.5 && dist < MOUSE_DIST) {
          const force = ((MOUSE_DIST - dist) / MOUSE_DIST) * 0.55
          n.x += (dx / dist) * force
          n.y += (dy / dist) * force
        }
      }
      if (n.x < -12) n.x = width + 12
      if (n.x > width + 12) n.x = -12
      if (n.y < -12) n.y = height + 12
      if (n.y > height + 12) n.y = -12
    }

    ctx.lineWidth = 1
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        const dist = Math.hypot(dx, dy)
        if (dist >= LINK_DIST) continue
        ctx.strokeStyle = `rgba(${lineColor}, ${((1 - dist / LINK_DIST) * lineBase).toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(nodes[i].x, nodes[i].y)
        ctx.lineTo(nodes[j].x, nodes[j].y)
        ctx.stroke()
      }
    }

    // 光标与附近粒子连线，形成"触达"效果
    if (interactive) {
      for (const n of nodes) {
        const dist = Math.hypot(n.x - mouse.x, n.y - mouse.y)
        if (dist >= MOUSE_DIST) continue
        ctx.strokeStyle = `rgba(${lineColor}, ${((1 - dist / MOUSE_DIST) * (lineBase * 2.2)).toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(n.x, n.y)
        ctx.lineTo(mouse.x, mouse.y)
        ctx.stroke()
      }
    }

    ctx.fillStyle = `rgba(${dotColor}, ${dotAlpha})`
    for (const n of nodes) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 光晕弹性跟随（lerp 产生非线性缓动轨迹）
  if (effects.mouseGlow && glowEl.value) {
    glowPos.x += (mouse.x - glowPos.x) * 0.08
    glowPos.y += (mouse.y - glowPos.y) * 0.08
    glowEl.value.style.transform = `translate(${glowPos.x - 220}px, ${glowPos.y - 220}px)`
    glowEl.value.style.opacity = mouse.active ? '1' : '0'
  }

  raf = requestAnimationFrame(step)
}

const start = () => {
  if (running || reduceMotion) return
  running = true
  raf = requestAnimationFrame(step)
}

const stop = () => {
  running = false
  cancelAnimationFrame(raf)
  const ctx = canvasEl.value?.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, width, height)
  if (glowEl.value) glowEl.value.style.opacity = '0'
}

const onMove = (ev: MouseEvent) => {
  mouse.x = ev.clientX
  mouse.y = ev.clientY
  if (!mouse.active) {
    mouse.active = true
    glowPos.x = mouse.x
    glowPos.y = mouse.y
  }
}

const onLeave = () => {
  mouse.active = false
}

const onVisibility = () => {
  if (document.hidden) {
    cancelAnimationFrame(raf)
  } else if (running) {
    raf = requestAnimationFrame(step)
  }
}

// 任一效果开启就保持渲染循环；都关闭时停止并清空画布
watch(
  () => [effects.particles, effects.mouseGlow],
  ([particles, mouseGlow]) => {
    if (particles || mouseGlow) start()
    else stop()
  },
)

onMounted(() => {
  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('mousemove', onMove, { passive: true })
  document.documentElement.addEventListener('mouseleave', onLeave)
  document.addEventListener('visibilitychange', onVisibility)
  if (effects.particles || effects.mouseGlow) start()
})

onBeforeUnmount(() => {
  stop()
  window.removeEventListener('resize', resize)
  window.removeEventListener('mousemove', onMove)
  document.documentElement.removeEventListener('mouseleave', onLeave)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
    <canvas ref="canvasEl" class="absolute inset-0 h-full w-full"></canvas>
    <div
      ref="glowEl"
      class="ambient-mouse-glow absolute left-0 top-0 h-[440px] w-[440px] opacity-0"
    ></div>
  </div>
</template>
