import { onMounted, ref } from 'vue'
import * as authApi from '@/api/auth'
import { clearAuthToken, getAuthToken, setAuthToken } from '@/api/http'
import type { User } from '@/types'

/**
 * Authentication state holder + helpers.
 *
 * Encapsulates the current `user` ref and the persistent token lifecycle so
 * components don't have to talk to localStorage directly. On mount the
 * composable will validate any cached token by calling `/api/auth/me` and
 * silently sign out if the token is no longer accepted.
 */
export const useAuth = () => {
  const user = ref<User | null>(null)

  const handleLoginSuccess = (userData: User, token: string) => {
    user.value = userData
    setAuthToken(token)
  }

  const updateUser = (userData: User) => {
    user.value = userData
  }

  const logout = () => {
    user.value = null
    clearAuthToken()
  }

  const restoreSession = async () => {
    const token = getAuthToken()
    if (!token) return
    try {
      user.value = await authApi.me(token)
    } catch {
      clearAuthToken()
    }
  }

  onMounted(() => {
    void restoreSession()
  })

  return {
    user,
    handleLoginSuccess,
    updateUser,
    logout,
    restoreSession,
  }
}
