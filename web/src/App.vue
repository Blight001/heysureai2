<script setup lang="ts">
import { ref } from 'vue'
import GodDashboard from '@/components/dashboard/GodDashboard.vue'
import HomePage from '@/components/home/HomePage.vue'
import LoginModal from '@/components/common/LoginModal.vue'
import ProfileModal from '@/components/common/ProfileModal.vue'
import MessageDialog from '@/components/common/MessageDialog.vue'
import { useAuth } from '@/composables/useAuth'
import type { User } from '@/types'

const { user, handleLoginSuccess, updateUser, logout } = useAuth()

const showLogin = ref(false)
const showProfile = ref(false)

const onLoginSuccess = (userData: User, token: string) => {
  handleLoginSuccess(userData, token)
  showLogin.value = false
}

const onUpdateSuccess = (userData: User) => {
  updateUser(userData)
  showProfile.value = false
}
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
        @logout="logout"
        @update-profile="showProfile = true"
        @refresh-user="updateUser"
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
  </div>
</template>
