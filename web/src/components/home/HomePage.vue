<script setup lang="ts">
import heySureLogo from '@/assets/logo/HeySure.png'

const emit = defineEmits<{
  (e: 'login'): void
  (e: 'register'): void
}>()
</script>

<template>
  <div class="relative isolate min-h-screen overflow-x-hidden bg-zinc-950 text-zinc-100">
    <div class="app-background-glow pointer-events-none absolute inset-0"></div>
    <div class="pointer-events-none absolute inset-0 opacity-60">
      <div class="app-background-orb app-background-orb-left"></div>
      <div class="app-background-orb app-background-orb-right"></div>
    </div>

    <!-- Navbar -->
    <nav class="fixed top-0 inset-x-0 z-50 border-b border-zinc-800/60 bg-zinc-950/85 backdrop-blur-xl">
      <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/15 to-violet-600/20 flex items-center justify-center shadow-lg shadow-indigo-950/40">
            <img :src="heySureLogo" alt="HeySure logo" class="w-6 h-6 object-contain" />
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
            class="px-4 py-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors rounded-lg shadow shadow-indigo-900/40"
          >
            免费注册
          </button>
        </div>
      </div>
    </nav>

    <!-- Hero -->
    <section class="relative pt-40 pb-28 px-6">
      <!-- Subtle background glow + circuit grid -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="hero-grid absolute inset-x-0 top-0 h-[640px]"></div>
        <div class="absolute -top-24 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-indigo-600/10 rounded-full blur-3xl"></div>
        <div class="absolute top-60 left-1/4 w-[400px] h-[300px] bg-violet-800/10 rounded-full blur-3xl"></div>
      </div>

      <div class="relative max-w-4xl mx-auto text-center">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-950/40 text-indigo-300 text-xs font-medium tracking-wide mb-8">
          <span class="relative flex h-1.5 w-1.5">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span>
            <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-indigo-400"></span>
          </span>
          AI Agent · 数字社会操作系统
        </div>
        <h1 class="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.08] text-zinc-50">
          让 AI 成为成员<br />
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-300 to-cyan-400">
            而不止是工具
          </span>
        </h1>
        <p class="mt-7 text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
          在 HeySure 创建你的 AI 数字成员：赋予角色与工具权限，让它们跨桌面与浏览器执行真实任务，在协作中沉淀知识、长期成长。
        </p>
        <div class="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            @click="emit('register')"
            class="w-full sm:w-auto px-7 py-3 text-base font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-900/40 hover:shadow-indigo-800/50 hover:-translate-y-px"
          >
            创建第一位 AI 成员
          </button>
          <button
            @click="emit('login')"
            class="w-full sm:w-auto px-7 py-3 text-base font-medium text-zinc-300 hover:text-zinc-100 bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/60 rounded-xl transition-all duration-200"
          >
            登录控制台
          </button>
        </div>
      </div>

      <!-- Console preview mockup -->
      <div class="relative mt-20 max-w-5xl mx-auto">
        <div class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent z-10 pointer-events-none" style="top:60%"></div>
        <div class="rounded-2xl border border-zinc-700/50 bg-zinc-900/80 backdrop-blur overflow-hidden shadow-2xl shadow-zinc-950">
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
                  <div class="mt-1.5 text-xl font-semibold text-zinc-200">12</div>
                </div>
                <div class="flex-1 h-20 rounded-xl bg-zinc-800/60 border border-zinc-700/40 p-3">
                  <div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                    运行中任务
                  </div>
                  <div class="mt-1.5 text-xl font-semibold text-zinc-200">5</div>
                </div>
                <div class="flex-1 h-20 rounded-xl bg-zinc-800/60 border border-zinc-700/40 p-3">
                  <div class="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                    工具调用
                  </div>
                  <div class="mt-1.5 text-xl font-semibold text-zinc-200">248</div>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="py-24 px-6">
      <div class="max-w-7xl mx-auto">
        <div class="text-center mb-16">
          <h2 class="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50">一个控制台，治理整个数字社会</h2>
          <p class="mt-4 text-zinc-400 text-lg max-w-xl mx-auto">从 AI 成员创建到工具执行，从知识沉淀到跨端调度，每个环节都可观察、可治理。</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Feature 1: AI 成员治理 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-indigo-500/30 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">AI 成员治理</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">创建并配置 AI 数字成员：模型、角色 prompt、工具权限与自动控制策略，让每个成员可管理、可审计。</p>
          </div>

          <!-- Feature 2: MCP 工具执行 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-indigo-500/30 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">MCP 工具执行</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">基于 MCP 运行时注册与调用工具，覆盖工作区、项目、记忆与任务，每次调用都经过权限校验。</p>
          </div>

          <!-- Feature 3: 多端 Agent 接入 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-indigo-500/30 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">多端 Agent 接入</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">Windows / Linux 桌面 Agent 与 Chrome 扩展共享同一后端，让 AI 成员在你的设备上执行真实操作。</p>
          </div>

          <!-- Feature 4: 知识沉淀与传承 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-indigo-500/30 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">知识沉淀与传承</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">会话、任务与成员生命周期事件沉淀为长期知识库，经验可复用、可传承，AI 成员越用越懂你。</p>
          </div>

          <!-- Feature 5: 实时协作 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-indigo-500/30 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-zinc-100 mb-2">实时协作与观察</h3>
            <p class="text-zinc-400 text-sm leading-relaxed">与 AI 成员实时对话，任务进度、在线状态与运行时指标通过 Socket.IO 即时同步到控制台。</p>
          </div>

          <!-- Feature 6: 连接现实工作流 -->
          <div class="group rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-7 hover:border-indigo-500/30 hover:bg-zinc-900/80 transition-all duration-300">
            <div class="w-11 h-11 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center mb-5 group-hover:bg-indigo-600/25 transition-colors">
              <svg class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
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
      <div class="max-w-4xl mx-auto">
        <div class="relative rounded-3xl border border-zinc-700/50 bg-gradient-to-br from-indigo-950/60 via-zinc-900 to-zinc-900 overflow-hidden p-12 text-center">
          <div class="pointer-events-none absolute inset-0">
            <div class="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 bg-indigo-600/15 rounded-full blur-3xl"></div>
          </div>
          <div class="relative">
            <h2 class="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-50 mb-4">准备好迎接你的第一位数字成员了吗？</h2>
            <p class="text-zinc-400 text-lg mb-8 max-w-lg mx-auto">免费注册，创建 AI 成员，搭建属于你的数字社会。</p>
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
          <img :src="heySureLogo" alt="HeySure logo" class="w-5 h-5 object-contain" />
          <span class="font-medium text-zinc-400">HeySure</span>
          <span class="text-zinc-600">· 数字社会操作系统</span>
        </div>
        <span>© {{ new Date().getFullYear() }} HeySure. All rights reserved.</span>
      </div>
    </footer>

  </div>
</template>
