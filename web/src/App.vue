<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import type { User } from '@/types'
import heySureLogo from '@/assets/logo/HeySure.png'
import { getInitialUiPreferences } from '@/utils/uiPreferences'

const GodDashboard = defineAsyncComponent(() => import('@/components/dashboard/GodDashboard.vue'))
const HomePage = defineAsyncComponent(() => import('@/components/home/HomePage.vue'))
const LoginModal = defineAsyncComponent(() => import('@/components/common/LoginModal.vue'))
const ProfileModal = defineAsyncComponent(() => import('@/components/common/ProfileModal.vue'))
const MessageDialog = defineAsyncComponent(() => import('@/components/common/MessageDialog.vue'))

const { user, handleLoginSuccess, updateUser, logout } = useAuth()
const initialUiPreferences = getInitialUiPreferences()
const isDarkStartup = initialUiPreferences.themeMode === 'dark'

const showLogin = ref(false)
const showProfile = ref(false)
const showSplash = ref(true)
const revealContent = ref(false)
// 登录成功 / 会话恢复后需等待控制台数据就绪，避免直接显示空白界面
const dashboardLoading = ref(false)

const showStartupOverlay = computed(() => showSplash.value || dashboardLoading.value)
const startupHint = computed(() =>
  dashboardLoading.value && !showSplash.value ? '正在载入控制台与成员数据' : '正在初始化界面与资源',
)

let revealTimer: number | undefined
let preloadRemovalTimer: number | undefined
let startupFallbackTimer: number | undefined
let dashboardLoadingFallbackTimer: number | undefined
let removeLoadListener: (() => void) | undefined

const startDashboardLoading = () => {
  dashboardLoading.value = true
  if (dashboardLoadingFallbackTimer !== undefined) {
    window.clearTimeout(dashboardLoadingFallbackTimer)
  }
  // 兜底：即使控制台未上报就绪，也在超时后撤下遮罩，避免永久卡住
  dashboardLoadingFallbackTimer = window.setTimeout(() => {
    dashboardLoading.value = false
  }, 8000)
}

const onDashboardReady = () => {
  dashboardLoading.value = false
  if (dashboardLoadingFallbackTimer !== undefined) {
    window.clearTimeout(dashboardLoadingFallbackTimer)
    dashboardLoadingFallbackTimer = undefined
  }
}

const hideStaticPreload = () => {
  const preload = document.getElementById('startup-preload')
  if (!preload) return
  preload.classList.add('is-hidden')
  preloadRemovalTimer = window.setTimeout(() => {
    preload.remove()
  }, 420)
}

const revealApp = () => {
  if (revealContent.value) return
  revealContent.value = true
  revealTimer = window.setTimeout(() => {
    showSplash.value = false
  }, 650)
}

const onLoginSuccess = (userData: User, token: string) => {
  handleLoginSuccess(userData, token)
  showLogin.value = false
}

// 登录态从无到有时拉起加载遮罩，登出时立即撤下
watch(
  () => !!user.value,
  (loggedIn) => {
    if (loggedIn) startDashboardLoading()
    else onDashboardReady()
  },
)

const onUpdateSuccess = (userData: User) => {
  updateUser(userData)
  showProfile.value = false
}

onMounted(() => {
  startupFallbackTimer = window.setTimeout(() => {
    hideStaticPreload()
    revealApp()
  }, 2500)

  requestAnimationFrame(() => {
    hideStaticPreload()
  })

  if (document.readyState === 'complete') {
    requestAnimationFrame(() => {
      revealApp()
    })
    return
  }

  const handleLoad = () => {
    revealApp()
  }

  window.addEventListener('load', handleLoad, { once: true })
  removeLoadListener = () => {
    window.removeEventListener('load', handleLoad)
  }
})

onBeforeUnmount(() => {
  removeLoadListener?.()
  if (revealTimer !== undefined) {
    window.clearTimeout(revealTimer)
  }
  if (preloadRemovalTimer !== undefined) {
    window.clearTimeout(preloadRemovalTimer)
  }
  if (startupFallbackTimer !== undefined) {
    window.clearTimeout(startupFallbackTimer)
  }
  if (dashboardLoadingFallbackTimer !== undefined) {
    window.clearTimeout(dashboardLoadingFallbackTimer)
  }
})
</script>

