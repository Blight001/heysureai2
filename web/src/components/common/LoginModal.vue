<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import * as authApi from '@/api/auth'
import type { AuthConfig } from '@/api/auth'
import type { User } from '@/types'
import { PRESET_AVATARS } from '@/utils/avatar'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'login-success', user: User, token: string): void
}>()

const isLoginMode = ref(true)
const loading = ref(false)
const error = ref('')

// 服务器认证能力：注册模式 + 邮箱验证码是否可用
const authConfig = ref<AuthConfig>({ registration_mode: 'open', email_enabled: false })
const loginMethod = ref<'password' | 'email'>('password')

const title = computed(() => isLoginMode.value ? '登录' : '注册')
const switchText = computed(() => isLoginMode.value ? '没有账号？去注册' : '已有账号？去登录')
const registrationClosed = computed(() => authConfig.value.registration_mode === 'closed')
const needEmailVerify = computed(() => authConfig.value.registration_mode === 'email')

const account = ref('')
const password = ref('')
const name = ref('')
const email = ref('')
const emailCode = ref('')
const avatarList = PRESET_AVATARS
const selectedAvatar = ref(avatarList[0])

// 发送验证码按钮的冷却倒计时
const codeCooldown = ref(0)
const sendingCode = ref(false)
let cooldownTimer: number | undefined

const startCooldown = (seconds = 60) => {
  codeCooldown.value = seconds
  if (cooldownTimer !== undefined) window.clearInterval(cooldownTimer)
  cooldownTimer = window.setInterval(() => {
    codeCooldown.value -= 1
    if (codeCooldown.value <= 0 && cooldownTimer !== undefined) {
      window.clearInterval(cooldownTimer)
      cooldownTimer = undefined
    }
  }, 1000)
}

watch(
  () => props.show,
  async (visible) => {
    if (!visible) return
    error.value = ''
    try {
      authConfig.value = await authApi.getAuthConfig()
    } catch {
      // 拿不到配置时按历史行为（开放注册、无邮箱登录）降级
      authConfig.value = { registration_mode: 'open', email_enabled: false }
    }
    if (!authConfig.value.email_enabled) loginMethod.value = 'password'
  },
  { immediate: true },
)

const sendCode = async () => {
  error.value = ''
  const target = email.value.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target)) {
    error.value = '请输入有效的邮箱地址'
    return
  }
  sendingCode.value = true
  try {
    await authApi.sendEmailCode(target, isLoginMode.value ? 'login' : 'register')
    startCooldown()
  } catch (err: any) {
    error.value = err?.message || '发送验证码失败'
  } finally {
    sendingCode.value = false
  }
}

const handleSubmit = async () => {
  error.value = ''
  loading.value = true

  try {
    if (isLoginMode.value) {
      const data = loginMethod.value === 'email'
        ? await authApi.loginWithEmail(email.value.trim(), emailCode.value.trim())
        : await authApi.login({ account: account.value, password: password.value })
      emit('login-success', data.user, data.access_token)
      emit('close')
    } else {
      await authApi.register({
        account: account.value,
        password: password.value,
        name: name.value,
        avatar: selectedAvatar.value,
        ...(needEmailVerify.value
          ? { email: email.value.trim(), email_code: emailCode.value.trim() }
          : {}),
      })
      isLoginMode.value = true
      error.value = '注册成功，请登录'
      password.value = ''
      emailCode.value = ''
    }
  } catch (err: any) {
    error.value = err?.message || '操作失败'
  } finally {
    loading.value = false
  }
}

const toggleMode = () => {
  isLoginMode.value = !isLoginMode.value
  error.value = ''
  password.value = ''
  emailCode.value = ''
}

