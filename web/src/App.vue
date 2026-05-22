<script setup lang="ts">
import { ref, onMounted } from 'vue'
import GodDashboard from './components/GodDashboard.vue'
import HomePage from './components/HomePage.vue'
import LoginModal from './components/LoginModal.vue'
import ProfileModal from './components/ProfileModal.vue'
import MessageDialog from './components/MessageDialog.vue'

interface User {
  id: number
  name: string
  account: string
  avatar?: string
  ui_theme_mode?: 'light' | 'dark'
  ui_font_size?: 'sm' | 'md' | 'lg'
}

const user = ref<User | null>(null)
const showLogin = ref(false)
const showProfile = ref(false)

const handleLoginSuccess = (userData: any, token: string) => {
  user.value = userData
  localStorage.setItem('token', token)
  showLogin.value = false
}

const handleUpdateSuccess = (userData: any) => {
  user.value = userData
  showProfile.value = false
}

const handleLogout = () => {
  user.value = null
  localStorage.removeItem('token')
}

onMounted(async () => {
  const token = localStorage.getItem('token')
  if (token) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (res.ok) {
        user.value = await res.json()
      } else {
        localStorage.removeItem('token')
      }
    } catch (e) {
      localStorage.removeItem('token')
    }
  }
})
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-indigo-50 text-zinc-900 antialiased dark:from-zinc-950 dark:via-zinc-900 dark:to-slate-900 dark:text-zinc-100">
    <div class="min-h-screen">
      <HomePage
        v-if="!user"
        @login="showLogin = true"
        @register="showLogin = true"
      />
      <GodDashboard
        v-else
        :current-user="user"
        @login="showLogin = true"
        @logout="handleLogout"
        @update-profile="showProfile = true"
        @refresh-user="user = $event"
      />
    </div>

    <LoginModal
      :show="showLogin"
      @close="showLogin = false"
      @login-success="handleLoginSuccess"
    />

    <ProfileModal
      v-if="user"
      :show="showProfile"
      :user="user"
      @close="showProfile = false"
      @update-success="handleUpdateSuccess"
    />

    <MessageDialog />
  </div>
</template>

<style>
html {
  font-size: var(--app-font-size, 14px);
}

body {
  @apply bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100;
  font-size: inherit;
}

#app {
  @apply min-h-screen;
}

/* Modern Global Scrollbar Styles */
::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  @apply bg-zinc-300 rounded-full transition-colors;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  @apply bg-zinc-400;
}

.dark ::-webkit-scrollbar-thumb {
  @apply bg-zinc-700;
}

.dark ::-webkit-scrollbar-thumb:hover {
  @apply bg-zinc-600;
}

/* Firefox compatibility */
* {
  scrollbar-width: thin;
  scrollbar-color: #d4d4d8 transparent;
}

.dark * {
  scrollbar-color: #3f3f46 transparent;
}

/* Modern Select Styles */
select {
  @apply cursor-pointer transition-all duration-200 ease-in-out;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  background-size: 1rem;
  padding-right: 2rem !important;
}

.dark select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23a1a1aa'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
}

select:hover {
  @apply border-indigo-300 dark:border-indigo-700;
}

select:focus {
  @apply ring-2 ring-indigo-500/20 border-indigo-500 outline-none;
}
</style>