<template>
  <div class="relative min-h-screen overflow-hidden bg-gradient-to-br from-zinc-50 via-white to-indigo-50 text-zinc-900 antialiased dark:from-zinc-950 dark:via-zinc-900 dark:to-slate-900 dark:text-zinc-100">
    <div class="app-background-glow pointer-events-none absolute inset-0"></div>
    <div class="pointer-events-none absolute inset-0 opacity-60">
      <div class="app-background-orb app-background-orb-left"></div>
      <div class="app-background-orb app-background-orb-right"></div>
    </div>

    <div
      class="relative z-[1] min-h-screen transition-[opacity,transform,filter] duration-700 ease-out"
      :class="revealContent ? 'opacity-100 translate-y-0 blur-0' : 'pointer-events-none select-none opacity-0 translate-y-2 blur-[2px]'"
    >
      <HomePage
        v-if="!user"
        @login="showLogin = true"
        @register="showLogin = true"
      />
      <GodDashboard
        v-else
        :current-user="user"
        @login="showLogin = true"
        @logout="logout"
        @update-profile="showProfile = true"
        @refresh-user="updateUser"
        @ready="onDashboardReady"
      />
    </div>

    <LoginModal
      :show="showLogin"
      @close="showLogin = false"
      @login-success="onLoginSuccess"
    />

    <ProfileModal
      v-if="user"
      :show="showProfile"
      :user="user"
      @close="showProfile = false"
      @update-success="onUpdateSuccess"
    />

    <MessageDialog />

    <Transition name="startup-splash">
      <div
        v-if="showStartupOverlay"
        class="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
        :class="isDarkStartup
          ? 'bg-zinc-950 text-zinc-100'
          : 'bg-gradient-to-br from-zinc-50 via-white to-indigo-50 text-zinc-900'"
      >
        <div class="relative w-full max-w-lg px-6">
          <div
            class="rounded-3xl px-8 py-10 text-center shadow-2xl backdrop-blur-xl"
            :class="isDarkStartup
              ? 'border border-zinc-800/70 bg-zinc-900/70 shadow-zinc-950/70'
              : 'border border-white/70 bg-white/80 shadow-indigo-100/70'"
          >
            <div
              class="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg"
              :class="isDarkStartup
                ? 'border border-indigo-500/20 bg-gradient-to-br from-indigo-500/15 to-indigo-700/20 shadow-indigo-950/40'
                : 'border border-indigo-200/70 bg-gradient-to-br from-indigo-50 to-indigo-100 shadow-indigo-200/70'"
            >
              <img
                :src="heySureLogo"
                alt="HeySure logo"
                class="h-12 w-12 object-contain"
              />
            </div>

            <div class="mt-6 space-y-3">
              <div
                class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium tracking-wide"
                :class="isDarkStartup
                  ? 'border border-zinc-700/60 bg-zinc-950/60 text-zinc-400'
                  : 'border border-zinc-200/80 bg-white/90 text-zinc-500'"
              >
                <span class="h-1.5 w-1.5 rounded-full bg-indigo-500"></span>
                专为现代团队而生
              </div>
              <h1 class="text-3xl font-bold tracking-tight sm:text-4xl" :class="isDarkStartup ? 'text-zinc-50' : 'text-zinc-900'">
                HeySure
              </h1>
              <p class="text-sm leading-relaxed sm:text-base" :class="isDarkStartup ? 'text-zinc-400' : 'text-zinc-500'">
                协作更高效，管理更清晰
              </p>
            </div>

            <div class="mt-8">
              <div class="h-1 overflow-hidden rounded-full" :class="isDarkStartup ? 'bg-zinc-800/80' : 'bg-zinc-200/80'">
                <div class="startup-progress h-full rounded-full"></div>
              </div>
              <p class="mt-4 text-sm" :class="isDarkStartup ? 'text-zinc-500' : 'text-zinc-500'">
                {{ startupHint }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
