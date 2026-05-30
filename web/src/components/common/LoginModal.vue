<script setup lang="ts">
import { ref, computed } from 'vue'
import * as authApi from '@/api/auth'
import type { User } from '@/types'
import { PRESET_AVATARS } from '@/utils/avatar'

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'login-success', user: User, token: string): void
}>()

const isLoginMode = ref(true)
const loading = ref(false)
const error = ref('')

const title = computed(() => isLoginMode.value ? '登录' : '注册')
const switchText = computed(() => isLoginMode.value ? '没有账号？去注册' : '已有账号？去登录')

const account = ref('')
const password = ref('')
const name = ref('')
const avatarList = PRESET_AVATARS
const selectedAvatar = ref(avatarList[0])

const handleSubmit = async () => {
  error.value = ''
  loading.value = true

  try {
    if (isLoginMode.value) {
      const data = await authApi.login({ account: account.value, password: password.value })
      emit('login-success', data.user, data.access_token)
      emit('close')
    } else {
      await authApi.register({
        account: account.value,
        password: password.value,
        name: name.value,
        avatar: selectedAvatar.value,
      })
      isLoginMode.value = true
      error.value = '注册成功，请登录'
      password.value = ''
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
}
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

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div v-if="!isLoginMode">
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">昵称</label>
          <input v-model="name" type="text" required class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="请输入昵称" />
        </div>

        <div>
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">账号</label>
          <input v-model="account" type="text" required class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="请输入账号" />
        </div>

        <div>
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">密码</label>
          <input v-model="password" type="password" required class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="请输入密码" />
        </div>

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
