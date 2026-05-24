<script setup lang="ts">
const emit = defineEmits<{
  (e: 'login'): void
  (e: 'register'): void
}>()
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100 overflow-x-hidden">

    <!-- Navbar -->
    <nav class="fixed top-0 inset-x-0 z-50 border-b border-zinc-800/60 bg-zinc-950/85 backdrop-blur-xl">
      <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-lg shadow-indigo-900/40">
            <svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span class="text-[15px] font-semibold tracking-tight text-zinc-100">HeySure</span>
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
            class="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors rounded-lg shadow shadow-indigo-900/40"
          >
            免费注册
          </button>
        </div>
      </div>
    </nav>

    <!-- Hero -->
    <section class="relative pt-40 pb-28 px-6">
      <!-- Subtle background glow -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-indigo-600/10 rounded-full blur-3xl"></div>
        <div class="absolute top-60 left-1/4 w-[400px] h-[300px] bg-indigo-800/8 rounded-full blur-3xl"></div>
      </div>

      <div class="relative max-w-4xl mx-auto text-center">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-700/60 bg-zinc-900/60 text-zinc-400 text-xs font-medium tracking-wide mb-8">
          <span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
          专为现代团队而生
        </div>
        <h1 class="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] text-zinc-50">
          协作更高效<br />
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-indigo-300 to-violet-400">
            管理更清晰
          </span>
        </h1>
        <p class="mt-7 text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          统一管理您的团队成员、项目进度与工作流程。让信息流转更顺畅，让决策更有据可依。
        </p>
        <div class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            @click="emit('register')"
            class="w-full sm:w-auto px-7 py-3 text-base font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-900/40 hover:shadow-indigo-800/50 hover:-translate-y-px"
          >
            免费开始使用
          </button>
          <button
            @click="emit('login')"
            class="w-full sm:w-auto px-7 py-3 text-base font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 rounded-xl transition-all duration-200"
          >
            已有账号，登录
          </button>
        </div>
      </div>

      <!-- Dashboard preview mockup -->
      <div class="relative mt-20 max-w-5xl mx-auto">
        <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent z-10 pointer-events-none" style="top:60%"></div>
        <div class="rounded-2xl border border-zinc-700/50 bg-zinc-900/80 backdrop-blur overflow-hidden shadow-2xl shadow-zinc-950">
          <!-- Mock browser chrome -->
          <div class="flex items-center gap-1.5 px-4 py-3 border-b border-zinc-800/80 bg-zinc-900">
            <div class="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div class="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div class="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div class="flex-1 mx-4">
              <div class="h-5 w-48 rounded-md bg-zinc-800 mx-auto"></div>
            </div>
          </div>
          <!-- Mock dashboard interior -->
          <div class="flex h-64">
            <div class="w-48 border-r border-zinc-800/60 p-3 space-y-1">
              <div class="h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/20"></div>
              <div class="h-7 rounded-lg bg-zinc-800/50"></div>
              <div class="h-7 rounded-lg bg-zinc-800/50"></div>
              <div class="h-7 rounded-lg bg-zinc-800/50"></div>
              <div class="h-7 rounded-lg bg-zinc-800/50"></div>
            </div>
            <div class="flex-1 p-4 space-y-3">
              <div class="flex gap-3">
                <div class="flex-1 h-20 rounded-xl bg-zinc-800/60 border border-zinc-700/40"></div>
                <div class="flex-1 h-20 rounded-xl bg-zinc-800/60 border border-zinc-700/40"></div>
                <div class="flex-1 h-20 rounded-xl bg-zinc-800/60 border border-zinc-700/40"></div>
              </div>
              <div class="h-28 rounded-xl bg-zinc-800/40 border border-zinc-700/30"></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="py-24 px-6">
      <div class="max-w-7xl mx-auto">
        <div class="text-center mb-16">
          <h2 class="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50">一个平台，全面掌控</h2>
          <p class="mt-4 text-zinc-400 text-lg max-w-xl mx-auto">从成员管理到项目推进，HeySure 让每个环节都清晰可见。</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Feature 1 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-zinc-700/70 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">成员全景管理</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">清晰的组织架构，灵活的角色分配，实时掌握每位成员的状态与工作负载。</p>
          </div>

          <!-- Feature 2 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-zinc-700/70 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">项目进度追踪</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">任务分解、进度可视化、里程碑跟踪——让每个项目都按时、按质交付。</p>
          </div>

          <!-- Feature 3 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-zinc-700/70 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">无缝沟通协作</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">集成飞书等主流协作工具，消息流转顺畅，重要信息不再遗漏。</p>
          </div>

          <!-- Feature 4 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-zinc-700/70 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">精细权限控制</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">多级权限体系，确保每位成员只能访问和操作属于自己的数据与功能。</p>
          </div>

          <!-- Feature 5 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-zinc-700/70 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">自动化工作流</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">将重复性工作交给自动化，让团队把精力聚焦在真正有价值的事情上。</p>
          </div>

          <!-- Feature 6 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-zinc-700/70 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">数据安全可靠</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">企业级安全标准，数据加密存储，让您的业务信息始终处于受保护状态。</p>
          </div>
        </div>
      </div>
    </section>

    <!-- CTA Banner -->
    <section class="py-20 px-6">
      <div class="max-w-4xl mx-auto">
        <div class="relative rounded-3xl border border-zinc-700/50 bg-gradient-to-br from-indigo-950/60 via-zinc-900 to-zinc-900 overflow-hidden p-12 text-center">
          <div class="pointer-events-none absolute inset-0">
            <div class="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-indigo-600/15 rounded-full blur-3xl"></div>
          </div>
          <div class="relative">
            <h2 class="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50 mb-4">准备好提升您的团队效能？</h2>
            <p class="text-zinc-400 text-lg mb-8 max-w-lg mx-auto">免费注册，立即体验完整功能。无需信用卡，随时可取消。</p>
            <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                @click="emit('register')"
                class="w-full sm:w-auto px-8 py-3.5 text-base font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-900/50 hover:-translate-y-px"
              >
                立即免费注册
              </button>
              <button
                @click="emit('login')"
                class="w-full sm:w-auto px-8 py-3.5 text-base font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded-xl transition-all duration-200"
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
          <div class="w-5 h-5 rounded-md bg-indigo-600/80 flex items-center justify-center">
            <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span class="font-medium text-zinc-400">HeySure</span>
        </div>
        <span>© {{ new Date().getFullYear() }} HeySure. All rights reserved.</span>
      </div>
    </footer>

  </div>
</template>
