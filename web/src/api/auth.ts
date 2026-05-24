import type { User } from '@/types'
import { get, post, put } from './http'

interface LoginPayload {
  account: string
  password: string
}

interface RegisterPayload extends LoginPayload {
  name: string
  avatar?: string
}

interface LoginResponse {
  user: User
  access_token: string
}

export const me = (token?: string) =>
  get<User>('/api/auth/me', { token, fallbackError: '获取当前用户失败' })

export const login = (payload: LoginPayload) =>
  post<LoginResponse>('/api/auth/login', payload, {
    auth: false,
    fallbackError: '登录失败',
  })

export const register = (payload: RegisterPayload) =>
  post<unknown>('/api/auth/register', payload, {
    auth: false,
    fallbackError: '注册失败',
  })

/**
 * Update the current user. The backend accepts a partial document so this is
 * `unknown`-typed at the call site; callers should supply only the fields they
 * want to change.
 */
export const updateProfile = <T extends Record<string, unknown>>(payload: T) =>
  put<User>('/api/auth/profile', payload, { fallbackError: '更新失败' })