onBeforeUnmount(() => {
  if (cooldownTimer !== undefined) window.clearInterval(cooldownTimer)
})
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md border border-zinc-200 dark:border-zinc-800 p-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-bold text-zinc-800 dark:text-zinc-100">{{ title }}</h2>
        <button @click="$emit('close')" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 注册已关闭提示 -->
      <div v-if="!isLoginMode && registrationClosed" class="space-y-5">
        <div class="rounded-xl border border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/30 px-4 py-5 text-center">
          <p class="text-sm font-medium text-amber-700 dark:text-amber-300">当前服务器已关闭注册</p>
          <p class="mt-1.5 text-xs text-amber-600/80 dark:text-amber-400/70">如需账号，请联系管理员为你创建</p>
        </div>
        <div class="text-center">
          <button type="button" @click="toggleMode" class="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 hover:underline">
            已有账号？去登录
          </button>
        </div>
      </div>

      <form v-else @submit.prevent="handleSubmit" class="space-y-4">
        <!-- 登录方式切换：仅服务器启用邮箱时显示 -->
        <div v-if="isLoginMode && authConfig.email_enabled" class="grid grid-cols-2 gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800">
          <button
            type="button"
            class="py-1.5 text-sm font-medium rounded-md transition-colors"
            :class="loginMethod === 'password'
              ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'"
            @click="loginMethod = 'password'"
          >密码登录</button>
          <button
            type="button"
            class="py-1.5 text-sm font-medium rounded-md transition-colors"
            :class="loginMethod === 'email'
              ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
              : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'"
            @click="loginMethod = 'email'"
          >邮箱验证码</button>
        </div>

        <div v-if="!isLoginMode">
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">昵称</label>
          <input v-model="name" type="text" required class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="请输入昵称" />
        </div>

        <!-- 账号 + 密码（注册始终需要；登录在密码方式下需要） -->
        <template v-if="!isLoginMode || loginMethod === 'password'">
          <div>
            <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">账号</label>
            <input v-model="account" type="text" required class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="请输入账号" />
          </div>

          <div>
            <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">密码</label>
            <input v-model="password" type="password" required class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="请输入密码" />
          </div>
        </template>

        <!-- 邮箱 + 验证码（邮箱登录；或邮箱验证注册模式） -->
        <template v-if="(isLoginMode && loginMethod === 'email') || (!isLoginMode && needEmailVerify)">
          <div>
            <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">邮箱</label>
            <input v-model="email" type="email" required class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="请输入邮箱地址" />
          </div>

          <div>
            <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">验证码</label>
            <div class="flex gap-2">
              <input v-model="emailCode" type="text" required maxlength="6" inputmode="numeric" class="flex-1 px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all tracking-widest" placeholder="6 位验证码" />
              <button
                type="button"
                :disabled="sendingCode || codeCooldown > 0"
                @click="sendCode"
                class="shrink-0 px-3 py-2 text-sm font-medium rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {{ codeCooldown > 0 ? `${codeCooldown}s 后重发` : (sendingCode ? '发送中…' : '发送验证码') }}
              </button>
            </div>
          </div>
        </template>

        <div v-if="!isLoginMode">
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">选择头像</label>
          <div class="grid grid-cols-5 gap-2">
            <div
              v-for="avatar in avatarList"
              :key="avatar"
              @click="selectedAvatar = avatar"
              class="relative cursor-pointer rounded-full overflow-hidden border-2 transition-all hover:scale-110"
              :class="selectedAvatar === avatar ? 'border-indigo-600 ring-2 ring-indigo-200' : 'border-transparent hover:border-zinc-300'"
            >
              <img :src="avatar" class="w-full h-full object-cover aspect-square" />
              <div v-if="selectedAvatar === avatar" class="absolute inset-0 bg-indigo-600/20 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-white drop-shadow-md" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div v-if="error" class="text-red-500 text-sm mt-2">{{ error }}</div>

        <button type="submit" :disabled="loading" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-6">
          {{ loading ? '处理中...' : (isLoginMode ? '登 录' : '注 册') }}
        </button>

        <div class="mt-4 text-center">
          <button type="button" @click="toggleMode" class="text-sm text-indigo-600 hover:text-indigo-500 dark:text-indigo-400 hover:underline">
            {{ switchText }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
