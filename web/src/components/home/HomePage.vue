<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import heySureLogo from '@/assets/logo/HeySure.png'
import AmbientBackground from '@/components/common/AmbientBackground.vue'

const emit = defineEmits<{
  (e: 'login'): void
  (e: 'register'): void
}>()

// 跑马灯展示的真实能力关键词（与 README 核心能力对齐）
const MARQUEE_ITEMS = [
  'MCP Runtime',
  'Socket.IO 实时同步',
  'Windows 桌面 Agent',
  'Linux 桌面 Agent',
  'Chrome 浏览器扩展',
  'QQ 机器人',
  '飞书机器人',
  '知识库沉淀',
  '任务系统',
  'AI 成员治理',
]

const mockupEl = ref<HTMLElement | null>(null)
const statAgents = ref(0)
const statTasks = ref(0)
const statCalls = ref(0)

const cleanups: (() => void)[] = []

/** 滚动进入视口时触发 [data-reveal] 元素的弹性显隐 */
const setupScrollReveal = (reduceMotion: boolean) => {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
  if (reduceMotion) {
    els.forEach((el) => el.classList.add('is-revealed'))
    return
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-revealed')
        io.unobserve(entry.target)
      }
    },
    { threshold: 0.12 },
  )
  els.forEach((el) => io.observe(el))
  cleanups.push(() => io.disconnect())
}

/** 控制台 mockup 进入视口后，指标数字以 easeOutExpo 滚动到目标值 */
const setupCountUp = (reduceMotion: boolean) => {
  const targets = [
    { state: statAgents, to: 12 },
    { state: statTasks, to: 5 },
    { state: statCalls, to: 248 },
  ]
  if (reduceMotion || !mockupEl.value) {
    targets.forEach((t) => (t.state.value = t.to))
    return
  }
  let raf = 0
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      const start = performance.now()
      const duration = 1500
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration)
        const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)
        targets.forEach((t) => (t.state.value = Math.round(t.to * eased)))
        if (progress < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    },
    { threshold: 0.35 },
  )
  io.observe(mockupEl.value)
  cleanups.push(() => {
    io.disconnect()
    cancelAnimationFrame(raf)
  })
}

/** 鼠标跟随的 3D 倾斜视差 */
const setupTilt = (reduceMotion: boolean) => {
  const el = mockupEl.value
  if (reduceMotion || !el) return
  const onMove = (ev: MouseEvent) => {
    const rect = el.getBoundingClientRect()
    const x = (ev.clientX - rect.left) / rect.width - 0.5
    const y = (ev.clientY - rect.top) / rect.height - 0.5
    el.style.transform = `perspective(1200px) rotateX(${(-y * 5).toFixed(2)}deg) rotateY(${(x * 7).toFixed(2)}deg) translateY(-3px)`
  }
  const onLeave = () => {
    el.style.transform = ''
  }
  el.addEventListener('mousemove', onMove)
  el.addEventListener('mouseleave', onLeave)
  cleanups.push(() => {
    el.removeEventListener('mousemove', onMove)
    el.removeEventListener('mouseleave', onLeave)
  })
}

onMounted(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  setupScrollReveal(reduceMotion)
  setupCountUp(reduceMotion)
  setupTilt(reduceMotion)
})

onBeforeUnmount(() => {
  cleanups.forEach((fn) => fn())
  cleanups.length = 0
})
</script>

