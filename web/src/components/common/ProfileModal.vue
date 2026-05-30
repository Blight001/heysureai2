<script setup lang="ts">
import { ref, watch } from 'vue'
import * as authApi from '@/api/auth'
import type { User } from '@/types'
import { PRESET_AVATARS, resolveAvatarUrl } from '@/utils/avatar'

const props = defineProps<{
  show: boolean
  user: User
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update-success', user: User): void
}>()

const loading = ref(false)
const error = ref('')
const name = ref('')
const password = ref('')
const selectedAvatar = ref('')

const avatarList = PRESET_AVATARS

watch(() => props.show, (newVal) => {
  if (newVal) {
    name.value = props.user.name
    password.value = ''
    // Normalise so a previously-stored preset (incl. old bundled URLs) matches
    // and stays highlighted in the picker.
    selectedAvatar.value = resolveAvatarUrl(props.user.avatar) || avatarList[0]
    error.value = ''
  }
})

const handleSubmit = async () => {
  error.value = ''
  loading.value = true

  try {
    const payload: Record<string, unknown> = {
      name: name.value,
      avatar: selectedAvatar.value,
    }
    if (password.value) payload.password = password.value

    const updated = await authApi.updateProfile(payload)
    emit('update-success', updated)
    emit('close')
  } catch (err: any) {
    error.value = err?.message || '更新失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
    <div class="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-zinc-200 dark:border-zinc-800 p-6">
      <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-bold text-zinc-800 dark:text-zinc-100">个人资料设置</h2>
        <button @click="$emit('close')" class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">账号</label>
          <div class="w-full px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-transparent">
            {{ user.account }}
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">昵称</label>
          <input v-model="name" type="text" required class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
        </div>

        <div>
          <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">新密码 (留空则不修改)</label>
          <input v-model="password" type="password" class="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 outline-none transition-all" placeholder="请输入新密码" />
        </div>

        <div>
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

        <div class="flex gap-3 mt-6">
          <button type="button" @click="$emit('close')" class="flex-1 px-4 py-2 border border-zinc-300 rounded-lg text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors">
            取消
          </button>
          <button type="submit" :disabled="loading" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {{ loading ? '保存中...' : '保存修改' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
