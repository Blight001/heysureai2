import type { User } from '@/types'
import { get, post, put } from './http'

interface LoginPayload {
  account: string
  password: string
}

interface RegisterPayload extends LoginPayload {
  name: string
  avatar?: string
  /** 注册模式为 email 时必填 */
  email?: string
  email_code?: string
}

interface LoginResponse {
  user: User
  access_token: string
}

export type RegistrationMode = 'open' | 'email' | 'closed'

export interface AuthConfig {
  registration_mode: RegistrationMode
  /** SMTP 已配置，邮箱验证码注册 / 登录可用 */
  email_enabled: boolean
}

export const me = (token?: string) =>
  get<User>('/api/auth/me', { token, fallbackError: '获取当前用户失败' })

export const getAuthConfig = () =>
  get<AuthConfig>('/api/auth/config', { auth: false, fallbackError: '获取服务器配置失败' })

export const sendEmailCode = (email: string, purpose: 'register' | 'login') =>
  post<{ ok: boolean }>('/api/auth/send-code', { email, purpose }, {
    auth: false,
    fallbackError: '发送验证码失败',
  })

export const loginWithEmail = (email: string, code: string) =>
  post<LoginResponse>('/api/auth/login-email', { email, code }, {
    auth: false,
    fallbackError: '登录失败',
  })

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