<template>
  <div class="relative isolate min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-100">
    <div class="app-background-glow pointer-events-none absolute inset-0"></div>
    <div class="pointer-events-none absolute inset-0 opacity-60">
      <div class="app-background-orb app-background-orb-left drift-organic"></div>
      <div class="app-background-orb app-background-orb-right drift-organic" style="animation-delay: -4.5s"></div>
    </div>
    <!-- 粒子星座 + 鼠标光晕：必须在本页不透明背景之上、内容之下 -->
    <AmbientBackground />

    <!-- 渐变图标共享 defs -->
    <svg class="absolute h-0 w-0" aria-hidden="true">
      <defs>
        <linearGradient id="hg-indigo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#a5b4fc" /><stop offset="100%" stop-color="#6366f1" />
        </linearGradient>
        <linearGradient id="hg-violet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#c4b5fd" /><stop offset="100%" stop-color="#8b5cf6" />
        </linearGradient>
        <linearGradient id="hg-cyan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#a5f3fc" /><stop offset="100%" stop-color="#06b6d4" />
        </linearGradient>
        <linearGradient id="hg-emerald" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#6ee7b7" /><stop offset="100%" stop-color="#10b981" />
        </linearGradient>
        <linearGradient id="hg-amber" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#fde68a" /><stop offset="100%" stop-color="#f59e0b" />
        </linearGradient>
        <linearGradient id="hg-fuchsia" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f0abfc" /><stop offset="100%" stop-color="#d946ef" />
        </linearGradient>
      </defs>
    </svg>

    <!-- Navbar -->
    <nav class="fixed top-0 inset-x-0 z-50 border-b border-zinc-800/60 bg-zinc-950/85 backdrop-blur-xl">
      <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div class="group flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/15 to-violet-600/20 flex items-center justify-center shadow-lg shadow-indigo-950/40 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:rotate-6">
            <img :src="heySureLogo" alt="HeySure logo" class="logo-glow w-6 h-6 object-contain" />
          </div>
          <div class="flex flex-col leading-none">
            <span class="text-[15px] font-semibold tracking-tight text-zinc-100">HeySure</span>
            <span class="text-[10px] tracking-[0.18em] text-zinc-500 mt-0.5">数字社会 OS</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="emit('login')"
            class="px-4 py-1.5 text-sm font-medium text-zinc-300 hover:text-zinc-100 transition-colors rounded-lg hover:bg-zinc-800/60"
          >
            登录
          </button>
          <button
            @click="emit('register')"
            class="btn-shine px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors rounded-lg shadow shadow-indigo-900/40"
          >
            免费注册
          </button>
        </div>
      </div>
    </nav>

    <!-- Hero -->
    <section class="relative pt-40 pb-24 px-6">
      <!-- 背景：网格 + 光晕（粒子星座由全局 AmbientBackground 提供） -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="hero-grid absolute inset-x-0 top-0 h-[640px]"></div>
        <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-indigo-600/10 rounded-full blur-3xl"></div>
        <div class="absolute top-60 left-1/4 w-[400px] h-[300px] bg-violet-800/10 rounded-full blur-3xl drift-organic"></div>
      </div>

      <div class="relative max-w-4xl mx-auto text-center">
        <div data-reveal class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-950/40 text-indigo-300 text-xs font-medium tracking-wide mb-8">
          <span class="relative flex h-1.5 w-1.5">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span>
            <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400"></span>
          </span>
          AI Agent · 数字社会操作系统
        </div>
        <h1 data-reveal style="--reveal-delay: 90ms" class="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] text-zinc-50">
          让 AI 成为成员<br />
          <span class="headline-shimmer text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-300 to-cyan-400">
            而不止是工具
          </span>
        </h1>
        <p data-reveal style="--reveal-delay: 180ms" class="mt-7 text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          在 HeySure 创建你的 AI 数字成员：赋予角色与工具权限，让它们跨桌面与浏览器执行真实任务，在协作中沉淀知识、长期成长。
        </p>
        <div data-reveal style="--reveal-delay: 260ms" class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            @click="emit('register')"
            class="btn-shine w-full sm:w-auto px-7 py-3 text-base font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all duration-300 ease-spring shadow-lg shadow-indigo-900/40 hover:shadow-indigo-800/50 hover:-translate-y-0.5 hover:scale-[1.02]"
          >
            创建第一位 AI 成员
          </button>
          <button
            @click="emit('login')"
            class="w-full sm:w-auto px-7 py-3 text-base font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 rounded-xl transition-all duration-300 ease-spring hover:-translate-y-0.5"
          >
            登录控制台
          </button>
        </div>
      </div>

      <!-- Console preview mockup（鼠标跟随 3D 倾斜） -->
      <div data-reveal style="--reveal-delay: 340ms" class="relative mt-20 max-w-5xl mx-auto" :style="{ perspective: '1200px' }">
        <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent z-10 pointer-events-none" style="top:60%"></div>
        <div ref="mockupEl" class="tilt-card rounded-2xl border border-zinc-700/50 bg-zinc-900/80 backdrop-blur overflow-hidden shadow-2xl shadow-zinc-950">
          <!-- Mock browser chrome -->
          <div class="flex items-center gap-1.5 px-4 py-3 border-b border-zinc-800/80 bg-zinc-900">
            <div class="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div class="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div class="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div class="flex-1 mx-4 flex justify-center">
              <div class="h-5 px-4 flex items-center rounded-md bg-zinc-800 text-[10px] text-zinc-500 tracking-wide">heysure · 数字社会控制台</div>
            </div>
          </div>
          <!-- Mock console interior -->
          <div class="flex h-72">
            <!-- Sidebar: AI members -->
            <div class="hidden sm:block w-48 border-r border-zinc-800/60 p-3">
              <div class="px-1 pb-2 text-[10px] font-medium tracking-[0.16em] text-zinc-500">AI 成员</div>
              <div class="space-y-1">
                <div class="flex items-center gap-2 h-8 px-2 rounded-lg bg-indigo-600/20 border border-indigo-500/20">
                  <div class="relative w-4 h-4 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 shrink-0">
                    <span class="absolute -right-0.5 -bottom-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 ring-1 ring-zinc-900"></span>
                  </div>
                  <div class="h-2 w-16 rounded bg-indigo-300/40"></div>
                </div>
                <div class="flex items-center gap-2 h-8 px-2 rounded-lg bg-zinc-800/50">
                  <div class="relative w-4 h-4 rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 shrink-0">
                    <span class="absolute -right-0.5 -bottom-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 ring-1 ring-zinc-900"></span>
                  </div>
                  <div class="h-2 w-20 rounded bg-zinc-700"></div>
                </div>
                <div class="flex items-center gap-2 h-8 px-2 rounded-lg bg-zinc-800/50">
                  <div class="relative w-4 h-4 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 shrink-0">
                    <span class="absolute -right-0.5 -bottom-0.5 w-1.5 h-1.5 rounded-full bg-amber-400 ring-1 ring-zinc-900"></span>
                  </div>
                  <div class="h-2 w-14 rounded bg-zinc-700"></div>
                </div>
                <div class="flex items-center gap-2 h-8 px-2 rounded-lg bg-zinc-800/50">
                  <div class="relative w-4 h-4 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 shrink-0">
                    <span class="absolute -right-0.5 -bottom-0.5 w-1.5 h-1.5 rounded-full bg-zinc-600 ring-1 ring-zinc-900"></span>
                  </div>
                  <div class="h-2 w-16 rounded bg-zinc-700"></div>
                </div>
              </div>
            </div>
            <!-- Main: stats + chat -->
            <div class="flex-1 p-4 space-y-3">
              <div class="flex gap-3">
                <div class="flex-1 h-20 rounded-xl bg-zinc-800/60 border border-zinc-700/40 p-3">
                  <div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    在线成员
                  </div>
                  <div class="mt-1.5 text-xl font-semibold text-zinc-200 tabular-nums">{{ statAgents }}</div>
                </div>
                <div class="flex-1 h-20 rounded-xl bg-zinc-800/60 border border-zinc-700/40 p-3">
                  <div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                    运行中任务
                  </div>
                  <div class="mt-1.5 text-xl font-semibold text-zinc-200 tabular-nums">{{ statTasks }}</div>
                </div>
                <div class="flex-1 h-20 rounded-xl bg-zinc-800/60 border border-zinc-700/40 p-3">
                  <div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                    工具调用
                  </div>
                  <div class="mt-1.5 text-xl font-semibold text-zinc-200 tabular-nums">{{ statCalls }}</div>
                </div>
              </div>
              <div class="rounded-xl bg-zinc-800/40 border border-zinc-700/30 p-3 space-y-2.5">
                <div class="flex items-start gap-2">
                  <div class="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 shrink-0"></div>
                  <div class="rounded-lg rounded-tl-sm bg-zinc-800/90 border border-zinc-700/40 px-3 py-1.5 text-[11px] text-zinc-400">
                    「行业调研」任务已完成，结论已沉淀至知识库
                  </div>
                </div>
                <div class="flex items-start gap-2 justify-end">
                  <div class="rounded-lg rounded-tr-sm bg-indigo-600/30 border border-indigo-500/20 px-3 py-1.5 text-[11px] text-indigo-200/80">
                    很好，把摘要同步到飞书群
                  </div>
                  <div class="w-5 h-5 rounded-full bg-zinc-700 shrink-0"></div>
                </div>
                <div class="flex items-center gap-2">
                  <div class="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 shrink-0"></div>
                  <div class="flex items-center gap-1 rounded-lg rounded-tl-sm bg-zinc-800/90 border border-zinc-700/40 px-3 py-2">
                    <span class="typing-dot w-1 h-1 rounded-full bg-indigo-300"></span>
                    <span class="typing-dot w-1 h-1 rounded-full bg-indigo-300"></span>
                    <span class="typing-dot w-1 h-1 rounded-full bg-indigo-300"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 能力跑马灯 -->
    <section class="relative py-6 border-y border-zinc-800/50 bg-zinc-900/30">
      <div class="marquee-mask overflow-hidden">
        <div class="marquee-track flex w-max items-center gap-10 pr-10">
          <template v-for="n in 2" :key="n">
            <div
              v-for="item in MARQUEE_ITEMS"
              :key="`${n}-${item}`"
              class="flex items-center gap-3 whitespace-nowrap text-sm text-zinc-500"
              :aria-hidden="n === 2"
            >
              <span class="w-1 h-1 rounded-full bg-indigo-500/70"></span>
              {{ item }}
            </div>
          </template>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="py-24 px-6">
      <div class="max-w-7xl mx-auto">
        <div data-reveal class="text-center mb-16">
          <h2 class="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50">一个控制台，治理整个数字社会</h2>
          <p class="mt-4 text-zinc-400 text-lg max-w-xl mx-auto">从 AI 成员创建到工具执行，从知识沉淀到跨端调度，每个环节都可观察、可治理。</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Feature 1: AI 成员治理 -->
          <div data-reveal class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 transition-all duration-500 ease-spring hover:-translate-y-1.5 hover:border-indigo-500/30 hover:bg-zinc-900/80 hover:shadow-xl hover:shadow-indigo-950/30">
            <div class="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-indigo-700/10 ring-1 ring-indigo-400/30 flex items-center justify-center mb-5 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:-rotate-6">
              <span class="absolute inset-0 rounded-2xl bg-indigo-500/30 blur-lg opacity-0 group-hover:opacity-70 transition-opacity duration-500"></span>
              <svg viewBox="0 0 24 24" class="relative w-6 h-6">
                <circle cx="12" cy="2.8" r="1.3" fill="url(#hg-indigo)" />
                <rect x="11.4" y="3.6" width="1.2" height="2.4" rx="0.6" fill="url(#hg-indigo)" />
                <rect x="4" y="6.2" width="16" height="12.6" rx="4" fill="url(#hg-indigo)" />
                <rect x="1.5" y="10" width="1.9" height="5" rx="0.95" fill="url(#hg-indigo)" opacity="0.45" />
                <rect x="20.6" y="10" width="1.9" height="5" rx="0.95" fill="url(#hg-indigo)" opacity="0.45" />
                <circle cx="9" cy="11.6" r="1.5" fill="#101027" />
                <circle cx="15" cy="11.6" r="1.5" fill="#101027" />
                <circle cx="9.45" cy="11.15" r="0.45" fill="#c7d2fe" />
                <circle cx="15.45" cy="11.15" r="0.45" fill="#c7d2fe" />
                <rect x="8.6" y="15.1" width="6.8" height="1.5" rx="0.75" fill="#101027" opacity="0.6" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">AI 成员治理</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">创建并配置 AI 数字成员：模型、角色 prompt、工具权限与自动控制策略，让每个成员可管理、可审计。</p>
          </div>

          <!-- Feature 2: MCP 工具执行 -->
          <div data-reveal style="--reveal-delay: 80ms" class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 transition-all duration-500 ease-spring hover:-translate-y-1.5 hover:border-violet-500/30 hover:bg-zinc-900/80 hover:shadow-xl hover:shadow-violet-950/30">
            <div class="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-700/10 ring-1 ring-violet-400/30 flex items-center justify-center mb-5 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:rotate-6">
              <span class="absolute inset-0 rounded-2xl bg-violet-500/30 blur-lg opacity-0 group-hover:opacity-70 transition-opacity duration-500"></span>
              <svg viewBox="0 0 24 24" class="relative w-6 h-6">
                <path d="M12 1.8l8.4 4.85v9.7L12 21.2l-8.4-4.85v-9.7z" fill="url(#hg-violet)" opacity="0.3" />
                <path d="M12 4.4l6.2 3.58v7.16L12 18.7l-6.2-3.56V7.98z" fill="url(#hg-violet)" opacity="0.28" />
                <path d="M13.6 6.5l-5.2 6.6h3.1l-1.1 4.4 5.2-6.6h-3.1l1.1-4.4z" fill="#ddd6fe" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">MCP 工具执行</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">基于 MCP 运行时注册与调用工具，覆盖工作区、项目、记忆与任务，每次调用都经过权限校验。</p>
          </div>

          <!-- Feature 3: 多端 Agent 接入 -->
          <div data-reveal style="--reveal-delay: 160ms" class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 transition-all duration-500 ease-spring hover:-translate-y-1.5 hover:border-cyan-500/30 hover:bg-zinc-900/80 hover:shadow-xl hover:shadow-cyan-950/30">
            <div class="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-700/10 ring-1 ring-cyan-400/30 flex items-center justify-center mb-5 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:-rotate-6">
              <span class="absolute inset-0 rounded-2xl bg-cyan-500/30 blur-lg opacity-0 group-hover:opacity-70 transition-opacity duration-500"></span>
              <svg viewBox="0 0 24 24" class="relative w-6 h-6">
                <rect x="1.8" y="3.5" width="17" height="11.5" rx="2" fill="url(#hg-cyan)" opacity="0.4" />
                <rect x="9" y="15" width="2.5" height="1.6" fill="url(#hg-cyan)" opacity="0.4" />
                <rect x="6.8" y="16.4" width="7" height="1.5" rx="0.75" fill="url(#hg-cyan)" opacity="0.4" />
                <rect x="13.8" y="8.6" width="8.4" height="13" rx="2.2" fill="url(#hg-cyan)" />
                <rect x="15.5" y="10.7" width="5" height="7.2" rx="1" fill="#06121d" opacity="0.55" />
                <circle cx="18" cy="19.6" r="0.85" fill="#cffafe" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">多端 Agent 接入</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">Windows / Linux 桌面 Agent 与 Chrome 扩展共享同一后端，让 AI 成员在你的设备上执行真实操作。</p>
          </div>

          <!-- Feature 4: 知识沉淀与传承 -->
          <div data-reveal class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 transition-all duration-500 ease-spring hover:-translate-y-1.5 hover:border-emerald-500/30 hover:bg-zinc-900/80 hover:shadow-xl hover:shadow-emerald-950/30">
            <div class="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-700/10 ring-1 ring-emerald-400/30 flex items-center justify-center mb-5 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:rotate-6">
              <span class="absolute inset-0 rounded-2xl bg-emerald-500/30 blur-lg opacity-0 group-hover:opacity-70 transition-opacity duration-500"></span>
              <svg viewBox="0 0 24 24" class="relative w-6 h-6">
                <path d="M11.5 6.2C9.9 4.9 7.8 4.2 5.6 4.2c-1 0-2 .15-2.9.45v13.9c.9-.3 1.9-.45 2.9-.45 2.2 0 4.3.72 5.9 1.95V6.2z" fill="url(#hg-emerald)" opacity="0.5" />
                <path d="M12.5 6.2c1.6-1.3 3.7-2 5.9-2 1 0 2 .15 2.9.45v13.9c-.9-.3-1.9-.45-2.9-.45-2.2 0-4.3.72-5.9 1.95V6.2z" fill="url(#hg-emerald)" />
                <path d="M17.2 1.2l.65 1.75 1.75.65-1.75.65-.65 1.75-.65-1.75-1.75-.65 1.75-.65z" fill="#a7f3d0" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">知识沉淀与传承</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">会话、任务与成员生命周期事件沉淀为长期知识库，经验可复用、可传承，AI 成员越用越懂你。</p>
          </div>

          <!-- Feature 5: 实时协作 -->
          <div data-reveal style="--reveal-delay: 80ms" class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 transition-all duration-500 ease-spring hover:-translate-y-1.5 hover:border-amber-500/30 hover:bg-zinc-900/80 hover:shadow-xl hover:shadow-amber-950/30">
            <div class="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-700/10 ring-1 ring-amber-400/30 flex items-center justify-center mb-5 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:-rotate-6">
              <span class="absolute inset-0 rounded-2xl bg-amber-500/30 blur-lg opacity-0 group-hover:opacity-70 transition-opacity duration-500"></span>
              <svg viewBox="0 0 24 24" class="relative w-6 h-6">
                <g fill="url(#hg-amber)" opacity="0.45">
                  <rect x="2.2" y="2.8" width="13.5" height="9" rx="3" />
                  <path d="M5.4 11.4v3.4l3.8-3.4z" />
                </g>
                <g fill="url(#hg-amber)">
                  <rect x="8.2" y="9" width="13.5" height="9" rx="3" />
                  <path d="M18.4 17.6v3.4L14.6 17.6z" />
                </g>
                <circle cx="12.2" cy="13.5" r="1" fill="#231503" />
                <circle cx="15" cy="13.5" r="1" fill="#231503" />
                <circle cx="17.8" cy="13.5" r="1" fill="#231503" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">实时协作与观察</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">与 AI 成员实时对话，任务进度、在线状态与运行时指标通过 Socket.IO 即时同步到控制台。</p>
          </div>

          <!-- Feature 6: 连接现实工作流 -->
          <div data-reveal style="--reveal-delay: 160ms" class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 transition-all duration-500 ease-spring hover:-translate-y-1.5 hover:border-fuchsia-500/30 hover:bg-zinc-900/80 hover:shadow-xl hover:shadow-fuchsia-950/30">
            <div class="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500/20 to-fuchsia-700/10 ring-1 ring-fuchsia-400/30 flex items-center justify-center mb-5 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:rotate-6">
              <span class="absolute inset-0 rounded-2xl bg-fuchsia-500/30 blur-lg opacity-0 group-hover:opacity-70 transition-opacity duration-500"></span>
              <svg viewBox="0 0 24 24" class="relative w-6 h-6">
                <g stroke="url(#hg-fuchsia)" stroke-width="1.4" opacity="0.5" fill="none">
                  <path d="M6.5 6.5L12 12M17.5 5.5L12 12M12 12l6 6.5M12 12l-6.5 5.5" />
                </g>
                <circle cx="6.5" cy="6.5" r="2.4" fill="url(#hg-fuchsia)" opacity="0.65" />
                <circle cx="17.5" cy="5.5" r="2" fill="url(#hg-fuchsia)" opacity="0.65" />
                <circle cx="18" cy="18.5" r="2.2" fill="url(#hg-fuchsia)" opacity="0.65" />
                <circle cx="5.5" cy="17.5" r="1.8" fill="url(#hg-fuchsia)" opacity="0.65" />
                <circle cx="12" cy="12" r="3" fill="url(#hg-fuchsia)" />
                <circle cx="12" cy="12" r="1.1" fill="#fdf4ff" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">连接现实工作流</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">通过 QQ / 飞书连接器，AI 成员直接进入你的日常沟通渠道，在真实工作流中接收并完成任务。</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Banner -->
    <section class="py-20 px-6">
      <div data-reveal class="max-w-4xl mx-auto">
        <div class="relative rounded-3xl border border-zinc-700/50 bg-gradient-to-br from-indigo-950/60 via-zinc-900 to-zinc-900 overflow-hidden p-12 text-center">
          <div class="pointer-events-none absolute inset-0">
            <div class="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-indigo-600/15 rounded-full blur-3xl"></div>
            <img
              :src="heySureLogo"
              alt=""
              aria-hidden="true"
              class="drift-organic absolute -right-12 -bottom-16 w-72 opacity-[0.08] rotate-12 select-none"
            />
          </div>
          <div class="relative">
            <h2 class="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50 mb-4">准备好迎接你的第一位数字成员了吗？</h2>
            <p class="text-zinc-400 text-lg mb-8 max-w-lg mx-auto">免费注册，创建 AI 成员，搭建属于你的数字社会。</p>
            <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                @click="emit('register')"
                class="btn-shine w-full sm:w-auto px-8 py-3.5 text-base font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all duration-300 ease-spring shadow-lg shadow-indigo-900/50 hover:-translate-y-0.5 hover:scale-[1.02]"
              >
                立即免费注册
              </button>
              <button
                @click="emit('login')"
                class="w-full sm:w-auto px-8 py-3.5 text-base font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded-xl transition-all duration-300 ease-spring hover:-translate-y-0.5"
              >
                登录已有账号
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="border-t border-zinc-800/60 py-8 px-6">
      <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-zinc-500 text-sm">
        <div class="flex items-center gap-2">
          <img :src="heySureLogo" alt="HeySure logo" class="w-5 h-5 object-contain" />
          <span class="font-medium text-zinc-400">HeySure</span>
          <span class="text-zinc-600">· 数字社会操作系统</span>
        </div>
        <span>© {{ new Date().getFullYear() }} HeySure. All rights reserved.</span>
      </div>
    </footer>

  </div>
</template>
